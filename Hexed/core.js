// Hexed core: pure logic shared by the tracker (extension.js), the page (index.js) and tests.
// A record is one stream: { s: start ms epoch, ms: ms listened, u: "spotify:track:..." | null, n: track, a: artist, al: album, src: "live"|"extended"|"account" }
var HexedCore = globalThis.HexedCore = (() => {
  const PLAY_MS = 30000; // Spotify's own rule: 30s+ counts as a play
  const DUP_MS = 120000; // two streams of the same song starting within 2 min = the same stream from two sources

  const isPlay = r => r.ms >= PLAY_MS;

  // After a reload/restart: the saved in-progress stream continues if the same song is still mid-play
  // (otherwise it would be saved and a second stream started, counting one listen twice).
  const shouldResume = (left, uri, progressMs) => !!left && left.u === uri && progressMs >= 3000;
  const nameKey = (n, a) => `${(n || "").trim().toLowerCase()}|${(a || "").trim().toLowerCase()}`;

  // Parse one exported JSON file. Only the fields Hexed needs are kept (IP, country, device are dropped).
  function parseExport(list) {
    if (!Array.isArray(list)) throw new Error("not a Spotify history file (expected a JSON list)");
    const out = [];
    for (const e of list) {
      if ("s" in e && "ms" in e && "src" in e) { // Hexed's own backup
        if (typeof e.s === "number" && typeof e.ms === "number") out.push({ s: e.s, ms: e.ms, u: e.u || null, n: e.n || "", a: e.a || "", al: e.al || "", src: e.src });
      } else if ("ms_played" in e) { // Extended streaming history
        const u = e.spotify_track_uri;
        if (!u || !e.master_metadata_track_name) continue; // podcasts, audiobooks, broken rows
        const end = Date.parse(e.ts);
        if (Number.isNaN(end)) continue;
        out.push({ s: end - e.ms_played, ms: e.ms_played, u, n: e.master_metadata_track_name, a: e.master_metadata_album_artist_name || "", al: e.master_metadata_album_album_name || "", src: "extended" });
      } else if ("msPlayed" in e && "endTime" in e) { // Account data (last year, minute precision, no URIs, UTC)
        if (!e.trackName || e.trackName === "Unknown Track") continue;
        const end = Date.parse(e.endTime.replace(" ", "T") + ":00Z");
        if (Number.isNaN(end)) continue;
        out.push({ s: end - e.msPlayed, ms: e.msPlayed, u: null, n: e.trackName, a: e.artistName || "", al: "", src: "account" });
      } else if ("episode_name" in e || "podcastName" in e) {
        continue;
      } else {
        throw new Error("unrecognised entry: " + Object.keys(e).slice(0, 5).join(", "));
      }
    }
    return out;
  }

  // Song identity: URI when known; account-data rows borrow a URI from any record with the same name+artist.
  function keyer(records) {
    const uriByName = new Map();
    for (const r of records) if (r.u) uriByName.set(nameKey(r.n, r.a), r.u);
    return r => r.u || uriByName.get(nameKey(r.n, r.a)) || nameKey(r.n, r.a);
  }

  // Merge incoming into existing without double counting. Returns { merged, added, skipped, dropped }.
  // Extended history supersedes account data (it covers the same streams with more detail).
  function merge(existing, incoming) {
    let base = existing;
    if (incoming.some(r => r.src === "extended")) base = existing.filter(r => r.src !== "account");
    const key = keyer(base.concat(incoming));
    const starts = new Map(); // song key -> { source: sorted start times already present }
    const times = (k, src) => ((starts.get(k) || starts.set(k, {}).get(k))[src] ||= []);
    for (const r of base) times(key(r), r.src).push(r.s);
    for (const bySrc of starts.values()) for (const arr of Object.values(bySrc)) arr.sort((x, y) => x - y);
    const added = [];
    let skipped = 0;
    for (const r of incoming) {
      const k = key(r);
      // One source can loop a short song within DUP_MS, so only its exact start is a repeat.
      // shortcut: a loop only half covered by another source loses a play near the overlap, upgrade by pairing streams one to one.
      if (Object.entries(starts.get(k) || {}).some(([src, arr]) => hasNear(arr, r.s, src === r.src ? 1 : DUP_MS))) { skipped++; continue; }
      insertSorted(times(k, r.src), r.s);
      added.push(r);
    }
    return { merged: base.concat(added), added: added.length, skipped, dropped: existing.length - base.length };
  }

  function lowerBound(sorted, t) {
    let lo = 0, hi = sorted.length;
    while (lo < hi) { const m = (lo + hi) >> 1; sorted[m] < t ? (lo = m + 1) : (hi = m); }
    return lo;
  }
  function hasNear(sorted, t, within) {
    const i = lowerBound(sorted, t);
    return (i < sorted.length && sorted[i] - t < within) || (i > 0 && t - sorted[i - 1] < within);
  }
  const insertSorted = (sorted, t) => sorted.splice(lowerBound(sorted, t), 0, t);

  // Play counts per song key, for the tracklist badges.
  function counts(records) {
    const key = keyer(records), c = new Map();
    for (const r of records) if (isPlay(r)) { const k = key(r); c.set(k, (c.get(k) || 0) + 1); }
    return c;
  }

  const dayStr = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

  // Local midnights from start's day until end. Steps by calendar, because a clock change makes a day 23 or 25 hours.
  function calendarDays(start, end) {
    const d = new Date(start), out = [];
    for (let i = 0, t; (t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i).getTime()) < end; i++) out.push(t);
    return out;
  }

  // Stats for records whose start is in [from, to). Times are local.
  function stats(records, from = -Infinity, to = Infinity, top = 50) {
    const key = keyer(records);
    const songs = new Map(), artists = new Map(), albums = new Map(), days = new Map();
    const hours = new Array(24).fill(0);
    const heat = Array.from({ length: 7 }, () => new Array(24).fill(0)); // [weekday 0=Sun][hour] -> ms
    const songDay = new Map(); // "songKey|day" -> plays, for "played X times in one day"
    let ms = 0, plays = 0, skips = 0, first = Infinity, last = -Infinity;
    for (const r of records) {
      if (r.s < from || r.s >= to) continue;
      if (!isPlay(r)) { skips++; continue; }
      ms += r.ms;
      plays++;
      if (r.s < first) first = r.s;
      if (r.s > last) last = r.s;
      const k = key(r);
      bump(songs, k, r.ms, () => ({ n: r.n, a: r.a, u: r.u, k }));
      // `u` is a sample track used to fetch art; prefer a streamed track over a local file (no art)
      if (r.a) preferStreamed(bump(artists, r.a.toLowerCase(), r.ms, () => ({ a: r.a, u: r.u })), r.u);
      if (r.al) preferStreamed(bump(albums, `${r.al}|${r.a}`.toLowerCase(), r.ms, () => ({ al: r.al, a: r.a, u: r.u })), r.u);
      const t = new Date(r.s);
      hours[t.getHours()] += r.ms;
      heat[t.getDay()][t.getHours()] += r.ms;
      const d = dayStr(r.s);
      days.set(d, (days.get(d) || 0) + r.ms);
      const sd = k + "|" + d;
      songDay.set(sd, (songDay.get(sd) || 0) + 1);
    }
    const all = m => [...m.values()].sort((x, y) => y.plays - x.plays || y.ms - x.ms);
    const songList = all(songs);
    let bestDay = null;
    for (const [d, v] of days) if (!bestDay || v > bestDay.ms) bestDay = { day: d, ms: v };
    let obsession = null;
    for (const [sd, n] of songDay) if (!obsession || n > obsession.plays) { const i = sd.lastIndexOf("|"); obsession = { k: sd.slice(0, i), day: sd.slice(i + 1), plays: n }; }
    if (obsession) Object.assign(obsession, songs.get(obsession.k), { plays: obsession.plays });
    return {
      ms, plays, skips, uniqueSongs: songs.size, uniqueArtists: artists.size,
      topSongs: songList.slice(0, top), topArtists: all(artists).slice(0, top), topAlbums: all(albums).slice(0, top),
      hours, heat, days, first, last, bestDay, obsession, streak: longestStreak([...days.keys()]),
      artistSet: new Set(artists.keys()),
    };
  }

  // The window right before [from, to) with the same length, or null for open-ended ranges.
  const prevRange = (from, to) => (Number.isFinite(from) && Number.isFinite(to) ? [from - (to - from), from] : null);

  // Percent change, or null when there's nothing to compare against.
  const delta = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);

  // Artists played in [from, to) that never appear before `from`.
  function newArtists(records, from, st) {
    const before = new Set();
    let hasHistory = false;
    for (const r of records) if (r.s < from && isPlay(r) && r.a) { before.add(r.a.toLowerCase()); hasHistory = true; }
    if (!hasHistory) return null; // no earlier data: "new" would be meaningless
    let n = 0;
    for (const a of st.artistSet) if (!before.has(a)) n++;
    return n;
  }

  const WEEKDAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
  const dateOpts = t => ({ month: "short", day: "numeric", ...(new Date(t).getFullYear() !== new Date().getFullYear() && { year: "numeric" }) });
  const fmtDay = d => { const t = new Date(d + "T12:00:00"); return t.toLocaleDateString(undefined, dateOpts(t)); };

  // Plain-English observations, strongest first. `prev` = stats for the previous window (or null).
  function insights(st, prev, fresh, label = "the period before") {
    const out = [];
    if (!st.plays) return out;
    const pct = (a, b) => Math.round((a / b) * 100);
    const d = prev && delta(st.ms, prev.ms);
    if (d !== null && d !== undefined && Math.abs(d) >= 10) out.push(`You listened ${Math.abs(d)}% ${d > 0 ? "more" : "less"} than ${label}.`);
    const top = st.topArtists[0];
    if (top && st.plays >= 10) out.push(`${top.a} was ${pct(top.ms, st.ms)}% of your listening.`);
    if (st.obsession && st.obsession.plays >= 4) out.push(`You played ${st.obsession.n} ${st.obsession.plays} times on ${fmtDay(st.obsession.day)}.`);
    const night = [22, 23, 0, 1, 2, 3, 4].reduce((s, h) => s + st.hours[h], 0);
    const morning = [5, 6, 7, 8, 9].reduce((s, h) => s + st.hours[h], 0);
    if (pct(night, st.ms) >= 30) out.push(`Night owl: ${pct(night, st.ms)}% of your listening is between 10 PM and 5 AM.`);
    else if (pct(morning, st.ms) >= 30) out.push(`Early bird: ${pct(morning, st.ms)}% of your listening is before 10 AM.`);
    if (fresh) out.push(`${fresh} artist${fresh === 1 ? "" : "s"} you'd never played before.`);
    const skipRate = pct(st.skips, st.plays + st.skips);
    if (st.plays + st.skips >= 20 && skipRate >= 20) out.push(`You skip ${skipRate}% of songs before 30 seconds.`);
    const byDay = st.heat.map(row => row.reduce((a, b) => a + b, 0));
    const best = byDay.indexOf(Math.max(...byDay));
    if (st.days.size >= 14) out.push(`${WEEKDAYS[best]} are your biggest listening day.`);
    if (st.streak && st.streak.days >= 3) out.push(`Longest streak: ${st.streak.days} days in a row (${fmtDay(st.streak.from)} to ${fmtDay(st.streak.to)}).`);
    return out;
  }

  function bump(map, k, ms, make) {
    let v = map.get(k);
    if (!v) map.set(k, (v = Object.assign(make(), { plays: 0, ms: 0 })));
    v.plays++; v.ms += ms;
    return v;
  }
  const isStreamed = u => typeof u === "string" && u.startsWith("spotify:track:");
  function preferStreamed(v, u) { if (!isStreamed(v.u) && isStreamed(u)) v.u = u; }

  function longestStreak(dayList) {
    const sorted = dayList.map(d => Date.parse(d + "T12:00:00")).sort((x, y) => x - y);
    let best = null, start = 0;
    for (let i = 0; i < sorted.length; i++) {
      if (i > 0 && Math.round((sorted[i] - sorted[i - 1]) / 86400000) !== 1) start = i;
      const len = i - start + 1;
      if (!best || len > best.days) best = { days: len, from: dayStr(sorted[start]), to: dayStr(sorted[i]) };
    }
    return best;
  }

  return { PLAY_MS, isPlay, shouldResume, nameKey, parseExport, merge, counts, stats, prevRange, delta, newArtists, insights, longestStreak, dayStr, calendarDays, dateOpts };
})();
if (typeof module !== "undefined") module.exports = HexedCore;
