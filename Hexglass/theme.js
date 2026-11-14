// Pure parts, also loaded by the tests.
var HexglassCore = (() => {
  function hsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    if (!d) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1));
    const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
  }
  function rgb(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return [r, g, b].map(v => Math.round((v + m) * 255));
  }
  // The cover's most vivid colour, made light enough to read on dark glass; null for a grey cover.
  function pickAccent(px) {
    let best = null, top = 0.12;
    for (let i = 0; i < px.length; i += 4) {
      const [h, s, l] = hsl(px[i], px[i + 1], px[i + 2]);
      const score = s * (1 - Math.abs(l - 0.5) * 1.6); // near-black and near-white pixels carry no colour
      if (score > top) { top = score; best = [h, s]; }
    }
    return best && rgb(best[0], Math.min(Math.max(best[1], 0.45), 0.85), 0.72);
  }
  // "00:01:02.345", "1:02.345", "62.345" or "62.345s" -> ms
  const toMs = t => Math.round(String(t).trim().replace(/s$/, "").split(":").reduce((acc, p) => acc * 60 + Number(p), 0) * 1000);
  // Timed lines out of a TTML document as [{ t, text }], or null when it has no timing (plain lyrics).
  function parseTtml(ttml) {
    const text = s => s.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
    const lines = [...String(ttml || "").matchAll(/<p\b[^>]*\bbegin="([^"]+)"[^>]*>([\s\S]*?)<\/p>/g)]
      .map(m => ({ t: toMs(m[1]), text: text(m[2]) }))
      .filter(l => l.text && Number.isFinite(l.t));
    return lines.length ? lines.sort((a, b) => a.t - b.t) : null;
  }
  return { hsl, rgb, pickAccent, toMs, parseTtml };
})();
if (typeof module !== "undefined") module.exports = HexglassCore;

