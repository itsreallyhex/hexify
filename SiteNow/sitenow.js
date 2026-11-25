// SiteNow: tells my site what Spotify is playing, after 15 seconds of a song.
const SiteNowCore = (() => {
  const SEND_AFTER = 15000; // skipping through songs sends nothing
  const DRIFT = 5000; // a seek bigger than this is sent again

  const isLocal = uri => String(uri || "").startsWith("spotify:local:");

  function coverUrl(item) {
    const m = item?.metadata || {};
    const raw = m.image_xlarge_url || m.image_large_url || m.image_url || item?.album?.images?.[0]?.url || item?.images?.[0]?.url || "";
    const id = String(raw).match(/^spotify:image:([0-9a-f]+)$/i);
    if (id) return "https://i.scdn.co/image/" + id[1];
    return /^https:\/\//.test(raw) ? raw : null;
  }

  // What the site gets. Local files have no web cover; the site finds one for Juice WRLD songs.
  function song(item, { positionMs, durationMs, playing }) {
    if (!item?.name) return null;
    return {
      title: item.name,
      artist: (item.artists || []).map(a => a.name).filter(Boolean).join(", "),
      cover: isLocal(item.uri) ? null : coverUrl(item),
      duration_ms: durationMs || 0,
      position_ms: positionMs || 0,
      playing: !!playing,
    };
  }

  // One check of the player. Returns the next state and whether to send now.
  function step(state, { uri, positionMs, playing, now }) {
    let s = state.uri === uri ? { ...state } : { uri, sent: false };
    if (!uri) return { state: s, send: false };
    const mark = () => ({ ...s, sent: true, sentPlaying: playing, sentPos: positionMs, sentAt: now });
    if (!s.sent) return playing && positionMs >= SEND_AFTER ? { state: mark(), send: true } : { state: s, send: false };
    const expected = s.sentPlaying ? s.sentPos + (now - s.sentAt) : s.sentPos;
    if (playing !== s.sentPlaying || Math.abs(expected - positionMs) > DRIFT) return { state: mark(), send: true };
    return { state: s, send: false };
  }

  function newToken(random) {
    return Array.from(random(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
  }

  return { isLocal, coverUrl, song, step, newToken, SEND_AFTER };
})();
if (typeof module !== "undefined") module.exports = SiteNowCore;

(function siteNow() {
  if (typeof window === "undefined") return; // loaded by the tests
  const S = window.Spicetify;
  if (!S?.Player?.addEventListener || !S.Player.data || !S.LocalStorage || !S.Menu || !S.PopupModal) return setTimeout(siteNow, 300);
  const C = SiteNowCore;

  const ENDPOINT = "https://itsreallyhex.pages.dev/api/now";
  const K_TOKEN = "sitenow:token";
  const K_OFF = "sitenow:off";
  const log = (...a) => console.log("[sitenow]", ...a);

  let token = S.LocalStorage.get(K_TOKEN);
  const fresh = !token;
  if (fresh) {
    token = C.newToken(a => crypto.getRandomValues(a));
    S.LocalStorage.set(K_TOKEN, token);
  }
  let off = S.LocalStorage.get(K_OFF) === "1";
  let state = {};

  // The site being down or not set up yet just means nothing shows there.
  const post = body => fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify(body),
  }).then(r => { if (r.status === 401) log("the site doesn't know this token yet: add it as PUSH_TOKEN"); }).catch(() => {});

  function tick() {
    if (off) return;
    const item = S.Player.data?.item;
    const positionMs = S.Player.getProgress() || 0;
    const playing = S.Player.isPlaying();
    const r = C.step(state, { uri: item?.uri || null, positionMs, playing, now: Date.now() });
    state = r.state;
    if (!r.send) return;
    const body = C.song(item, { positionMs, durationMs: S.Player.getDuration() || 0, playing });
    if (body) post(body);
  }

  function showToken() {
    const box = document.createElement("div");
    box.style.cssText = "display:flex;flex-direction:column;gap:12px;line-height:1.5";
    const p = document.createElement("p");
    p.textContent = "Add this in Cloudflare (Workers & Pages → itsreallyhex → Settings → Variables and secrets) as a Secret named PUSH_TOKEN, then redeploy the site. Keep it private: with it, anyone could change what your site says you're playing.";
    const code = document.createElement("code");
    code.textContent = token;
    code.style.cssText = "user-select:all;word-break:break-all;padding:10px;border-radius:8px;background:rgba(255,255,255,.08)";
    const copy = document.createElement("button");
    copy.textContent = "Copy";
    copy.style.cssText = "align-self:flex-start;padding:8px 16px;border-radius:99px;border:0;font-weight:700;cursor:pointer";
    copy.onclick = () => navigator.clipboard.writeText(token).then(() => { copy.textContent = "Copied"; });
    box.append(p, code, copy);
    S.PopupModal.display({ title: "SiteNow token", content: box });
  }

  new S.Menu.Item("Share what I play on my site", !off, self => {
    off = !off;
    S.LocalStorage.set(K_OFF, off ? "1" : "0");
    self.setState(!off);
    state = {};
    if (off) post({ clear: true }); // the site falls back to Last.fm right away
    else tick();
  }).register();
  new S.Menu.Item("SiteNow token", false, showToken).register();

  S.Player.addEventListener("songchange", tick);
  S.Player.addEventListener("onplaypause", tick);
  setInterval(tick, 3000); // catches the 15-second mark and seeks
  if (fresh) setTimeout(showToken, 2000);
  window.__sitenow = { tick, core: C, state: () => ({ off, state }) };
})();
