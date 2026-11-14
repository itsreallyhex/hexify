// Passes the playing song from Spotify (Hexglass/theme.js) to Hexglass Desktop (Hexglass/Desktop), the app that
// draws it behind the desktop icons. Keeps only the latest song, so an app that (re)connects gets it straight away.
"use strict";

function start() {
  const apps = new Set();
  let song = null; // { uri, title, artist, cover, lines, ms, playing, at }
  let closed = false; // Spotify is gone: an app that (re)connects is told to quit
  const write = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const all = (event, data) => { for (const r of apps) write(r, event, data); };
  const current = () => ({ ...song, ms: song.playing ? song.ms + (Date.now() - song.at) : song.ms, at: undefined });

  return {
    connect(req, res) {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      res.write(": open\n\n");
      apps.add(res);
      if (closed) write(res, "quit", {});
      else if (song) write(res, "song", current());
      req.on("close", () => apps.delete(res));
    },
    // { uri, title, artist, cover: base64 image, lines: null, ms, playing }
    song(s) {
      song = { ...s, at: Date.now() };
      all("song", s);
    },
    // { uri, ms, playing, lines?: [{ t, text }] }
    state(s) {
      if (!song || s.uri !== song.uri) return false;
      Object.assign(song, { ms: s.ms, playing: s.playing, at: Date.now() });
      if (Array.isArray(s.lines)) song.lines = s.lines;
      all("state", s);
    },
    clear() {
      if (!song) return;
      song = null;
      all("clear", {});
    },
    open() { closed = false; },
    quit() {
      closed = true;
      song = null;
      all("quit", {});
    },
  };
}

module.exports = { start };
