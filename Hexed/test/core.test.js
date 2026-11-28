// Run (from Hexed/): node --test test/core.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../core.js");

test("calendarDays gives every date once across clock changes and stops before end", () => {
  const tz = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    const days = C.calendarDays(new Date(2025, 9, 30, 15).getTime(), new Date(2026, 2, 10).getTime()).map(C.dayStr);
    assert.equal(days[0], "2025-10-30");
    assert.equal(days[days.length - 1], "2026-03-09");
    assert.equal(days.length, 131);
    assert.equal(new Set(days).size, days.length);
  } finally {
    if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz;
  }
});

const ext = (ts, ms, uri, n = "Song", a = "Artist") => ({ ts, ms_played: ms, spotify_track_uri: uri, master_metadata_track_name: n, master_metadata_album_artist_name: a, master_metadata_album_album_name: "Album", ip_addr: "0.0.0.0" });

test("parses extended history, drops podcasts and private fields", () => {
  const r = C.parseExport([
    ext("2026-01-01T10:05:00Z", 300000, "spotify:track:A"),
    { ts: "2026-01-01T11:00:00Z", ms_played: 900000, spotify_track_uri: null, master_metadata_track_name: null, episode_name: "Pod" },
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].s, Date.parse("2026-01-01T10:00:00Z"));
  assert.equal(r[0].src, "extended");
  assert.ok(!("ip_addr" in r[0]));
});

test("parses account data (UTC, minute precision)", () => {
  const r = C.parseExport([{ endTime: "2026-01-01 10:05", artistName: "Artist", trackName: "Song", msPlayed: 60000 }]);
  assert.equal(r[0].s, Date.parse("2026-01-01T10:04:00Z"));
  assert.equal(r[0].u, null);
});

test("Hexed backup round-trips and re-merging it adds nothing", () => {
  const recs = C.parseExport([ext("2026-01-01T10:05:00Z", 300000, "spotify:track:A")]);
  const back = C.parseExport(JSON.parse(JSON.stringify(recs)));
  assert.deepEqual(back, recs);
  assert.equal(C.merge(recs, back).added, 0);
});

test("rejects files that are not history", () => {
  assert.throws(() => C.parseExport({ a: 1 }));
  assert.throws(() => C.parseExport([{ foo: 1 }]));
});

test("30s rule: plays vs skips", () => {
  const s = C.stats([{ s: 0, ms: 29999, u: "x", n: "S", a: "A", al: "" }, { s: 1, ms: 30000, u: "x", n: "S", a: "A", al: "" }]);
  assert.equal(s.plays, 1);
  assert.equal(s.skips, 1);
  assert.equal(s.ms, 30000); // minutes leave skips out, like every other total
});

test("merge: a short song on repeat keeps every play, and re-importing adds nothing", () => {
  const rows = [0, 1, 2, 3, 4].map(i => ({ s: 1e12 + i * 90000, ms: 90000, u: "spotify:track:A", n: "Song", a: "Artist", al: "", src: "extended" }));
  const m = C.merge([], rows);
  assert.equal(m.added, 5);
  assert.equal(C.merge(m.merged, rows).added, 0);
});

test("insights show the year only for other years", () => {
  const y = new Date().getFullYear();
  const say = year => {
    const t = Date.parse(`${year}-03-06T15:00:00`);
    const recs = Array.from({ length: 12 }, (_, i) => ({ s: t + i * 1000, ms: 60000, u: "x", n: "Hypnotic", a: "Juice WRLD", al: "", src: "live" }));
    return C.insights(C.stats(recs), null, null).find(l => l.includes("times on"));
  };
  assert.ok(say(y - 1).includes(String(y - 1)));
  assert.ok(!say(y).includes(String(y)));
});

test("merge: same stream from live tracker and history import counts once", () => {
  const live = [{ s: Date.parse("2026-01-01T10:00:20Z"), ms: 280000, u: "spotify:track:A", n: "Song", a: "Artist", al: "Album", src: "live" }];
  const imp = C.parseExport([ext("2026-01-01T10:05:00Z", 300000, "spotify:track:A"), ext("2026-01-01T12:05:00Z", 300000, "spotify:track:A")]);
  const m = C.merge(live, imp);
  assert.equal(m.added, 1);
  assert.equal(m.skipped, 1);
  assert.equal(C.counts(m.merged).get("spotify:track:A"), 2);
});

test("merge: importing extended replaces account data, and is idempotent", () => {
  const acc = C.parseExport([{ endTime: "2026-01-01 10:05", artistName: "Artist", trackName: "Song", msPlayed: 300000 }]);
  const imp = C.parseExport([ext("2026-01-01T10:05:00Z", 300000, "spotify:track:A")]);
  const m1 = C.merge(acc, imp);
  assert.equal(m1.dropped, 1);
  assert.equal(m1.merged.length, 1);
  const m2 = C.merge(m1.merged, imp);
  assert.equal(m2.added, 0);
});

