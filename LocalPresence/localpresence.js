// LocalPresence: a Discord status with the real cover while a local file plays.
// Discord gets Spotify's own status from Spotify's servers, which have no cover for a local file ("?"). So while a
// local file plays, Spotify's private session is on (switched on one song early: it never clears a status already
// sent) and the helper (helper/helper.js) shows our own status through 999 Vault's Discord app instead.
// Streamed songs are untouched. A private session Hex turned on is never touched.
// The pure parts (core) are tested with (from LocalPresence/): node --test test/core.test.js

var LocalPresenceCore = (() => {
  const isLocal = uri => String(uri || "").startsWith("spotify:local:");

  // One step of the private-session rule. cur / next: the playing / next track is local. on: private session is on
  // now. ours: we turned it on. positionMs: how far into the playing track. Returns { set: true | false | null, ours }.
  // A streamed song plays its first seconds with private session off, so Spotify sends it to Discord (on hides it,
  // and later switching on does not take it down); only then is it armed for a local next song.
  const ARM_AFTER_MS = 8000;
  function privateStep({ cur, next, on, ours, positionMs = Infinity }) {
    const want = cur || (next && positionMs >= ARM_AFTER_MS);
    if (want && !on) return { set: true, ours: true };
    if (!want && on && ours) return { set: false, ours: false };
    return { set: null, ours: on && ours };
  }

  // Whose private session it is after Spotify reports it. wasOn: last report (null: this is the first, at start).
  // mine: the value we just set, still on its way back. Already on at start: nobody can tell who switched it on (a
  // saved flag got lost when Spotify was killed), so it counts as ours and goes off by itself. Switched on while
  // Spotify runs and not by us: Hex's, left alone.
  function reported({ wasOn, v, mine, ours }) {
    if (wasOn === null) return v;
    if (v && !wasOn && mine !== true) return false;
    return ours;
  }

  // What the helper should show for the playing track, or null (nothing local playing).
  function shown(item, { positionMs = 0, durationMs = 0, paused = false, now = Date.now(), image = null } = {}) {
    if (!item || !isLocal(item.uri)) return null;
    const start = Math.round(now - positionMs);
    return {
      title: item.name || "",
      artist: (item.artists || []).map(a => a.name).filter(Boolean).join(", "),
      album: item.album?.name || "",
      image,
      paused: !!paused,
      startMs: paused ? null : start,
      endMs: paused || !durationMs ? null : start + Math.round(durationMs),
    };
  }

  // Same status, give or take the clock jitter of reading the position (a seek moves it by more).
  const same = (a, b) => {
    if (!a || !b) return a === b;
    const near = (x, y) => (x === null || y === null ? x === y : Math.abs(x - y) < 2000);
    return a.title === b.title && a.artist === b.artist && a.album === b.album && a.image === b.image &&
      a.paused === b.paused && near(a.startMs, b.startMs) && near(a.endMs, b.endMs);
  };

  // "Bandit (v5) [feat. X]" -> "Bandit", for searching (same as VaultBridge's).
  const searchTitle = s => String(s || "").replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g, " ").replace(/\b(feat|ft|with)\.?\s.*$/i, "").replace(/\s+/g, " ").trim();
  const key = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const biggest = sources => [...(sources || [])].sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url || null;

  // Cover from Spotify search results (searchV2.topResultsV2.itemsV2): a track of that name by that artist, else the
  // artist's photo, else null. Only https images: Discord fetches the URL itself.
  function pickSearchImage(items, title, artist) {
    const t = key(searchTitle(title)), a = key(String(artist || "").split(",")[0]);
    const data = (items || []).map(i => i?.item?.data).filter(Boolean);
    const track = data.find(d => d.__typename === "Track" && key(searchTitle(d.name)) === t &&
      (d.artists?.items || []).some(x => key(x.profile?.name) === a));
    const singer = data.find(d => d.__typename === "Artist" && key(d.profile?.name) === a);
    const url = (track && biggest(track.albumOfTrack?.coverArt?.sources)) || (singer && biggest(singer.visuals?.avatarImage?.sources));
    return url && url.startsWith("https://") ? url : null;
  }

  return { isLocal, privateStep, reported, shown, same, searchTitle, pickSearchImage };
})();
if (typeof module !== "undefined") module.exports = LocalPresenceCore;

