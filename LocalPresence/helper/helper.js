// LocalPresence helper: puts the Spotify extension's status on Discord, through 999 Vault's Discord app.
// The extension POSTs what is playing to http://127.0.0.1:47999/presence; this sends it down Discord's local pipe
// (\\?\pipe\discord-ipc-N). The cover: the vault's own when it is a Juice WRLD song in 999's catalogue, else the
// Sessions album's from Last.fm, else what the extension found on Spotify, else none (Discord shows 999's icon).
// No npm dependencies. Run: node helper.js   (starts with Windows from a Startup shortcut, see the README)
"use strict";
const fs = require("fs");
const http = require("http");
const net = require("net");

const PORT = 47999;
const ORIGIN = "https://xpui.app.spotify.com"; // the Spotify page; any other page is refused
const CLIENT_ID = process.env.NINE_DISCORD_ID || "1548116060031680664"; // 999 Vault's app (presence.rs DEFAULT_ID)
const CATALOGUE = require("path").join(__dirname, "..", "..", "..", "juiceapi", "web", "data", "catalogue.json"); // 999 Vault's repo, next to this one
const COVER_CDN = "https://api.juicevault.xyz/cdn/music/covers/";
// The small round picture on the cover's corner, Juice WRLD songs only: Art Assets in 999 Vault's Discord app
// (Developer Portal > Rich Presence > Art Assets), by direct URL: Discord caches an app's asset names per session, so
// a name uploaded after Discord started does not show. Ids: discord.com/api/v10/oauth2/applications/<app>/assets
const JUICE_SMALL = {
  close: "https://cdn.discordapp.com/app-assets/1548116060031680664/1568472535622750259.png", // "juice", assets/juice-face.png
  mid: "https://cdn.discordapp.com/app-assets/1548116060031680664/1568473606411919421.png", // "juice_mid", assets/juice-face-mid.png
  wide: "https://cdn.discordapp.com/app-assets/1548116060031680664/1568472485932961833.png", // "juice_wide", assets/juice-face-wide.png
}.mid;
// Spotify keeps GET /alive open; it dropping (Spotify closed or crashed) takes the status down. Not a heartbeat:
// Chromium throttles a background window's timers to about once a minute.
const SILENT_MS = 150000; // fallback when /alive is not open: no word from Spotify this long (> 2 throttled ticks)
const RETRY_MS = 30000; // after a failed connect, leave Discord alone this long

// Copy of HEXED_ALBUM_ART in Hexed/index.js (Last.fm covers for the Sessions albums); keep the two in step.
const ALBUM_ART = {
  "goodbye & good riddance (sessions)|juice wrld": "https://lastfm-img.freetls.fastly.net/i/u/300x300/ff8591e4ffa5c13f7bb91191f8733ac7.jpg",
  "outsiders (sessions)|juice wrld": "https://lastfm-img.freetls.fastly.net/i/u/300x300/35912a0eaff6ed9f9b9a8e57a9f17cd4.jpg",
  "death race for love (sessions)|juice wrld": "https://lastfm-img.freetls.fastly.net/i/u/300x300/65d8bf225327df3e9edde0d418095785.jpg",
  "wrld on drugs (sessions)|juice wrld": "https://lastfm-img.freetls.fastly.net/i/u/300x300/ea920d57d84dbd4f8a4b29880f48d6ae.jpg",
  "fighting demons (sessions)|juice wrld": "https://lastfm-img.freetls.fastly.net/i/u/300x300/361bf4b81f0038d48d4ef90afc2522f9.jpg",
  "the party never ends (sessions)|juice wrld": "https://lastfm-img.freetls.fastly.net/i/u/300x300/6114e90f259e8f4493a3ca3c34cbe17b.jpg",
};

// ---- pure parts (tested) ----