test("account rows borrow URI from matching name+artist (case-insensitive)", () => {
  const recs = [
    { s: 0, ms: 60000, u: "spotify:track:A", n: "Song", a: "Artist", al: "", src: "live" },
    { s: 1e9, ms: 60000, u: null, n: "song ", a: "ARTIST", al: "", src: "account" },
  ];
  assert.equal(C.counts(recs).get("spotify:track:A"), 2);
});

test("stats: heatmap, one-day obsession, daily totals", () => {
  const t = Date.parse("2026-03-06T23:30:00"); // a Friday, 11 PM local
  const recs = Array.from({ length: 5 }, (_, i) => ({ s: t + i * 1000, ms: 60000, u: "x", n: "Hypnotic", a: "Juice WRLD", al: "", src: "live" }));
  const s = C.stats(recs);
  assert.equal(s.heat[5][23], 300000);
  assert.deepEqual([s.obsession.n, s.obsession.plays, s.obsession.day], ["Hypnotic", 5, "2026-03-06"]);
  assert.equal(s.days.get("2026-03-06"), 300000);
});

test("artist sample track prefers a streamed track over a local file", () => {
  const r = (s, u) => ({ s, ms: 60000, u, n: "Song" + s, a: "Juice WRLD", al: "Alb", src: "live" });
  const st = C.stats([r(1, "spotify:local:Juice+WRLD:x:Hypnotic:184"), r(2, "spotify:track:REAL")]);
  assert.equal(st.topArtists[0].u, "spotify:track:REAL");
  assert.equal(st.topAlbums[0].u, "spotify:track:REAL");
});

test("shouldResume: reload mid-song continues the same listen", () => {
  const left = { s: 0, ms: 48000, u: "spotify:track:HELL", src: "live" };
  assert.equal(C.shouldResume(left, "spotify:track:HELL", 95000), true);   // same song still playing
  assert.equal(C.shouldResume(left, "spotify:track:HELL", 1000), false);   // song restarted from the top
  assert.equal(C.shouldResume(left, "spotify:track:OTHER", 95000), false); // different song now
  assert.equal(C.shouldResume(null, "spotify:track:HELL", 95000), false);
});

test("prevRange / delta", () => {
  assert.deepEqual(C.prevRange(100, 150), [50, 100]);
  assert.equal(C.prevRange(-Infinity, 5), null);
  assert.equal(C.delta(132, 100), 32);
  assert.equal(C.delta(5, 0), null);
});

test("newArtists needs earlier history, then counts unseen artists", () => {
  const r = (s, a) => ({ s, ms: 60000, u: a, n: a, a, al: "", src: "live" });
  const recs = [r(1, "Old"), r(100, "Old"), r(101, "New")];
  assert.equal(C.newArtists(recs, 100, C.stats(recs, 100, 200)), 1);
  assert.equal(C.newArtists(recs, 0, C.stats(recs, 0, 200)), null);
});

