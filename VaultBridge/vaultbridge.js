// VaultBridge: the Spotify half of 999 Vault's "Send to Spotify".
//  1. New local files (999 Vault copies them into Spotify's local folder) go to the TOP of one playlist.
//  2. Every local file gets lyrics in Spicy Lyrics: timed from juicewrldapi.com (Juice WRLD, same version and length),
//     else timed from LRCLIB, else plain from LRCLIB, else plain from juicewrldapi.com.
//     juicewrldapi's timed lyrics replace anything, even your own uploads (kept in vaultbridge:replaced); the other
//     sources only fill empty slots or replace what VaultBridge wrote. Each song is looked at again every 14 days.
// The pure parts (core) are tested with (from VaultBridge/): node --test test/core.test.js

var VaultBridgeCore = (() => {
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const clock = ms => {
    const t = Math.max(0, Math.round(ms));
    const h = Math.floor(t / 3600000), m = Math.floor((t % 3600000) / 60000), s = Math.floor((t % 60000) / 1000), f = t % 1000;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(f).padStart(3, "0")}`;
  };
  const doc = (timing, body) =>
    `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="${timing}"><head><metadata/></head><body><div>${body}</div></body></tt>`;

  // "[01:02.34]line" (several stamps per line allowed) -> [{ at: ms, text }], sorted. Tags like [ar:...] are skipped.
  function parseLrc(lrc) {
    const out = [];
    for (const raw of String(lrc || "").split(/\r?\n/)) {
      const stamps = [...raw.matchAll(/\[(\d+):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)];
      if (!stamps.length) continue;
      const text = raw.replace(/\[[^\]]*\]/g, "").trim();
      for (const m of stamps) {
        const frac = m[3] ? Number(m[3].padEnd(3, "0")) : 0;
        out.push({ at: Number(m[1]) * 60000 + Number(m[2]) * 1000 + frac, text });
      }
    }
    return out.sort((a, b) => a.at - b.at);
  }

  // Line-synced TTML. A line ends where the next one (or a blank gap line) starts; the last one 4s later, capped at the song's end.
  function lrcToTtml(lrc, durationMs = 0) {
    const lines = parseLrc(lrc);
    const ps = [];
    lines.forEach((l, i) => {
      if (!l.text) return;
      let end = i + 1 < lines.length ? lines[i + 1].at : l.at + 4000;
      if (durationMs && end > durationMs) end = Math.max(durationMs, l.at + 500);
      if (end <= l.at) end = l.at + 500;
      ps.push(`<p begin="${clock(l.at)}" end="${clock(end)}">${esc(l.text)}</p>`);
    });
    return ps.length ? doc("Line", ps.join("")) : null;
  }

  function plainToTtml(text) {
    const ps = String(text || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(s => `<p>${esc(s)}</p>`);
    return ps.length ? doc("None", ps.join("")) : null;
  }

  // For LRCLIB's search: no version tags, features or brackets. "Bandit (v5) [feat. X]" -> "Bandit"
  const searchTitle = s => String(s || "").replace(/\[[^\]]*\]|\([^)]*\)/g, " ").replace(/\b(feat|ft|with)\.?\s.*$/i, "").replace(/\s+/g, " ").trim();

  // Best LRCLIB record for a song of `durationSec`: timed beats plain, then closest length; nothing more than 10s off.
  function pickLyrics(results, durationSec) {
    const usable = (results || []).filter(r => !r.instrumental && (r.syncedLyrics || r.plainLyrics));
    const off = r => (durationSec && r.duration ? Math.abs(r.duration - durationSec) : 0);
    const close = usable.filter(r => off(r) <= 10);
    close.sort((a, b) => (!!b.syncedLyrics - !!a.syncedLyrics) || off(a) - off(b));
    const best = close[0];
    if (!best) return null;
    // The same timestamps filed more often under a length far from this song: copied from another take, so words only.
    // (One 331 s "Tales Of The Toxic" carries the timing of fifteen 156 s copies, which runs out halfway.)
    const stamps = r => parseLrc(r.syncedLyrics).map(l => l.at).join(","); // copies differ in spelling, not timing
    const twins = best.syncedLyrics ? usable.filter(r => r.syncedLyrics && r.duration && stamps(r) === stamps(best)) : [];
    const copied = durationSec && twins.filter(r => Math.abs(r.duration - durationSec) > 10).length > twins.filter(r => Math.abs(r.duration - durationSec) <= 10).length;
    return copied ? { ...best, syncedLyrics: null, plainLyrics: best.plainLyrics || parseLrc(best.syncedLyrics).map(l => l.text).join("\n") } : best;
  }

  // TTML for one LRCLIB record, timed when it can be.
  const ttmlFor = (rec, durationMs) => (rec?.syncedLyrics && lrcToTtml(rec.syncedLyrics, durationMs)) || (rec?.plainLyrics && plainToTtml(rec.plainLyrics)) || null;

  // juicewrldapi.com record for a title: the entry whose name or other names match once versions, features and
  // punctuation are stripped (same matching as 999 Vault's album lookup). Only the same version when the vault has
  // it, since each version has its own timing; timed lyrics (synced_lyrics) beat plain ones.
  const nameKey = s => searchTitle(s).toLowerCase().replace(/[^a-z0-9]/g, "");
  const version = s => (String(s || "").match(/[[(]v(\d+(?:\.\d+)?)[\])]/i) || [])[1] || "";
  const has = s => !!String(s || "").trim();
  // "3:04" or "1:02:03" -> seconds; 0 when unknown.
  const lengthSec = s => (/^\d+(:\d{1,2})+$/.test(String(s || "").trim()) ? String(s).trim().split(":").reduce((a, n) => a * 60 + Number(n), 0) : 0);
  // An entry fits the song when its listed length is within 10 s, or unknown. Otherwise it's another take (a 5:32
  // session vs the 2:35 song): its words may still help, its timing won't.
  const jwFits = (r, sec) => !sec || !lengthSec(r?.length) || Math.abs(lengthSec(r.length) - sec) <= 10;
  function pickJw(results, title, sec = 0) {
    const want = nameKey(title);
    if (want.length < 3) return null;
    const hits = (results || []).filter(r => (has(r.lyrics) || has(r.synced_lyrics)) && [r.name, ...(r.track_titles || [])].some(n => nameKey(n) === want));
    const same = hits.filter(r => version(r.name) && version(r.name) === version(title));
    const pool = same.length ? same : hits;
    const rank = r => (jwFits(r, sec) ? 0 : 2) + (has(r.synced_lyrics) ? 0 : 1);
    return [...pool].sort((a, b) => rank(a) - rank(b))[0] || null;
  }
  // An entry's words without timing, from its plain text or else its timed one.
  const jwPlain = r => (r ? r.lyrics || parseLrc(r.synced_lyrics).map(l => l.text).join("\n") : "");

  // Lyrics VaultBridge wrote itself (exactly our header). Anything else in the store is someone's own upload.
  const OUR_HEAD = doc("None", "").split("itunes:timing=")[0];
  const ours = ttml => typeof ttml === "string" && ttml.startsWith(OUR_HEAD);

  // What to store for a song, or null to leave it. juicewrldapi's fitting timed lyrics replace anything, even your own
  // uploads (the most trusted source); the best other lyrics only fill an empty slot or replace VaultBridge's own.
  function choose(current, jwTimed, other) {
    const next = jwTimed || (current == null || ours(current) ? other : null);
    return next && next !== current ? next : null;
  }

  // Local tracks not seen before, newest first (so the newest lands at the very top).
  const newTracks = (tracks, known) =>
    tracks.filter(t => t.uri && !known.has(t.uri)).sort((a, b) => Date.parse(b.addedAt || 0) - Date.parse(a.addedAt || 0));

  return { parseLrc, lrcToTtml, plainToTtml, searchTitle, pickLyrics, pickJw, jwFits, jwPlain, lengthSec, ours, choose, ttmlFor, newTracks, clock };
})();
if (typeof module !== "undefined") module.exports = VaultBridgeCore;

(function vaultBridge() {
  if (typeof window === "undefined") return; // loaded by the tests
  const S = window.Spicetify;
  if (!S?.Platform?.LocalFilesAPI || !S.Platform.PlaylistAPI || !S.LocalStorage) return setTimeout(vaultBridge, 500);
  const C = VaultBridgeCore;

  const TARGET = "spotify:playlist:1yc0GaeanK6F5n7poZs3gR"; // "idk", where new songs go (top)
  const KNOWN = "vaultbridge:known";    // local URIs already seen
  const CHECKED = "vaultbridge:checked2";  // URI -> when its lyrics were last looked up; renamed when the rules change, so every song is redone once
  const REPLACED = "vaultbridge:replaced"; // URI -> your own upload that juicewrldapi replaced, to put back by hand
  const RETRY_MS = 14 * 86400000;
  ["vaultbridge:nolyrics", "vaultbridge:nolyrics2", "vaultbridge:checked"].forEach(k => S.LocalStorage.remove?.(k)); // older keys
  const LRCLIB = "https://lrclib.net/api";
  const log = (...a) => console.log("[vaultbridge]", ...a);
  const readJson = (k, d) => { try { return JSON.parse(S.LocalStorage.get(k) || "null") ?? d; } catch { return d; } };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ---- 1. new local files -> top of the playlist ----
  async function placeNew(tracks) {
    const stored = readJson(KNOWN, null);
    if (!stored) { // first run: everything already there counts as seen, nothing is moved
      S.LocalStorage.set(KNOWN, JSON.stringify(tracks.map(t => t.uri)));
      return;
    }
    const known = new Set(stored);
    const fresh = C.newTracks(tracks, known);
    if (!fresh.length) return;
    const inList = new Set(((await S.Platform.PlaylistAPI.getContents(TARGET, { limit: 5000 }))?.items || []).map(i => i.uri));
    const add = fresh.filter(t => !inList.has(t.uri)).map(t => t.uri);
    if (add.length) {
      await S.Platform.PlaylistAPI.add(TARGET, add, { before: "start" });
      S.showNotification?.(`Added ${add.length} new song${add.length === 1 ? "" : "s"} to the top of idk`);
      log("added to top:", add);
    }
    fresh.forEach(t => known.add(t.uri));
    S.LocalStorage.set(KNOWN, JSON.stringify([...known]));
  }

  // ---- 2. lyrics into Spicy Lyrics' own store ----
  // Spicy Lyrics reads a local file's lyrics from IndexedDB "spicylyrics" / "lyricsStore", key = the track URI,
  // value = a TTML string (what its "Upload TTML" button writes). Only used if Spicy Lyrics made that database.
  async function lyricsStore() {
    const dbs = (await indexedDB.databases?.()) || [];
    if (!dbs.some(d => d.name === "spicylyrics")) return null;
    const db = await new Promise((ok, bad) => { const r = indexedDB.open("spicylyrics"); r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error); });
    if (!db.objectStoreNames.contains("lyricsStore")) { db.close(); return null; }
    const req = (mode, fn) => new Promise((ok, bad) => { const r = fn(db.transaction("lyricsStore", mode).objectStore("lyricsStore")); r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error); });
    return {
      all: () => Promise.all([req("readonly", s => s.getAllKeys()), req("readonly", s => s.getAll())]), // same key order
      put: (uri, ttml) => req("readwrite", s => s.put(ttml, uri)),
      close: () => db.close(),
    };
  }

  // Both lookups throw when the site can't be reached, so a song is never re-judged (and downgraded) on a failed one.
  async function lrclib(t) {
    const title = t.name, artist = t.artists?.[0]?.name || "", sec = Math.round((t.duration?.milliseconds || 0) / 1000);
    const q = new URLSearchParams({ track_name: title, artist_name: artist, album_name: t.album?.name || "", duration: String(sec) });
    const g = await fetch(`${LRCLIB}/get?${q}`); // a miss here is normal (404); the search below decides
    if (g.ok) { const rec = await g.json(); if (C.pickLyrics([rec], sec)) return rec; }
    const s = await fetch(`${LRCLIB}/search?${new URLSearchParams({ track_name: C.searchTitle(title), artist_name: artist })}`);
    if (!s.ok) throw new Error(`lrclib ${s.status}`);
    return C.pickLyrics(await s.json(), sec);
  }

  async function jwRecord(t, sec) {
    if (!t.artists?.some(a => /juice wrld/i.test(a.name || ""))) return null; // another artist's song of the same name
    const r = await fetch(`https://juicewrldapi.com/juicewrld/songs/?search=${encodeURIComponent(C.searchTitle(t.name))}`);
    if (!r.ok) throw new Error(`juicewrldapi ${r.status}`);
    return C.pickJw((await r.json()).results, t.name, sec);
  }

  let lyricsRunning = false;
  async function fillLyrics(tracks) {
    if (lyricsRunning) return;
    lyricsRunning = true;
    let store;
    try {
      store = await lyricsStore();
      if (!store) return;
      const [keys, values] = await store.all();
      const saved = new Map(keys.map((k, i) => [k, values[i]]));
      const checked = readJson(CHECKED, {});
      const replaced = readJson(REPLACED, {});
      const todo = tracks.filter(t => !(checked[t.uri] > Date.now() - RETRY_MS));
      let changed = 0;
      for (const t of todo) {
        const ms = t.duration?.milliseconds || 0, sec = Math.round(ms / 1000);
        let next;
        try {
          const jw = await jwRecord(t, sec);
          const jwTimed = jw?.synced_lyrics && C.jwFits(jw, sec) ? C.lrcToTtml(jw.synced_lyrics, ms) : null;
          const other = jwTimed ? null : C.ttmlFor(await lrclib(t), ms) || C.plainToTtml(C.jwPlain(jw));
          next = C.choose(saved.get(t.uri), jwTimed, other);
        } catch (e) {
          log("lookup failed, trying again later:", t.name, e.message);
          break; // offline or rate-limited: the rest waits for the next round
        }
        const cur = saved.get(t.uri);
        if (next) {
          if (cur != null && !C.ours(cur)) { replaced[t.uri] = cur; S.LocalStorage.set(REPLACED, JSON.stringify(replaced)); }
          await store.put(t.uri, next);
          changed++;
        }
        checked[t.uri] = Date.now();
        S.LocalStorage.set(CHECKED, JSON.stringify(checked));
        await sleep(400); // be gentle with LRCLIB
      }
      if (changed) log(`lyrics saved for ${changed} local song(s)`);
    } catch (e) {
      console.error("[vaultbridge] lyrics", e);
    } finally {
      store?.close();
      lyricsRunning = false;
    }
  }

  async function tick() {
    try {
      const tracks = await S.Platform.LocalFilesAPI.getTracks();
      await placeNew(tracks);
      fillLyrics(tracks); // runs on in the background
    } catch (e) {
      console.error("[vaultbridge]", e);
    }
  }
  setTimeout(tick, 15000);
  setInterval(tick, 30000);
  window.__vaultbridge = { tick, core: C };
})();