(function hexglass() {
  if (typeof window === "undefined") return;
  const S = window.Spicetify;
  if (!S?.Player?.addEventListener || !document.body) return setTimeout(hexglass, 300);

  const root = document.documentElement;
  // The wash is drawn once per song, small, and stretched over the window: a light blur that costs almost nothing,
  // where a real blur would be redrawn on every scroll without the GPU. Smaller BLUR_W = blurrier.
  const BLUR_W = 400;
  const layers = [0, 1].map(() => {
    const c = Object.assign(document.createElement("canvas"), { className: "hexglass-bg" });
    document.body.prepend(c);
    return c;
  });
  let front = 0, shown = "", lastImg = null;

  function draw(c, img) {
    const w = BLUR_W, h = Math.round((w * innerHeight) / innerWidth) || w, x = c.getContext("2d");
    c.width = w;
    c.height = h;
    x.filter = "blur(1.5px) saturate(1.2)";
    const s = Math.max(w, h) * 1.1; // the square cover fills the window, past the edges so the blur leaves no dark rim
    x.drawImage(img, (w - s) / 2, (h - s) / 2, s, s);
    x.filter = "none";
    return x;
  }

  const coverUrl = m => {
    const u = m?.image_xlarge_url || m?.image_large_url || m?.image_url || "";
    return u.startsWith("spotify:image:") ? "https://i.scdn.co/image/" + u.slice(14) : u;
  };

  function setAccent(c) {
    for (const k of ["button", "button-active"]) {
      if (c) {
        root.style.setProperty(`--spice-${k}`, "#" + c.map(v => v.toString(16).padStart(2, "0")).join(""));
        root.style.setProperty(`--spice-rgb-${k}`, c.join(","));
      } else {
        root.style.removeProperty(`--spice-${k}`);
        root.style.removeProperty(`--spice-rgb-${k}`);
      }
    }
  }

  function paint() {
    const url = coverUrl(S.Player.data?.item?.metadata);
    if (url && url === shown && lastImg && S.Player.data?.item?.uri !== deskSong?.uri) sendSong(lastImg); // new song, same cover
    if (!url || url === shown) return;
    shown = url;
    const img = new Image();
    if (url.startsWith("https:")) img.crossOrigin = "anonymous"; // Spotify's CDN allows reading pixels; local covers break with the flag
    img.onload = () => {
      if (url !== shown) return;
      lastImg = img;
      const next = layers[1 - front], x = draw(next, img);
      try { setAccent(HexglassCore.pickAccent(x.getImageData(0, 0, next.width, next.height).data)); } catch { setAccent(null); }
      next.classList.add("on");
      layers[front].classList.remove("on");
      front = 1 - front;
      sendSong(img);
    };
    img.onerror = () => { if (url === shown) shown = ""; };
    img.src = url;
  }

  // ---- The song for Hexglass Desktop (Hexglass/Desktop), the app that draws it behind the desktop icons. The
  // helper (LocalPresence/helper/desktop.js) passes it on. ----
  const DESK = "http://127.0.0.1:47999/desktop";
  let deskSong = null;
  const post = (p, body) => fetch(DESK + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
  const now = () => ({ ms: S.Player.getProgress() || 0, playing: !!S.Player.isPlaying() });

  // The cover as a 640 px JPEG, encoded off the main thread: only Spotify can read local covers.
  function coverData(img) {
    const c = Object.assign(document.createElement("canvas"), { width: 640, height: 640 });
    c.getContext("2d").drawImage(img, 0, 0, 640, 640);
    return new Promise(ok => c.toBlob(b => {
      if (!b) return ok("");
      const r = new FileReader();
      r.onload = () => ok(r.result.split(",")[1]);
      r.readAsDataURL(b);
    }, "image/jpeg", 0.95));
  }

  // Timed lyrics: Spotify's own for streamed songs, Spicy Lyrics' store (filled by VaultBridge) for local files.
  async function lyricsFor(uri) {
    if (uri.startsWith("spotify:local:")) return HexglassCore.parseTtml(await spicyLyrics(uri));
    const r = await S.CosmosAsync.get(`https://spclient.wg.spotify.com/color-lyrics/v2/track/${uri.split(":")[2]}?format=json&vocalRemoval=false&market=from_token`);
    if (r?.lyrics?.syncType !== "LINE_SYNCED") return null;
    const lines = r.lyrics.lines.map(l => ({ t: Number(l.startTimeMs), text: (l.words || "").trim() })).filter(l => l.text && l.text !== "♪");
    return lines.length ? lines : null;
  }
  async function spicyLyrics(uri) {
    if (!(await indexedDB.databases()).some(d => d.name === "spicylyrics")) return null; // opening it would create it
    const db = await new Promise((ok, bad) => { const r = indexedDB.open("spicylyrics"); r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error); });
    try {
      if (!db.objectStoreNames.contains("lyricsStore")) return null;
      return await new Promise((ok, bad) => { const r = db.transaction("lyricsStore").objectStore("lyricsStore").get(uri); r.onsuccess = () => ok(r.result || null); r.onerror = () => bad(r.error); });
    } finally { db.close(); }
  }

  async function sendSong(img) {
    const item = S.Player.data?.item;
    if (!item?.uri) return;
    const song = { uri: item.uri, title: item.name || "", artist: (item.artists || []).map(a => a.name).join(", ") };
    deskSong = song;
    let cover = "";
    try { cover = await coverData(img); } catch {} // a cover the page can't read: the app shows the song without it
    if (deskSong !== song) return;
    post("/song", { ...song, cover, lines: null, ...now() });
    const lines = await lyricsFor(song.uri).catch(() => null);
    if (lines && deskSong === song) post("/state", { uri: song.uri, ...now(), lines });
  }

  // isPlaying() still gives the old answer while the play/pause event fires, so read it a moment later.
  S.Player.addEventListener("onplaypause", () => setTimeout(() => deskSong && post("/state", { uri: deskSong.uri, ...now() }), 300));
  // Any slip in the app's clock fixes itself; a helper that restarted (404: song unknown) gets the whole song again.
  setInterval(() => deskSong && post("/state", { uri: deskSong.uri, ...now() }).then(r => r?.status === 404 && lastImg && sendSong(lastImg)), 10000);
  let lastP = 0, lastAt = 0;
  S.Player.addEventListener("onprogress", e => {
    const expect = lastP + (S.Player.isPlaying() ? Date.now() - lastAt : 0);
    if (deskSong && lastAt && Math.abs(e.data - expect) > 1500) post("/state", { uri: deskSong.uri, ...now() }); // a seek
    lastP = e.data;
    lastAt = Date.now();
  });

  let resizing;
  addEventListener("resize", () => { clearTimeout(resizing); resizing = setTimeout(() => lastImg && draw(layers[front], lastImg), 200); });
  S.Player.addEventListener("songchange", paint);
  paint();
  setInterval(paint, 5000); // first load: the song's data can arrive after this script
})();