// Discord IPC frame: op (int32 LE), length (int32 LE), JSON.
function frame(op, obj) {
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

// Whole frames out of what the pipe has delivered so far; the rest waits for more bytes.
function readFrames(buf) {
  const frames = [];
  while (buf.length >= 8) {
    const len = buf.readInt32LE(4);
    if (buf.length < 8 + len) break;
    let data = null;
    try { data = JSON.parse(buf.subarray(8, 8 + len).toString("utf8")); } catch {}
    frames.push({ op: buf.readInt32LE(0), data });
    buf = buf.subarray(8 + len);
  }
  return { frames, rest: buf };
}

const key = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Which vault categories a local album stands for. Albums are tagged by era: "<Era> (Sessions)" for session takes,
// and the fixed names "Instrumentals", "Stem Edits" and "Remasters".
function kindsFor(album) {
  const a = String(album || "").trim().toLowerCase();
  if (a === "instrumentals") return ["instrumental"];
  if (a === "stem edits") return ["stem"];
  if (a === "remasters") return ["remaster"];
  if (a.endsWith("(sessions)")) return ["main", "cut"];
  return ["released"];
}

// The vault cover for a Juice WRLD song: the record whose title or other name is this title, of the album's kind
// when there are several.
function vaultCover(songs, { title, artist, album }) {
  if (!/juice wrld/i.test(artist || "")) return null;
  const want = key(title);
  if (!want) return null;
  const hits = (songs || []).filter(s => s.id && [s.title, ...(s.alt_names || [])].some(n => key(n) === want));
  const kinds = kindsFor(album);
  const best = hits.find(s => kinds.includes(s.category)) || hits[0];
  return best ? COVER_CDN + encodeURIComponent(best.id) : null;
}

const https = u => (typeof u === "string" && u.startsWith("https://") && u.length <= 512 ? u : null);

function coverFor(songs, s) {
  return vaultCover(songs, s) || ALBUM_ART[`${s.album}|${s.artist}`.toLowerCase()] || https(s.image);
}

// Discord wants 2 to 128 characters in each text field.
const text = s => (String(s ?? "").trim() || "?").padEnd(2, "\u2800").slice(0, 128);

// The Listening activity for one status from the extension; null takes it down.
// Under the name in the member list: the artist ("Juice WRLD"), or "Paused", like 999 Vault.
function activity(s, songs) {
  if (!s || typeof s !== "object" || !s.title) return null;
  const a = {
    type: 2, // Listening
    status_display_type: 1, // show `state` under the name
    details: text(s.title),
    state: text(s.paused ? "Paused" : s.artist),
  };
  const image = coverFor(songs, s);
  if (image) a.assets = { large_image: image, large_text: text(s.album || s.title) };
  if (image && /juice wrld/i.test(s.artist || "")) Object.assign(a.assets, { small_image: JUICE_SMALL, small_text: "Juice WRLD" });
  if (!s.paused && Number.isFinite(s.startMs)) {
    a.timestamps = { start: Math.floor(s.startMs / 1000) }; // seconds, as 999 sends them
    if (Number.isFinite(s.endMs)) a.timestamps.end = Math.floor(s.endMs / 1000);
  }
  return a;
}

module.exports = { frame, readFrames, kindsFor, vaultCover, coverFor, activity, ORIGIN };

// ---- the running helper ----

function main() {
  // Also to helper.log: it runs with no window. Started fresh each run.
  const LOG = require("path").join(__dirname, "helper.log");
  try { fs.writeFileSync(LOG, ""); } catch {}
  const log = (...a) => {
    const line = [new Date().toLocaleTimeString(), ...a].join(" ");
    console.log(line);
    try { fs.appendFileSync(LOG, line + "\n"); } catch {}
  };

  // The catalogue, re-read only when 999 rewrites it.
  let cat = { mtime: 0, songs: [] };
  const songs = () => {
    try {
      const m = fs.statSync(CATALOGUE).mtimeMs;
      if (m !== cat.mtime) cat = { mtime: m, songs: JSON.parse(fs.readFileSync(CATALOGUE, "utf8")).songs || [] };
    } catch (e) {
      if (!cat.warned) { log("catalogue not readable, no vault covers:", e.message); cat.warned = true; }
    }
    return cat.songs;
  };

  let pipe = null, ready = false, failedAt = 0;
  let want = null; // the activity that should show
  let shownJson = "null"; // what Discord was last sent
  let heard = 0;
  let alive = 0; // open /alive connections from Spotify

  // Hexglass Desktop (desktop.js): the Spotify page posts the song here, the app listens on /desktop/events.
  const desktop = require("./desktop").start();
  const DESK_ROUTES = { "/desktop/song": "song", "/desktop/state": "state" };
  // The app opens with Spotify and quits once Spotify has been gone this long (a reload reconnects within seconds).
  const DESK_EXE = require("path").join(__dirname, "..", "..", "Hexglass", "Desktop", "bin", "publish", "HexglassDesktop.exe");
  const DESK_GRACE_MS = 15000;
  const deskQuitLater = () => setTimeout(() => { if (!alive) { log("hexglass desktop: quit"); desktop.quit(); } }, DESK_GRACE_MS);
  let deskQuit = deskQuitLater(); // the helper (re)started without Spotify: an app still running goes too
  function deskOpen() {
    clearTimeout(deskQuit);
    desktop.open();
    if (!fs.existsSync(DESK_EXE)) return;
    // A copy already running exits by itself (single-instance mutex), so starting it again is harmless.
    require("child_process").spawn(DESK_EXE, [], { detached: true, stdio: "ignore" })
      .on("error", e => log("hexglass desktop did not start:", e.message)).unref();
  }

  function connect(i = 0) {
    if (i > 9) { failedAt = Date.now(); log("discord not running"); return; }
    const s = net.connect(`\\\\?\\pipe\\discord-ipc-${i}`);
    pipe = s;
    let buf = Buffer.alloc(0);
    s.once("connect", () => s.write(frame(0, { v: 1, client_id: CLIENT_ID })));
    s.on("data", chunk => {
      const r = readFrames(Buffer.concat([buf, chunk]));
      buf = r.rest;
      for (const f of r.frames) {
        if (f.op === 1 && f.data?.evt === "READY") { ready = true; log("discord connected"); push(); }
        else if (f.data?.evt === "ERROR") log("discord refused:", JSON.stringify(f.data.data));
        else if (f.op === 2) { log("discord closed:", JSON.stringify(f.data)); s.destroy(); }
      }
    });
    s.on("error", () => { if (!ready && pipe === s) { pipe = null; s.destroy(); connect(i + 1); } });
    s.on("close", () => { if (pipe === s) { log("discord pipe closed"); pipe = null; ready = false; shownJson = "null"; failedAt = Date.now(); } });
  }

  function push() {
    if (!ready) {
      if (want && !pipe && Date.now() - failedAt > RETRY_MS) connect();
      return;
    }
    const json = JSON.stringify(want);
    if (json === shownJson) return;
    shownJson = json;
    pipe.write(frame(1, { cmd: "SET_ACTIVITY", args: { pid: process.pid, activity: want || undefined }, nonce: String(Date.now()) }));
    log(want ? `show  ${want.details} | ${want.state}${want.assets ? "" : " (no cover)"}` : "clear");
  }

  const cors = {
    "Access-Control-Allow-Origin": ORIGIN,
    "Access-Control-Allow-Methods": "POST",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Private-Network": "true",
  };
  const server = http.createServer((req, res) => {
    const end = code => { res.writeHead(code, cors); res.end(); };
    // The app is a local program, not a page: browsers always send an Origin, so a request without one is no website.
    if (req.method === "GET" && req.url === "/desktop/events" && !req.headers.origin) return desktop.connect(req, res);
    if (req.headers.origin !== ORIGIN) { res.writeHead(403); return res.end(); }
    if (req.method === "OPTIONS") return end(204);
    if (req.method === "GET" && req.url === "/alive") {
      res.writeHead(200, { ...cors, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      res.write(": open\n\n");
      if (++alive === 1) deskOpen();
      log(`alive open (${alive})`);
      req.on("close", () => {
        log(`alive closed (${alive - 1})`);
        if (--alive === 0) {
          desktop.clear(); // the app hides, your own wallpaper shows
          deskQuit = deskQuitLater();
          if (want) { log("spotify gone"); want = null; push(); }
        }
      });
      return;
    }
    const desk = DESK_ROUTES[req.url];
    if (req.method !== "POST" || (req.url !== "/presence" && !desk)) return end(404);
    const limit = desk ? 2e6 : 20000; // the song post carries its cover
    let body = "";
    req.on("data", c => { body += c; if (body.length > limit) req.destroy(); });
    req.on("end", () => {
      let s;
      try { s = JSON.parse(body); } catch { return end(400); }
      if (desk) return end(desktop[desk](s) === false ? 404 : 204); // 404: song unknown, Spotify sends it again
      heard = Date.now();
      const was = want;
      want = activity(s, songs());
      if (was && !want) log("spotify says nothing local is playing");
      push();
      end(204);
    });
  });
  server.on("error", e => {
    if (e.code === "EADDRINUSE") { log(`port ${PORT} in use: already running`); process.exit(0); }
    throw e;
  });
  server.listen(PORT, "127.0.0.1", () => log(`listening on 127.0.0.1:${PORT}`));

  setInterval(() => {
    if (want && !alive && Date.now() - heard > SILENT_MS) { log("spotify quiet"); want = null; }
    push(); // also retries Discord when it was not running
  }, 5000);
}

if (require.main === module) main();