(function localPresence() {
  if (typeof window === "undefined") return; // loaded by the tests
  const S = window.Spicetify;
  const PS = S?.Platform?.PrivateSessionAPI;
  if (!S?.Player?.addEventListener || !S.Player.data || !S.Queue || !S.LocalStorage || !S.GraphQL?.Definitions || !PS) return setTimeout(localPresence, 300);
  const C = LocalPresenceCore;

  const HELPER = "http://127.0.0.1:47999/presence";
  const log = (...a) => console.log("[localpresence]", ...a);
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  let on = null; // private session, as Spotify last reported it
  let ours = false; // the private session is one we may switch off
  let mine = null; // the value we last set, until Spotify reports it back
  let sent = null; // last status sent to the helper
  let busy = false;

  const covers = new Map(); // uri -> Promise<url | null>, for the session
  function cover(item) {
    if (!covers.has(item.uri)) {
      const artist = item.artists?.[0]?.name || "";
      covers.set(item.uri, S.GraphQL.Request(S.GraphQL.Definitions.searchModalResults, {
        searchTerm: `${C.searchTitle(item.name)} ${artist}`.trim(), offset: 0, limit: 10, numberOfTopResults: 10,
        includeAudiobooks: false, includeArtistHasConcertsField: false, includePreReleases: false, includeLocalConcertsField: false, includeAuthors: false,
      }).then(r => C.pickSearchImage(r?.data?.searchV2?.topResultsV2?.itemsV2, item.name, artist)).catch(() => null));
    }
    return Promise.race([covers.get(item.uri), sleep(4000).then(() => null)]);
  }

  // Held open so the helper knows Spotify is still here (closing Spotify drops it). Opening it sends the current
  // status again. EventSource gives up for good after some failed reconnects (helper restarting), so every tick
  // opens a new one when it is closed.
  let es = null;
  function keepAlive() {
    if (es && es.readyState !== EventSource.CLOSED) return;
    es = new EventSource(HELPER.replace("/presence", "/alive"));
    es.onopen = () => tick();
  }

  // The helper not running is normal (nothing shows); the fetch just fails.
  const post = body => fetch(HELPER, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) }).catch(() => {});

  let again = false;
  async function tick() {
    if (busy) { again = true; return; } // a song change mid-tick runs right after, not 5 s later
    busy = true;
    try {
      keepAlive();
      const item = S.Player.data?.item;
      const cur = C.isLocal(item?.uri);
      const next = C.isLocal(S.Queue.nextTracks?.[0]?.contextTrack?.uri);

      if (on !== null) {
        const step = C.privateStep({ cur, next, on, ours, positionMs: S.Player.getProgress() || 0 });
        ours = step.ours;
        if (step.set !== null) {
          log("private session", step.set ? "on" : "off");
          on = mine = step.set;
          await PS.setPrivateSession(step.set);
        }
      }

      const now = C.shown(item, {
        positionMs: S.Player.getProgress() || 0, durationMs: S.Player.getDuration() || 0,
        paused: !S.Player.isPlaying(), image: cur ? await cover(item) : null,
      });
      const was = sent;
      if (!C.same(now, sent)) sent = now;
      // Resent every tick while something shows (the helper clears the status once Spotify goes quiet); "nothing" once.
      if (sent || was) post(sent);
    } catch (e) {
      log("tick failed", e);
    } finally {
      busy = false;
      if (again) { again = false; tick(); }
    }
  }

  // Our own switch comes back here too; tick() then has nothing to change.
  PS.subscribeToPrivateSession(v => {
    ours = C.reported({ wasOn: on, v: !!v, mine, ours });
    on = !!v;
    mine = null;
    tick();
  });
  S.Player.addEventListener("songchange", tick);
  S.Player.addEventListener("onplaypause", tick);
  setInterval(tick, 5000); // catches seeks and queue edits (the next track turning local)
  keepAlive();
  window.__localpresence = { tick, core: C, state: () => ({ on, ours, sent, alive: es?.readyState }) }; // alive: 0 connecting, 1 open, 2 closed
})();