test("insights: comparison, top artist share, obsession, night owl", () => {
  const t = Date.parse("2026-03-06T23:30:00");
  const recs = Array.from({ length: 12 }, (_, i) => ({ s: t + i * 1000, ms: 60000, u: "x", n: "Hypnotic", a: "Juice WRLD", al: "", src: "live" }));
  const st = C.stats(recs);
  const prev = { ms: st.ms / 2 };
  const text = C.insights(st, prev, 3, "last month").join(" | ");
  assert.match(text, /100% more than last month/);
  assert.match(text, /Juice WRLD was 100%/);
  assert.match(text, /Hypnotic 12 times/);
  assert.match(text, /Night owl/);
  assert.match(text, /3 artists you'd never played before/);
  assert.deepEqual(C.insights(C.stats([]), null, null), []);
});

test("wrapped: first song, artist songs, local share, discoveries, days and time of day", () => {
  const at = (d, h) => new Date(2026, 2, d, h).getTime();
  const r = (s, u, n, a = "Juice WRLD", al = "Alb") => ({ s, ms: 60000, u, n, a, al, src: "live" });
  const L = "spotify:local:Juice+WRLD:Alb:Leak:120";
  const recs = [
    r(at(1, 9), "spotify:track:OLD", "Old"),          // before the range: not a discovery
    r(at(10, 9), "spotify:track:OLD", "Old"),         // first play in range (morning)
    ...[0, 1, 2].map(i => r(at(11, 23) + i, L, "Leak")), // night, local, new
    r(at(12, 15), "spotify:track:X", "X", "Other"),   // afternoon
    { s: at(12, 16), ms: 1000, u: "spotify:track:X", n: "X", a: "Other", al: "", src: "live" }, // a skip, ignored
  ];
  const from = at(5, 0), to = at(20, 0);
  const w = C.wrapped(recs, from, to, C.stats(recs, from, to), to);
  assert.equal(w.first.n, "Old");
  assert.equal(w.localShare, 3 / 5);
  assert.equal(w.localSongs[0].n, "Leak");
  assert.deepEqual(w.discoveries.map(s => s.n), ["Leak"]);
  assert.deepEqual([w.artists[0].a, w.artists[0].songs, w.artists[0].top[0].n], ["Juice WRLD", 2, "Leak"]);
  assert.equal(w.album.top[0].n, "Leak");
  assert.deepEqual(w.audioDay.map(b => b.top?.n ?? null), ["Old", "X", null, "Leak"]);
  assert.equal(w.peakHour, 23);
  assert.deepEqual(w.topDays.map(d => d.day), ["2026-03-11", "2026-03-10", "2026-03-12"]);
  assert.deepEqual([w.daysListened, w.daysInRange], [3, 15]);
  assert.equal(w.firstPlay.get(L), at(11, 23));
  assert.deepEqual([w.race.unit, w.race.frames.length], ["week", 3]); // 15 days: weekly race
  assert.equal(C.wrapped(recs, -Infinity, Infinity, C.stats(recs)).discoveries, null); // nothing earlier to compare with
});

test("wrapped: a rolling 15-day window counts 15 days, not the 16 dates it touches", () => {
  const from = new Date(2026, 2, 5, 10).getTime(), to = new Date(2026, 2, 20, 10).getTime();
  const recs = Array.from({ length: 16 }, (_, i) => ({ s: from + i * 86400000 - 3600000 * (i === 15 ? 2 : 0), ms: 60000, u: "x", n: "S", a: "A", al: "", src: "live" }));
  const w = C.wrapped(recs, from, to, C.stats(recs, from, to), to);
  assert.deepEqual([w.daysInRange, w.daysListened], [15, 15]);
});

test("wrapped race: monthly running totals, top 5 per frame", () => {
  const m = (mo, a, n = 1) => Array.from({ length: n }, (_, i) => ({ s: new Date(2026, mo, 10, 12, i).getTime(), ms: 60000, u: a, n: a, a, al: "", src: "live" }));
  const recs = [...m(0, "A", 3), ...m(1, "B", 5), ...m(2, "C", 1), ...m(3, "B", 1)];
  const from = new Date(2026, 0, 1).getTime(), to = new Date(2026, 4, 1).getTime();
  const w = C.wrapped(recs, from, to, C.stats(recs, from, to), to);
  assert.equal(w.race.unit, "month");
  assert.equal(w.race.frames.length, 4);
  assert.deepEqual(w.race.frames[0].top.map(x => x.a), ["A"]);
  assert.deepEqual(w.race.frames[1].top.map(x => [x.a, x.ms / 60000]), [["B", 5], ["A", 3]]);
  assert.deepEqual(w.race.frames[3].top.map(x => [x.a, x.ms / 60000]), [["B", 6], ["A", 3], ["C", 1]]);
  const wk = to - 7 * 86400000;
  assert.equal(C.wrapped(recs, wk, to, C.stats(recs, wk, to), to), null); // no plays in the last week
});

test("personality: strongest habit wins, weak signals give the all-rounder", () => {
  const st = o => ({ ms: 100, plays: 100, uniqueSongs: 50, uniqueArtists: 5, hours: new Array(24).fill(100 / 24), topArtists: [{ a: "Juice WRLD", ms: 20 }], ...o });
  assert.equal(C.personality(st(), 0.6).name, "The Vault Digger");
  assert.equal(C.personality(st({ topArtists: [{ a: "Juice WRLD", ms: 70 }] }), 0).name, "The Loyalist");
  assert.equal(C.personality(st({ uniqueSongs: 4 }), 0).name, "The Replayer");
  assert.equal(C.personality(st(), 0).name, "The All-Rounder");
});

test("stats: range filter, top songs, streak", () => {
  const day = d => Date.parse(`2026-03-0${d}T15:00:00`);
  const r = (d, u) => ({ s: day(d), ms: 60000, u, n: u, a: "Art", al: "Alb", src: "live" });
  const recs = [r(1, "a"), r(2, "a"), r(3, "b"), r(5, "a")];
  const s = C.stats(recs);
  assert.equal(s.topSongs[0].n, "a");
  assert.equal(s.topSongs[0].plays, 3);
  assert.deepEqual(s.streak, { days: 3, from: "2026-03-01", to: "2026-03-03" });
  assert.equal(C.stats(recs, day(2), day(4)).plays, 2);
  assert.equal(s.hours[15], 240000);
});
