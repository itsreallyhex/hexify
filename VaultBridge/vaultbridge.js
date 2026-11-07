// VaultBridge: the Spotify half of 999 Vault's "Send to Spotify".
//  1. New local files (999 Vault copies them into Spotify's local folder) go to the TOP of one playlist.
//  2. Every local file gets lyrics in Spicy Lyrics: timed from LRCLIB when it has them, else plain from LRCLIB,
//     else plain from juicewrldapi.com (which covers unreleased songs).
//     Lyrics already in Spicy Lyrics (yours, uploaded by hand) are never overwritten.
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
    return close[0] || null;
  }

  // TTML for one LRCLIB record, timed when it can be.
  const ttmlFor = (rec, durationMs) => (rec?.syncedLyrics && lrcToTtml(rec.syncedLyrics, durationMs)) || (rec?.plainLyrics && plainToTtml(rec.plainLyrics)) || null;

  // juicewrldapi.com fallback (plain lyrics for unreleased songs LRCLIB lacks): the entry whose name or other names
  // match the title once versions, features and punctuation are stripped. Same matching as 999 Vault's album lookup.
  const nameKey = s => searchTitle(s).toLowerCase().replace(/[^a-z0-9]/g, "");
  const version = s => (String(s || "").match(/[[(]v(\d+(?:\.\d+)?)[\])]/i) || [])[1] || "";
  function pickJwLyrics(results, title) {
    const want = nameKey(title);
    if (want.length < 3) return null;
    const hits = (results || []).filter(r => (r.lyrics || "").trim() && [r.name, ...(r.track_titles || [])].some(n => nameKey(n) === want));
    const same = hits.find(r => version(r.name) && version(r.name) === version(title));
    return (same || hits[0])?.lyrics || null;
  }

  // Local tracks not seen before, newest first (so the newest lands at the very top).
  const newTracks = (tracks, known) =>
    tracks.filter(t => t.uri && !known.has(t.uri)).sort((a, b) => Date.parse(b.addedAt || 0) - Date.parse(a.addedAt || 0));

  return { parseLrc, lrcToTtml, plainToTtml, searchTitle, pickLyrics, pickJwLyrics, ttmlFor, newTracks, clock };
})();
if (typeof module !== "undefined") module.exports = VaultBridgeCore;

(function vaultBridge() {
  if (typeof window === "undefined") return; // loaded by the tests
  const S = window.Spicetify;
  if (!S?.Platform?.LocalFilesAPI || !S.Platform.PlaylistAPI || !S.LocalStorage) return setTimeout(vaultBridge, 500);
  const C = VaultBridgeCore;

  const TARGET = "spotify:playlist:1yc0GaeanK6F5n7poZs3gR"; // "idk", where new songs go (top)
  const KNOWN = "vaultbridge:known";    // local URIs already seen
  const MISSED = "vaultbridge:nolyrics"; // URI -> when LRCLIB last had nothing
  const RETRY_MS = 14 * 86400000;
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
    return { keys: () => req("readonly", s => s.getAllKeys()), put: (uri, ttml) => req("readwrite", s => s.put(ttml, uri)), close: () => db.close() };
  }

  async function lrclib(t) {
    const title = t.name, artist = t.artists?.[0]?.name || "", sec = Math.round((t.duration?.milliseconds || 0) / 1000);
    const q = new URLSearchParams({ track_name: title, artist_name: artist, album_name: t.album?.name || "", duration: String(sec) });
    try {
      const r = await fetch(`${LRCLIB}/get?${q}`);
      if (r.ok) { const rec = await r.json(); if (C.pickLyrics([rec], sec)) return rec; }
    } catch {}
    const s = new URLSearchParams({ track_name: C.searchTitle(title), artist_name: artist });
    try {
      const r = await fetch(`${LRCLIB}/search?${s}`);
      if (r.ok) return C.pickLyrics(await r.json(), sec);
    } catch {}
    return null;
  }

  async function jwLyrics(t) {
    try {
      const r = await fetch(`https://juicewrldapi.com/juicewrld/songs/?search=${encodeURIComponent(C.searchTitle(t.name))}`);
      if (r.ok) return C.pickJwLyrics((await r.json()).results, t.name);
    } catch {}
    return null;
  }

  let lyricsRunning = false;
  async function fillLyrics(tracks) {
    if (lyricsRunning) return;
    lyricsRunning = true;
    let store;
    try {
      store = await lyricsStore();
      if (!store) return;
      const have = new Set(await store.keys());
      const missed = readJson(MISSED, {});
      const todo = tracks.filter(t => !have.has(t.uri) && !(missed[t.uri] > Date.now() - RETRY_MS));
      let added = 0;
      for (const t of todo) {
        const rec = await lrclib(t);
        let ttml = C.ttmlFor(rec, t.duration?.milliseconds || 0);
        if (!ttml) ttml = C.plainToTtml(await jwLyrics(t)); // unreleased songs: plain lyrics from juicewrldapi.com
        if (ttml) { await store.put(t.uri, ttml); added++; delete missed[t.uri]; }
        else missed[t.uri] = Date.now();
        S.LocalStorage.set(MISSED, JSON.stringify(missed));
        await sleep(400); // be gentle with LRCLIB
      }
      if (added) log(`lyrics added for ${added} local song(s)`);
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
