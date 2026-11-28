// Full-screen Wrapped story for the selected range. Each slide plays its own song; whatever was playing comes back on close.
var HS_DUR = { intro: 9000, minutes: 10000, quiz: 6000, song: 11000, songs: 12000, artist: 11000, artists: 12000, album: 10000, days: 13000, new: 10000, day: 13000, vault: 10000, type: 11000 };
var HS_FONT_URL = "https://fonts.googleapis.com/css2?family=Libre+Bodoni:ital,wght@1,400;1,600&display=swap";
var hsReduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
var hsFmt = n => (n >= 10000 ? new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n) : Math.round(n).toLocaleString());
var hsDate = t => new Date(t).toLocaleDateString(undefined, HexedCore.dateOpts(t));
var hsDay = d => hsDate(Date.parse(d + "T12:00:00"));
var hsHour = h => new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: "numeric" });

// seekTo makes Spotify start right there; seeking after the start lets the first moment play, then jumps.
// Local files only play from the local files context.
var hsToken = 0;
function hsStart(u, seekTo) {
  if (u.startsWith("spotify:local:")) return Spicetify.Platform.PlayerAPI.play({ uri: "spotify:local-files" }, {}, { skipTo: { uri: u }, seekTo });
  return Spicetify.Player.playUri(u, {}, { seekTo });
}
// From 20% in (30 s at most), past the intro. A local file's URI ends with its length in seconds.
async function hsPlay(u) {
  const my = ++hsToken;
  const ms = u.startsWith("spotify:local:") ? +u.split(":").pop() * 1000 : (await HexedMeta.track(u))?.ms;
  if (my !== hsToken) return; // already on another slide
  try { await hsStart(u, Math.round(Math.min(30000, (ms || 150000) * 0.2))); } catch (e) { console.warn("[hexed] couldn't play", u, e); }
}

// Spotify ignores initiallyPaused, but a pause right after the start lands before any sound (checked live).
async function hsRestore(saved) {
  const P = Spicetify.Player;
  ++hsToken;
  if (!saved) return P.pause();
  try { await Spicetify.Platform.PlayerAPI.play({ uri: saved.ctx }, {}, { skipTo: { uri: saved.uri, uid: saved.uid }, seekTo: saved.pos }); }
  catch { // some contexts (radio, a closed queue) can't be restarted: play the song alone
    try { await hsStart(saved.uri, saved.pos); } catch (e) { return console.warn("[hexed] couldn't restore", e); }
  }
  if (!saved.playing) P.pause();
}

// A song record as a URI Spotify can play now, or null. Retagging a local file changes its URI, so fall back to name+artist.
function hsPlayable(local) {
  return s => {
    const u = s?.u || (s?.k?.startsWith("spotify:") ? s.k : null);
    if (u?.startsWith("spotify:track:")) return u;
    if (u?.startsWith("spotify:local:")) return local.get(u) || local.get(HexedCore.nameKey(s.n, s.a)) || null;
    return null;
  };
}

function hsSlides(st, w, playable) {
  const top = st.topSongs, A = st.topArtists, S = [];
  const add = o => S.push({ prio: 9, dur: HS_DUR[o.id], ...o });
  add({ id: "intro", art: w.first, music: [w.first], prio: 5 });
  add({ id: "minutes", music: [top[2], top[3]] });
  const choices = [...new Map([top[0], top[1], top[3], top[6] || top[4] || top[2]].filter(Boolean).map(s => [s.k, s])).values()].sort((a, b) => a.n.localeCompare(b.n));
  if (choices.length >= 3) add({ id: "quiz", choices, music: [top[8], top[9], top[10], top[5]], quiz: true });
  add({ id: "song", art: top[0], music: [top[0]], prio: 0 });
  if (top.length >= 3) add({ id: "songs", art: top[1], music: [top[1], top[2]] });
  if (A[0]) add({ id: "artist", art: A[0], photo: true, music: w.artists[0].top, prio: 1 });
  if (w.race && A.length >= 2) add({ id: "race", music: w.artists[1].top, dur: w.race.frames.length * 700 + 4500 });
  if (A.length >= 3) add({ id: "artists", art: A[1], photo: true, music: w.artists.slice(2).flatMap(a => a.top) });
  if (w.album && w.album.plays >= 3) add({ id: "album", art: w.album, override: HEXED_ALBUM_ART[`${w.album.al}|${w.album.a}`.toLowerCase()], music: w.album.top, prio: 2 });
  if (w.topDays.length >= 2) add({ id: "days", art: w.topDays[0].top, music: [st.obsession, ...w.topDays.map(d => d.top)], prio: 6 });
  if (w.discoveries?.length) add({ id: "new", music: w.discoveries, prio: 3 });
  const peak = w.audioDay[w.peakHour < 5 ? 3 : w.peakHour < 12 ? 0 : w.peakHour < 17 ? 1 : w.peakHour < 22 ? 2 : 3];
  if (w.audioDay.filter(b => b.top).length >= 2) add({ id: "day", music: [peak.top, ...w.audioDay.map(b => b.top)] });
  if (w.localShare >= 0.03 && w.localSongs.length) add({ id: "vault", music: w.localSongs, prio: 4 });
  add({ id: "type", music: [top[4], top[7], top[11]] });
  add({ id: "summary", art: A[0], photo: true, music: [top[0]], again: true, dur: 0 });
  // Songs go to the most important slides first; no song plays twice except the finale.
  const used = new Set();
  for (const s of [...S].sort((a, b) => a.prio - b.prio)) {
    for (const c of s.music.concat(top)) {
      const u = c && playable(c);
      if (u && (s.again || !used.has(u))) { used.add(u); s.song = { ...c, play: u }; break; }
    }
  }
  return S;
}

function HexedStory({ recs, from, to, st, prev, label, prevLabel, accent, onClose }) {
  const R = Spicetify.React, h = R.createElement;
  const w = R.useMemo(() => HexedCore.wrapped(recs, from, to, st), []);
  const [slides, setSlides] = R.useState(null);
  const [i, setI] = R.useState(0);
  const [paused, setPaused] = R.useState(false);
  const [answer, setAnswer] = R.useState(null);
  const [looks, setLooks] = R.useState({});
  const [shot, setShot] = R.useState(""); // "save this slide" status
  const box = R.useRef(null), left = R.useRef(0), began = R.useRef(0), hold = R.useRef(null), firstPause = R.useRef(true);

  // Open: remember what was playing, stop it, and keep the tracker from counting story songs as plays.
  R.useEffect(() => {
    const P = Spicetify.Player, it = P.data?.item;
    const saved = it && { uri: it.uri, uid: it.uid, ctx: P.data?.context?.uri, pos: P.getProgress(), playing: P.isPlaying() };
    window.hexedStoryOpen = true;
    P.pause();
    box.current?.focus();
    Spicetify.Platform.LocalFilesAPI.getTracks().catch(() => []).then(list => {
      const local = new Map();
      for (const t of list) { local.set(t.uri, t.uri); local.set(HexedCore.nameKey(t.name, t.artists?.[0]?.name), t.uri); }
      setSlides(hsSlides(st, w, hsPlayable(local)));
    });
    return () => { window.hexedStoryOpen = false; hsRestore(saved); };
  }, []);

  // Background image + accent for every slide, and each song's length, fetched up front so slides don't wait.
  R.useEffect(() => {
    slides?.forEach((s, k) => {
      if (s.song) HexedMeta.track(s.song.play);
      const a = s.art || s.song;
      if (a) HexedMeta.track(a.u).then(m => {
        const img = s.override || (m && (s.photo ? m.photoBig || m.photo || m.coverBig || m.cover : m.coverBig || m.cover));
        if (!img) return;
        setLooks(L => ({ ...L, [k]: { img } }));
        hexedAccent(img).then(c => c && setLooks(L => ({ ...L, [k]: { img, accent: c } })));
      });
    });
  }, [slides]);

  const n = slides?.length || 0, s = slides?.[i];
  const waiting = !!s?.quiz && answer === null;
  const go = d => { setPaused(false); setI(k => Math.max(0, Math.min(n - 1, k + d))); };

  R.useEffect(() => { if (s?.song) hsPlay(s.song.play); }, [i, slides]);
  R.useEffect(() => { left.current = s?.dur || 0; }, [i, slides, waiting]);
  R.useEffect(() => {
    if (!s?.dur || paused || waiting) return;
    began.current = Date.now();
    const t = setTimeout(() => go(1), left.current);
    return () => { clearTimeout(t); left.current -= Date.now() - began.current; };
  }, [i, slides, paused, waiting]);
  R.useEffect(() => {
    if (firstPause.current) { firstPause.current = false; return; }
    paused ? Spicetify.Player.pause() : Spicetify.Player.play();
  }, [paused]);

  // Capture phase so Spotify's own shortcuts (Space = play/pause) don't also fire.
  R.useEffect(() => {
    const key = e => {
      const act = { ArrowRight: () => go(1), ArrowLeft: () => go(-1), " ": () => setPaused(p => !p), Escape: onClose }[e.key];
      if (!act || (e.key === " " && e.target.closest?.("button"))) return;
      e.preventDefault(); e.stopImmediatePropagation(); act();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [n]);

  // Like stories: the left third goes back, anywhere else goes on, holding pauses.
  const pointer = {
    onPointerDown: e => { if (e.button || e.target.closest("button")) return; hold.current = setTimeout(() => { hold.current = "held"; setPaused(true); }, 250); },
    onPointerUp: e => {
      if (hold.current === null) return;
      if (hold.current === "held") setPaused(false);
      else { clearTimeout(hold.current); go(e.clientX < innerWidth / 3 ? -1 : 1); }
      hold.current = null;
    },
  };

  const slidePic = fn => {
    setShot("Making it…");
    hsDo(fn(hsShot(box.current), `hexed-${hsSlug(label)}-${String(i + 1).padStart(2, "0")}-${s.id}.png`), m => { setShot(m); setTimeout(() => setShot(""), 2500); });
  };

  const look = looks[i] || {};
  const icon = d => h("svg", { viewBox: "0 0 24 24", width: 20, height: 20, fill: "currentColor", "aria-hidden": true }, h("path", { d }));
  const View = s && HS_VIEWS[s.id];
  const node = h("div", { ref: box, className: "hs" + (paused ? " paused" : ""), role: "dialog", "aria-modal": true, "aria-label": `Hexed Wrapped: ${label}`, tabIndex: -1, style: { "--acc": look.accent || accent || "#1ed760" }, ...pointer },
    h("style", null, HS_CSS),
    h("div", { className: "hs-bg" }, look.img && h("img", { key: look.img, src: look.img, alt: "" })),
    h("div", { className: "hs-shade" }),
    h("div", { className: "hs-grain" }),
    h("div", { className: "hs-bars" }, (slides || []).map((x, k) => h("span", {
      key: k, style: k === i ? { "--d": x.dur + "ms" } : undefined,
      className: "hs-bar" + (k < i || (k === i && !x.dur) ? " done" : k === i ? " on" + (waiting ? " wait" : "") : ""),
    }, h("i", { key: k === i ? `${i}-${waiting}` : "x" })))),
    h("div", { className: "hs-top" },
      h("span", { className: "hs-kick" }, `Hexed · ${label}`, n ? h("span", { className: "hs-count" }, `${String(i + 1).padStart(2, "0")} / ${String(n).padStart(2, "0")}`) : null),
      h("span", { className: "hs-ctls" },
        shot && h("span", { className: "hs-shot-msg", role: "status" }, shot),
        h("button", { className: "hs-ctl", "aria-label": "Copy this slide as a picture", title: "Copy this slide as a picture", onClick: () => slidePic(hsCopy), disabled: !s }, icon("M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z")),
        h("button", { className: "hs-ctl", "aria-label": "Save this slide as a picture", title: "Save this slide as a picture", onClick: () => slidePic(hsSaveAs), disabled: !s }, icon("M11 3h2v9.17l3.59-3.58L18 10l-6 6-6-6 1.41-1.41L11 12.17V3zM5 19h14v2H5z")),
        h("button", { className: "hs-ctl", "aria-label": paused ? "Play" : "Pause", onClick: () => setPaused(p => !p) }, icon(paused ? "M8 5v14l11-7z" : "M7 5h4v14H7zm6 0h4v14h-4z")),
        h("button", { className: "hs-ctl", "aria-label": "Close", onClick: onClose }, icon("M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7l-1.4-1.4L9.2 12 2.9 5.7l1.4-1.4 6.3 6.3 6.3-6.3z")))),
    h("div", { className: "hs-live", "aria-live": "polite" },
      h("div", { key: i, className: "hs-stage hs-s-" + (s?.id || "load") },
        View ? h(View, { s, st, w, prev, label, prevLabel, answer, onAnswer: setAnswer, again: () => setI(0), onClose, acc: look.accent || accent }) : h("div", { className: "hs-kick" }, "Loading your story…"))));
  return Spicetify.ReactDOM.createPortal(node, document.body);
}

// ---- slides ----
var hsH = (...a) => Spicetify.React.createElement(...a);
var hsKick = (t, i = 0) => hsH("div", { className: "hs-kick hs-in", style: { "--i": i } }, t);
var hsSerif = t => hsH("span", { className: "hs-serif" }, t);
var hsTag = t => hsH("span", { className: "hs-tag hs-in" }, t);
var hsStat = (big, small, i) => hsH("div", { className: "hs-stat hs-in", style: { "--i": i } }, hsH("b", null, big), hsH("span", null, small));
var hsIn = (i, tag, props, ...kids) => hsH(tag, { ...props, className: (props?.className || "") + " hs-in", style: { ...props?.style, "--i": i } }, ...kids);
var hsFrag = (...kids) => hsH(Spicetify.React.Fragment, null, ...kids);

function HsCount({ to }) {
  const R = Spicetify.React, [v, setV] = R.useState(hsReduce() ? to : 0);
  R.useEffect(() => {
    if (hsReduce()) return setV(to);
    let raf;
    const t0 = performance.now(); // not the first frame's time: frames pause while Spotify is out of sight
    const step = () => { const p = Math.min(1, (performance.now() - t0) / 1600); setV(to * (1 - Math.pow(1 - p, 3))); if (p < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    const end = setTimeout(() => setV(to), 1700);
    return () => { cancelAnimationFrame(raf); clearTimeout(end); };
  }, [to]);
  return hsH("span", { "data-final": hsFmt(to) }, hsFmt(v)); // a saved picture shows the final number, not one mid count
}

function HsRow({ item, rank, i, photo, line }) {
  return hsIn(i, "div", { className: "hs-li" },
    hsH("span", { className: "hs-num hs-serif" }, rank),
    hsH(HexedArt, { uri: item.u, kind: photo ? "photo" : "cover" }),
    hsH("span", { className: "hs-li-name" }, hsH("b", null, item.n || item.a), line && hsH("span", null, line)),
    hsH("span", { className: "hs-li-plays" }, hsFmt(item.plays), " plays"));
}

function HsRace({ w }) {
  const R = Spicetify.React, frames = w.race.frames;
  const [f, setF] = R.useState(hsReduce() ? frames.length - 1 : 0);
  R.useEffect(() => {
    if (f >= frames.length - 1) return;
    const t = setTimeout(() => setF(f + 1), f === 0 ? 1200 : 700);
    return () => clearTimeout(t);
  }, [f]);
  const fr = frames[f], max = fr.top[0]?.ms || 1, names = [...new Set(frames.flatMap(x => x.top.map(t => t.a)))];
  const when = new Date(fr.t).toLocaleDateString(undefined, w.race.unit === "month" ? { month: "short", year: "2-digit" } : { month: "short", day: "numeric" });
  return hsFrag(
    hsH("div", { className: "hs-when", "aria-hidden": true }, when),
    hsKick("The race to #1"),
    hsIn(1, "h2", { className: "hs-h2" }, "Who led, ", hsSerif(w.race.unit === "month" ? "month by month" : "week by week")),
    hsH("div", { className: "hs-race", role: "img", "aria-label": `Final order: ${frames.at(-1).top.map(t => t.a).join(", ")}` },
      names.map(a => {
        const r = fr.top.findIndex(t => t.a === a), it = fr.top[r];
        return hsH("div", { key: a, className: "hs-racer" + (r === 0 ? " lead" : ""), style: { transform: `translateY(${(r < 0 ? 5 : r) * 64}px)`, opacity: r < 0 ? 0 : 1 } },
          hsH("b", null, a),
          hsH("span", { className: "hs-track" }, hsH("span", { className: "hs-fill", style: { transform: `scaleX(${it ? Math.max(0.02, it.ms / max) : 0})` } })),
          hsH("span", { className: "hs-race-min" }, it ? hsFmt(it.ms / 60000) + " min" : ""));
      })));
}

// ---- shareable picture (1080×1920, phone portrait) ----
var hsRgb = c => {
  if (c?.[0] === "#") { const n = parseInt(c.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  const m = c?.match(/\d+/g);
  return m ? m.slice(0, 3).map(Number) : [30, 215, 96];
};
// Same rule as hexedAccent: Spotify's CDN needs crossOrigin to stay drawable; local covers only load without it.
var hsImg = url => new Promise(ok => {
  if (!url) return ok(null);
  const img = new Image();
  if (url.startsWith("https:")) img.crossOrigin = "anonymous";
  img.onload = () => ok(img);
  img.onerror = () => ok(null);
  img.src = url;
});
function hsDraw(g, img, x, y, w, h, round) {
  g.save();
  g.beginPath();
  round ? g.arc(x + w / 2, y + h / 2, w / 2, 0, Math.PI * 2) : g.roundRect(x, y, w, h, 10);
  g.clip();
  if (img) {
    const s = Math.min(img.naturalWidth / w, img.naturalHeight / h); // crop to fill, like object-fit: cover
    g.drawImage(img, (img.naturalWidth - w * s) / 2, (img.naturalHeight - h * s) / 2, w * s, h * s, x, y, w, h);
  } else { g.fillStyle = "rgba(255,255,255,.1)"; g.fill(); }
  g.restore();
}
var hsFit = (g, text, max) => {
  if (g.measureText(text).width <= max) return text;
  while (text && g.measureText(text + "…").width > max) text = text.slice(0, -1);
  return text + "…";
};

async function hsCard(st, w, label, acc) {
  const W = 1080, H = 1920, P = 80, [r, gr, b] = hsRgb(acc), A = `rgb(${r},${gr},${b})`;
  const sans = getComputedStyle(document.body).fontFamily, serif = '"Libre Bodoni", Georgia, serif';
  await document.fonts.load(`italic 40px "Libre Bodoni"`).catch(() => {});
  const meta = u => HexedMeta.track(u).then(m => m || {});
  const artists = st.topArtists.slice(0, 5), songs = st.topSongs.slice(0, 5);
  const [hero, aImgs, sImgs, albumImg] = await Promise.all([
    meta(artists[0]?.u).then(m => hsImg(m.photoBig || m.photo || m.coverBig || m.cover)),
    Promise.all(artists.map(a => meta(a.u).then(m => hsImg(m.photo || m.cover)))),
    Promise.all(songs.map(s => meta(s.u).then(m => hsImg(m.cover)))),
    w.album && (HEXED_ALBUM_ART[`${w.album.al}|${w.album.a}`.toLowerCase()] ? hsImg(HEXED_ALBUM_ART[`${w.album.al}|${w.album.a}`.toLowerCase()]) : meta(w.album.u).then(m => hsImg(m.cover))),
  ]);
  const c = Object.assign(document.createElement("canvas"), { width: W, height: H }), g = c.getContext("2d");
  const text = (t, x, y, font, color = "#fff", max = W - 2 * P, align = "left", spacing = "0px") => {
    g.font = font; g.fillStyle = color; g.textAlign = align; g.letterSpacing = spacing;
    g.fillText(hsFit(g, t, max), x, y);
    g.letterSpacing = "0px";
  };
  // background: #1 artist in duotone, fading into black
  g.fillStyle = "#0b0b0c"; g.fillRect(0, 0, W, H);
  g.fillStyle = `rgb(${r * 0.6 | 0},${gr * 0.6 | 0},${b * 0.6 | 0})`; g.fillRect(0, 0, W, 900);
  if (hero) { g.save(); g.filter = "grayscale(1) contrast(1.2)"; g.globalCompositeOperation = "multiply"; hsDraw(g, hero, 0, 0, W, 900); g.restore(); }
  let fade = g.createLinearGradient(0, 420, 0, 900);
  fade.addColorStop(0, "rgba(11,11,12,0)"); fade.addColorStop(1, "#0b0b0c");
  g.fillStyle = fade; g.fillRect(0, 0, W, 900);
  fade = g.createLinearGradient(0, 0, 0, 240);
  fade.addColorStop(0, "rgba(0,0,0,.55)"); fade.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = fade; g.fillRect(0, 0, W, 240);
  // light grain, like the story
  const n = Object.assign(document.createElement("canvas"), { width: 128, height: 128 }), ng = n.getContext("2d"), px = ng.createImageData(128, 128);
  for (let i = 0; i < px.data.length; i += 4) { px.data[i] = px.data[i + 1] = px.data[i + 2] = Math.random() * 255; px.data[i + 3] = 14; }
  ng.putImageData(px, 0, 0);
  g.fillStyle = g.createPattern(n, "repeat"); g.fillRect(0, 0, W, H);

  text("HEXED WRAPPED", P, 130, `800 28px ${sans}`, "#fff", 500, "left", "6px");
  text(label.toUpperCase(), W - P, 130, `800 28px ${sans}`, "rgba(255,255,255,.75)", 420, "right", "6px");
  if (artists[0]) {
    g.font = `800 22px ${sans}`; g.letterSpacing = "3px";
    const tw = g.measureText("#1 ARTIST").width + 36;
    g.fillStyle = A; g.beginPath(); g.roundRect(P, 676, tw, 44, 22); g.fill();
    text("#1 ARTIST", P + 18, 706, `800 22px ${sans}`, "#000", tw, "left", "3px");
    let size = 132;
    g.font = `900 ${size}px ${sans}`;
    while (size > 72 && g.measureText(artists[0].a).width > W - 2 * P) g.font = `900 ${(size -= 6)}px ${sans}`;
    text(artists[0].a, P, 840, `900 ${size}px ${sans}`);
  }
  // two columns of five
  const col = (x, title, items, imgs, round, sub) => {
    text(title, x, 960, `800 22px ${sans}`, "rgba(255,255,255,.65)", 420, "left", "4px");
    items.forEach((it, k) => {
      const y = 990 + k * 100;
      text(String(k + 1), x + 26, y + 54, `italic 400 40px ${serif}`, A, 40, "right");
      hsDraw(g, imgs[k], x + 44, y, 80, 80, round);
      text(it.n || it.a, x + 144, y + 36, `800 30px ${sans}`, "#fff", 290);
      text(sub(it), x + 144, y + 70, `500 23px ${sans}`, "rgba(255,255,255,.62)", 290);
    });
  };
  col(P, "TOP ARTISTS", artists, aImgs, true, a => `${a.plays.toLocaleString()} plays · ${Math.round(a.ms / 60000).toLocaleString()} min`); // ranked by plays
  col(W / 2 + 20, "TOP SONGS", songs, sImgs, false, s => `${s.plays.toLocaleString()} plays · ${s.a}`);
  g.fillStyle = "rgba(255,255,255,.14)"; g.fillRect(P, 1500, W - 2 * P, 2);
  text("MINUTES", P, 1560, `800 22px ${sans}`, "rgba(255,255,255,.65)", 400, "left", "4px");
  text(Math.round(st.ms / 60000).toLocaleString(), P, 1648, `900 84px ${sans}`, A, 420);
  text("LISTENING TYPE", W / 2 + 20, 1560, `800 22px ${sans}`, "rgba(255,255,255,.65)", 400, "left", "4px");
  text(w.personality.name, W / 2 + 20, 1636, `900 50px ${sans}`, "#fff", W / 2 - 20 - P);
  if (w.album) {
    hsDraw(g, albumImg, P, 1700, 96, 96, false);
    text("TOP ALBUM", P + 120, 1736, `800 22px ${sans}`, "rgba(255,255,255,.65)", 300, "left", "4px");
    text(w.album.al, P + 120, 1782, `800 36px ${sans}`, "#fff", W - 2 * P - 120);
  }
  text("Hexed", P, 1870, `italic 400 44px ${serif}`, A, 300);
  text(new Date().toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }), W - P, 1866, `600 24px ${sans}`, "rgba(255,255,255,.55)", 400, "right");
  return new Promise((ok, bad) => c.toBlob(bl => (bl ? ok(bl) : bad(new Error("couldn't make the picture"))), "image/png"));
}

var hsSlug = t => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
// A plain <a download> gets stuck after the first one (Chromium asks before a page downloads several files, and
// Spotify can't show that question). Both of these need the click's user activation, so call them straight from it:
// the picture itself (a promise) is made meanwhile.
async function hsSaveAs(pic, name) {
  pic.catch(() => {}); // still awaited below; this only keeps a cancelled save quiet
  const file = await showSaveFilePicker({ id: "hexed", startIn: "pictures", suggestedName: name, types: [{ description: "PNG picture", accept: { "image/png": [".png"] } }] });
  const out = await file.createWritable();
  await out.write(await pic);
  await out.close();
  return "Saved";
}
var hsCopy = pic => navigator.clipboard.write([new ClipboardItem({ "image/png": pic })]).then(() => "Copied");
// Runs one of the two and reports "Saved"/"Copied", "" when the Save window was cancelled, or an error message.
var hsDo = (job, set) => job.then(set, e => { if (e?.name !== "AbortError") console.error("[hexed] picture failed", e); set(e?.name === "AbortError" ? "" : "Didn't work"); });

// The status shows on the button itself; an extra label in the row pushed the buttons onto two lines.
function HsPhone({ st, w, label, acc }) {
  const R = Spicetify.React, [msg, setMsg] = R.useState({});
  const name = `hexed-wrapped-${hsSlug(label)}-phone.png`;
  const run = (key, fn) => {
    setMsg({ [key]: "Making it…" });
    hsDo(fn(hsCard(st, w, label, acc), name), m => { setMsg({ [key]: m }); setTimeout(() => setMsg({}), 2500); });
  };
  return hsFrag(
    hsH("button", { className: "hs-btn", onClick: () => run("save", hsSaveAs), "aria-live": "polite" }, msg.save || "Save for phone"),
    hsH("button", { className: "hs-btn ghost", onClick: () => run("copy", hsCopy), "aria-live": "polite" }, msg.copy || "Copy for phone"));
}

// ---- any slide as a picture, the size of the screen ----
// The slide is redrawn inside an SVG <foreignObject>. An SVG picture can't load anything itself, so the fonts and
// images go in as data URLs.
var hsDataUrl = blob => new Promise(ok => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(blob); });
var hsFontCss = null;
async function hsFonts() {
  if (hsFontCss !== null) return hsFontCss;
  const inline = async (css, base) => {
    const urls = [...new Set([...css.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map(m => m[1]).filter(u => !u.startsWith("data:")))];
    const data = await Promise.all(urls.map(u => fetch(new URL(u, base)).then(r => r.blob()).then(hsDataUrl).catch(() => "")));
    urls.forEach((u, k) => { css = css.split(u).join(data[k]); });
    return css;
  };
  const family = getComputedStyle(document.body).fontFamily.split(",")[0].replace(/["']/g, "").trim();
  let css = "";
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; } // other origins' sheets can't be read
    for (const r of rules) if (r instanceof CSSFontFaceRule && r.style.getPropertyValue("font-family").replace(/["']/g, "").trim() === family) css += await inline(r.cssText, sheet.href || location.href);
  }
  css += await fetch(HS_FONT_URL).then(r => r.text()).then(t => inline(t, HS_FONT_URL)).catch(() => "");
  return (hsFontCss = css);
}

async function hsShot(root) {
  const W = innerWidth, H = innerHeight, dpr = Math.max(1, devicePixelRatio || 1);
  const clone = root.cloneNode(true); // right away, so the slide moving on meanwhile doesn't matter
  clone.querySelector("style")?.remove();
  clone.querySelectorAll("[data-final]").forEach(e => { e.textContent = e.dataset.final; });
  await Promise.all([...clone.querySelectorAll("img")].map(async im => {
    const img = await hsImg(im.getAttribute("src"));
    if (!img) return im.remove();
    const c = Object.assign(document.createElement("canvas"), { width: img.naturalWidth, height: img.naturalHeight });
    c.getContext("2d").drawImage(img, 0, 0);
    im.setAttribute("src", c.toDataURL("image/jpeg", 0.92));
  }));
  Object.assign(clone.style, { width: W + "px", height: H + "px", fontFamily: getComputedStyle(root).fontFamily });
  const css = (await hsFonts()) + HEXED_CSS + HS_CSS.replace(/@import url\([^)]*\);/, "") + // the font URL itself has ";" in it
    ".hs{position:relative!important}.hs *{animation:none!important;transition:none!important}.hs-in{opacity:1!important;transform:none!important}" +
    ".hs-bars,.hs-ctls,.hs-count,.hs-hint,.hs-shot-msg,.hs-sum-btns{display:none!important}";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml"><style><![CDATA[${css}]]></style>${new XMLSerializer().serializeToString(clone)}</div></foreignObject></svg>`;
  const pic = await hsImg("data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg));
  if (!pic) throw new Error("the slide couldn't be drawn");
  const c = Object.assign(document.createElement("canvas"), { width: W * dpr, height: H * dpr });
  c.getContext("2d").drawImage(pic, 0, 0, W * dpr, H * dpr);
  return new Promise((ok, bad) => c.toBlob(b => (b ? ok(b) : bad(new Error("couldn't make the picture"))), "image/png"));
}

var HS_PARTS = [
  ["Morning", "M12 8a5 5 0 0 0-5 5h10a5 5 0 0 0-5-5Zm-1-6h2v4h-2zM2 15h20v2H2zm3 4h14v2H5z"],
  ["Afternoon", "M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm-1-6h2v3h-2zm0 19h2v3h-2zM1 11h3v2H1zm19 0h3v2h-3z"],
  ["Evening", "M12 10a6 6 0 0 0-6 6h12a6 6 0 0 0-6-6ZM2 18h20v2H2z"],
  ["Night", "M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z"],
];

var HS_VIEWS = {
  intro: ({ w, label }) => hsFrag(
    hsKick("Hexed Wrapped"),
    hsIn(1, "h1", { className: "hs-h hs-giant" }, hsSerif("Your "), label === "All time" ? "whole story" : label.replace(/^Last/, "last")),
    w.first && hsIn(3, "div", { className: "hs-first" }, hsH(HexedArt, { uri: w.first.u, kind: "cover" }),
      hsH("div", null, hsH("span", null, `It started on ${hsDate(w.first.s)} with`), hsH("b", null, w.first.n), hsH("span", null, w.first.a))),
    hsIn(5, "p", { className: "hs-hint" }, "Click or → to go on · ← back · hold or Space to pause · Esc to close")),

  minutes: ({ st, w, prev, prevLabel }) => {
    const days = st.ms / 864e5, d = prev ? HexedCore.delta(st.ms, prev.ms) : null;
    return hsFrag(
      hsKick("Minutes listened"),
      hsIn(1, "div", { className: "hs-big" }, hsH(HsCount, { to: Math.round(st.ms / 60000) })),
      hsIn(2, "p", { className: "hs-p" }, days >= 1 ? `That's ${days >= 10 ? Math.round(days) : days.toFixed(1)} full days of music, back to back.` : `That's ${(st.ms / 36e5).toFixed(1)} hours of music.`),
      hsIn(3, "p", { className: "hs-p" }, `You pressed play on ${w.daysListened} of ${w.daysInRange} days.`),
      d !== null && hsIn(4, "span", { className: "hs-chip" }, `${d >= 0 ? "Up" : "Down"} ${Math.abs(d)}% on ${prevLabel}`));
  },

  quiz: ({ s, st, answer, onAnswer }) => {
    const right = s.choices.findIndex(c => c.k === st.topSongs[0].k);
    return hsFrag(
      hsKick("Quick quiz"),
      hsIn(1, "h2", { className: "hs-h2" }, "Which song did you play ", hsSerif("the most"), "?"),
      hsH("div", { className: "hs-quiz" }, s.choices.map((c, k) => hsIn(k + 2, "button", {
        key: c.k, disabled: answer !== null, onClick: () => onAnswer(k),
        className: "hs-opt" + (answer === null ? "" : k === right ? " right" : k === answer ? " wrong" : " dim"),
      }, hsH(HexedArt, { uri: c.u, kind: "cover" }), hsH("b", null, c.n), hsH("span", null, c.a)))),
      hsH("p", { className: "hs-p hs-answer" }, answer === null ? "Pick one." : answer === right ? "You know yourself." : `Close. It was ${st.topSongs[0].n}.`));
  },

  song: ({ st, w }) => {
    const s = st.topSongs[0], first = w.firstPlay.get(s.k);
    return hsH("div", { className: "hs-row" },
      hsIn(0, "div", { className: "hs-vinyl" }, hsH(HexedArt, { uri: s.u, kind: "cover" })),
      hsH("div", { className: "hs-col" },
        hsTag("Your #1 song"),
        hsIn(1, "h1", { className: "hs-h hs-fit" }, s.n),
        hsIn(2, "p", { className: "hs-p" }, s.a),
        hsH("div", { className: "hs-stats" }, hsStat(hsFmt(s.plays), "plays", 3), hsStat((s.ms / 36e5).toFixed(1), "hours of this one song", 4), first && hsStat(hsDate(first), "first play", 5))));
  },

  songs: ({ st }) => hsFrag(
    hsKick("Top songs"),
    hsIn(1, "h2", { className: "hs-h2" }, "The ones you ", hsSerif("couldn't skip")),
    hsH("div", { className: "hs-list" }, st.topSongs.slice(0, 5).map((s, k) => hsH(HsRow, { key: s.k, item: s, rank: k + 1, i: k + 2, line: s.a })))),

  artist: ({ st, w }) => {
    const a = w.artists[0];
    return hsFrag(
      hsTag("Your #1 artist"),
      hsIn(1, "h1", { className: "hs-h hs-giant" }, a.a),
      hsIn(2, "p", { className: "hs-p" }, `${hsFmt(a.plays)} plays · ${hsFmt(a.ms / 60000)} minutes · ${Math.round((a.ms / st.ms) * 100)}% of your listening.`),
      a.top[0] && hsIn(3, "p", { className: "hs-p" }, `${a.songs.toLocaleString()} different songs. The one you kept coming back to: `, hsH("b", null, a.top[0].n), "."));
  },

  race: HsRace,

  artists: ({ st }) => hsFrag(
    hsKick("Top artists"),
    hsIn(1, "h2", { className: "hs-h2" }, "Your ", hsSerif("rotation")),
    hsH("div", { className: "hs-list" }, st.topArtists.slice(0, 5).map((a, k) => hsH(HsRow, { key: a.a, item: a, rank: k + 1, i: k + 2, photo: true, line: `${hsFmt(a.ms / 60000)} min` })))),

  album: ({ s, w }) => hsH("div", { className: "hs-row" },
    hsIn(0, "div", { className: "hs-sleeve" }, hsH(HexedArt, { uri: w.album.u, kind: "cover", override: s.override })),
    hsH("div", { className: "hs-col" },
      hsKick("Top album", 1),
      hsIn(2, "h1", { className: "hs-h hs-fit" }, w.album.al),
      hsIn(3, "p", { className: "hs-p" }, `${w.album.a} · ${hsFmt(w.album.plays)} plays`),
      w.album.top[0] && hsIn(4, "p", { className: "hs-p" }, "Most played from it: ", hsH("b", null, w.album.top[0].n)))),

  days: ({ st, w }) => hsFrag(
    hsKick("Days to remember"),
    hsIn(1, "h2", { className: "hs-h2" }, "Your ", hsSerif("biggest"), " days"),
    hsH("div", { className: "hs-cards" }, w.topDays.map((d, k) => hsIn(k + 2, "div", { key: d.day, className: "hs-card" },
      hsH("span", { className: "hs-card-kick" }, hsDay(d.day)),
      hsH("b", { className: "hs-card-big" }, hsFmt(d.ms / 60000), hsH("small", null, " min")),
      hsH("span", null, "On repeat: ", hsH("b", null, d.top.n))))),
    st.obsession?.plays >= 4 && hsIn(5, "p", { className: "hs-p" }, `And on ${hsDay(st.obsession.day)} you played `, hsH("b", null, st.obsession.n), ` ${st.obsession.plays} times.`)),

  new: ({ s, w }) => {
    const d = w.discoveries.find(x => x.k === s.song?.k) || w.discoveries[0];
    return hsH("div", { className: "hs-row" },
      hsIn(0, "div", { className: "hs-sleeve" }, hsH(HexedArt, { uri: d.u, kind: "cover" })),
      hsH("div", { className: "hs-col" },
        hsTag("New this time"),
        hsIn(1, "h1", { className: "hs-h hs-fit" }, d.n),
        hsIn(2, "p", { className: "hs-p" }, d.a),
        hsIn(3, "p", { className: "hs-p" }, `You'd never played it before ${hsDate(w.firstPlay.get(d.k))}. Since then: `, hsH("b", null, `${d.plays} plays`), ".")));
  },

  day: ({ st, w }) => {
    const total = w.audioDay.reduce((a, b) => a + b.ms, 0) || 1;
    return hsFrag(
      hsKick("Your day in music"),
      hsIn(1, "h2", { className: "hs-h2" }, "You listen most around ", hsSerif(hsHour(w.peakHour))),
      hsH("div", { className: "hs-cards hs-four" }, HS_PARTS.map(([name, d], k) => {
        const b = w.audioDay[k];
        return hsIn(k + 2, "div", { key: name, className: "hs-card" + (b.top ? "" : " empty") },
          hsH("span", { className: "hs-card-kick" }, hsH("svg", { viewBox: "0 0 24 24", width: 18, height: 18, fill: "currentColor", "aria-hidden": true }, hsH("path", { d })), name),
          hsH("b", { className: "hs-card-big" }, Math.round((b.ms / total) * 100), hsH("small", null, "%")),
          hsH("span", null, b.top ? b.top.n : "Quiet"));
      })),
      st.streak?.days >= 3 && hsIn(6, "p", { className: "hs-p" }, `Longest streak: ${st.streak.days} days in a row, ${hsDay(st.streak.from)} to ${hsDay(st.streak.to)}.`));
  },

  vault: ({ w }) => hsFrag(
    hsKick("Straight from the vault"),
    hsIn(1, "div", { className: "hs-big" }, hsH(HsCount, { to: Math.round(w.localShare * 100) }), hsH("span", { className: "hs-serif hs-pct" }, "%")),
    hsIn(2, "p", { className: "hs-p" }, "of your listening was your own files: sessions, leaks and edits."),
    hsIn(3, "p", { className: "hs-p" }, `${w.localCount} songs. Most played: `, hsH("b", null, w.localSongs[0].n), ` (${w.localSongs[0].plays} plays).`)),

  type: ({ w }) => {
    const [the, ...rest] = w.personality.name.split(" ");
    return hsFrag(
      hsKick("Your listening type"),
      hsIn(1, "h1", { className: "hs-h hs-giant" }, hsSerif(the + " "), rest.join(" ")),
      hsIn(2, "p", { className: "hs-p" }, w.personality.line));
  },

  summary: ({ st, w, label, again, onClose, acc }) => hsH("div", { className: "hs-sum hs-in" },
    hsH("div", { className: "hs-sum-art" }, hsH(HexedArt, { uri: st.topArtists[0]?.u, kind: "photo" }),
      hsH("div", { className: "hs-sum-title" }, hsH("span", { className: "hs-serif" }, "Hexed"), hsH("b", null, label))),
    hsH("div", { className: "hs-sum-body" },
      hsH("div", { className: "hs-sum-cols" },
        hsH("div", null, hsH("span", { className: "hs-card-kick" }, "Top artists"),
          hsH("div", { className: "hs-list" }, st.topArtists.slice(0, 5).map((a, k) => hsH(HsRow, { key: a.a, item: a, rank: k + 1, i: k + 1, photo: true, line: `${hsFmt(a.plays)} plays · ${hsFmt(a.ms / 60000)} min` })))),
        hsH("div", null, hsH("span", { className: "hs-card-kick" }, "Top songs"),
          hsH("div", { className: "hs-list" }, st.topSongs.slice(0, 5).map((x, k) => hsH(HsRow, { key: x.k, item: x, rank: k + 1, i: k + 1, line: `${hsFmt(x.plays)} plays · ${x.a}` }))))),
      hsH("div", { className: "hs-sum-cols" },
        hsH("div", null, hsH("span", { className: "hs-card-kick" }, "Minutes"), hsH("b", { className: "hs-sum-big" }, Math.round(st.ms / 60000).toLocaleString())),
        hsH("div", null, hsH("span", { className: "hs-card-kick" }, "Type"), hsH("b", { className: "hs-sum-mid" }, w.personality.name))),
      w.album && hsH("div", { className: "hs-sum-album" }, hsH(HexedArt, { uri: w.album.u, kind: "cover", override: HEXED_ALBUM_ART[`${w.album.al}|${w.album.a}`.toLowerCase()] }),
        hsH("div", null, hsH("span", { className: "hs-card-kick" }, "Top album"), hsH("b", { className: "hs-sum-mid" }, w.album.al))),
      hsH("div", { className: "hs-sum-btns" },
        hsH(HsPhone, { st, w, label, acc }),
        hsH("button", { className: "hs-btn ghost", onClick: again }, "Watch again"),
        hsH("button", { className: "hs-btn ghost", onClick: onClose }, "Close")))),
};

var HS_CSS = `
@import url('${HS_FONT_URL}');
.hs{position:fixed;inset:0;z-index:10000;background:#0a0a0b;color:#fff;overflow:hidden;cursor:pointer;user-select:none;outline:none;font-family:var(--font-family,inherit)}
.hs :focus-visible{outline:2px solid #fff;outline-offset:3px}
.hs button{font:inherit;color:inherit;cursor:pointer}
.hs-bg{position:absolute;inset:0;background:radial-gradient(90% 100% at 80% 35%,color-mix(in srgb,var(--acc) 55%,#000),color-mix(in srgb,var(--acc) 18%,#000) 75%)}
.hs-bg img{position:absolute;top:0;right:0;height:100%;max-width:100%;aspect-ratio:1;object-fit:cover;filter:grayscale(1) contrast(1.25);mix-blend-mode:multiply;opacity:.9;-webkit-mask-image:linear-gradient(90deg,transparent,#000 45%);animation:hsfade .8s ease both}
.hs-shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.55) 0,rgba(0,0,0,.1) 30%,rgba(0,0,0,.35) 60%,rgba(0,0,0,.9) 100%)}
.hs-grain{position:absolute;inset:0;pointer-events:none;opacity:.16;mix-blend-mode:overlay;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
/* below the top 56 px, where Spotify's own window buttons and ⋯ menu sit on top of everything */
.hs-bars{position:absolute;top:64px;left:24px;right:24px;display:flex;gap:4px;z-index:3}
.hs-bar{flex:1;height:3px;border-radius:2px;background:rgba(255,255,255,.28);overflow:hidden}
.hs-bar i{display:block;height:100%;background:#fff;transform:scaleX(0);transform-origin:left}
.hs-bar.done i{transform:none}
.hs-bar.on i{animation:hsfill var(--d) linear forwards}
.hs-bar.on.wait i{animation:none}
.hs.paused .hs-bar.on i{animation-play-state:paused}
.hs-top{position:absolute;top:82px;left:24px;right:24px;display:flex;justify-content:space-between;align-items:center;z-index:3}
.hs-kick{font-size:13px;font-weight:800;letter-spacing:.22em;text-transform:uppercase;opacity:.9}
.hs-count{margin-left:14px;opacity:.6;font-variant-numeric:tabular-nums}
.hs-ctls{display:flex;gap:8px}
.hs-ctl{width:44px;height:44px;border-radius:50%;border:0;background:rgba(0,0,0,.35);display:grid;place-items:center;transition:background-color .2s}
.hs-ctl:hover{background:rgba(255,255,255,.2)}
.hs-live{position:absolute;inset:0;z-index:2}
.hs-stage{position:absolute;inset:0;padding:150px 7vw 9vh;display:flex;flex-direction:column;justify-content:flex-end;gap:14px}
.hs-s-summary,.hs-s-quiz,.hs-s-load{justify-content:center}
.hs-in{opacity:0;transform:translateY(26px);animation:hsin .75s cubic-bezier(.2,.8,.2,1) forwards;animation-delay:calc(var(--i,0) * 110ms)}
.hs-h{font-size:clamp(48px,7.4vw,128px);font-weight:900;letter-spacing:-.045em;line-height:.92;margin:0;text-wrap:balance}
.hs-giant{font-size:clamp(64px,10vw,170px)}
.hs-fit{font-size:clamp(40px,5.6vw,96px);overflow-wrap:anywhere}
.hs-h2{font-size:clamp(32px,4vw,64px);font-weight:900;letter-spacing:-.035em;line-height:1;margin:0}
.hs-serif{font-family:"Libre Bodoni","Bodoni 72",Didot,"Bodoni MT",Georgia,serif;font-style:italic;font-weight:400;letter-spacing:-.02em}
.hs-big{font-size:clamp(96px,16vw,260px);font-weight:900;letter-spacing:-.06em;line-height:.85;font-variant-numeric:tabular-nums}
.hs-pct{font-size:.6em;margin-left:.04em}
.hs-p{font-size:clamp(18px,1.7vw,26px);line-height:1.45;max-width:48ch;margin:0;opacity:.94}
.hs-p b,.hs-first b{color:var(--acc)}
.hs-tag{align-self:flex-start;background:var(--acc);color:#000;font-weight:800;font-size:12px;letter-spacing:.14em;text-transform:uppercase;padding:6px 13px;border-radius:999px}
.hs-chip{align-self:flex-start;border:1px solid color-mix(in srgb,var(--acc) 70%,transparent);color:var(--acc);font-weight:800;border-radius:999px;padding:7px 14px;font-size:15px}
.hs-hint{font-size:13px;opacity:.55;margin:18px 0 0}
.hs-first{display:flex;gap:16px;align-items:center;margin-top:22px;max-width:520px;background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:12px 18px 12px 12px}
.hs-first .hx-art{width:64px;height:64px;border-radius:10px}
.hs-first div{display:flex;flex-direction:column;min-width:0}
.hs-first span{font-size:14px;opacity:.75}
.hs-first b{font-size:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hs-row{display:flex;gap:6vw;align-items:center}
.hs-col{display:flex;flex-direction:column;gap:14px;min-width:0;flex:1}
.hs-vinyl{position:relative;flex:none;width:min(46vh,440px);aspect-ratio:1;border-radius:50%;background:repeating-radial-gradient(circle,#0d0d0d 0 2px,#191919 2px 4px);display:grid;place-items:center;box-shadow:0 30px 90px rgba(0,0,0,.6)}
.hs-vinyl .hx-art{width:44%;height:44%;border-radius:50%;animation:hsspin 9s linear infinite}
.hs-vinyl::after{content:"";position:absolute;width:12px;height:12px;border-radius:50%;background:#0a0a0b}
.hs-sleeve{flex:none;width:min(48vh,460px);aspect-ratio:1;box-shadow:0 30px 90px rgba(0,0,0,.65)}
.hs-sleeve .hx-art{width:100%;height:100%;border-radius:6px}
.hs-stats{display:flex;gap:42px;margin-top:10px;flex-wrap:wrap}
.hs-stat{display:flex;flex-direction:column}
.hs-stat b{font-size:clamp(30px,3vw,48px);font-weight:900;letter-spacing:-.03em;color:var(--acc)}
.hs-stat span{font-size:14px;opacity:.75}
.hs-list{display:grid;gap:12px;margin-top:18px;max-width:900px}
.hs-li{display:grid;grid-template-columns:52px 60px minmax(0,1fr) auto;gap:18px;align-items:center}
.hs-num{font-size:42px;text-align:right;color:var(--acc)}
.hs-li .hx-art{width:60px;height:60px;border-radius:8px}
.hs-li .hx-art.round{border-radius:50%}
.hs-li-name{display:flex;flex-direction:column;min-width:0}
.hs-li-name b{font-size:clamp(20px,1.8vw,28px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hs-li-name span{opacity:.7;font-size:15px}
.hs-li-plays{font-variant-numeric:tabular-nums;opacity:.85;font-weight:700}
.hs-when{position:absolute;right:6vw;top:18vh;font-size:clamp(90px,14vw,230px);font-weight:900;letter-spacing:-.05em;color:transparent;-webkit-text-stroke:2px rgba(255,255,255,.3);text-transform:uppercase}
.hs-race{position:relative;height:320px;margin-top:20px;max-width:1000px}
.hs-racer{position:absolute;left:0;right:0;top:0;height:52px;display:flex;align-items:center;gap:18px;transition:transform .6s cubic-bezier(.2,.8,.2,1),opacity .4s}
.hs-racer b{flex:none;width:min(240px,26vw);font-size:22px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hs-track{flex:1;height:34px}
.hs-fill{display:block;height:100%;border-radius:8px;background:rgba(255,255,255,.85);transform-origin:left;transition:transform .6s cubic-bezier(.2,.8,.2,1)}
.hs-racer.lead .hs-fill{background:var(--acc)}
.hs-race-min{flex:none;width:110px;font-variant-numeric:tabular-nums;opacity:.8;font-weight:700}
.hs-quiz{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px;margin-top:22px;max-width:1100px}
.hs-opt{display:flex;flex-direction:column;gap:6px;text-align:left;background:rgba(0,0,0,.4);border:2px solid rgba(255,255,255,.14);border-radius:18px;padding:12px;transition:border-color .2s,translate .2s}
.hs-opt:not(:disabled):hover{border-color:#fff;translate:0 -4px}
.hs-opt .hx-art{width:100%;height:auto;aspect-ratio:1;border-radius:10px}
.hs-opt b{font-size:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hs-opt span{font-size:14px;opacity:.7}
.hs-opt:disabled{cursor:default}
.hs-opt.right{border-color:var(--acc);box-shadow:0 0 0 4px color-mix(in srgb,var(--acc) 40%,transparent)}
.hs-opt.dim>*{opacity:.35}
.hs-opt.wrong>*{opacity:.7}
.hs-opt.wrong{border-style:dashed}
.hs-opt.right::after,.hs-opt.wrong::after{content:"Most played";font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--acc)}
.hs-opt.wrong::after{content:"Your pick";color:#fff}
.hs-answer{margin-top:18px;min-height:1.5em}
.hs-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;margin-top:18px;max-width:1150px}
.hs-four{grid-template-columns:repeat(4,minmax(0,1fr))}
.hs-card{display:flex;flex-direction:column;gap:8px;background:rgba(0,0,0,.42);border:1px solid rgba(255,255,255,.12);border-radius:22px;padding:22px;min-width:0}
.hs-card.empty{opacity:.45}
.hs-card>span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hs-card-kick{display:flex;gap:8px;align-items:center;font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;opacity:.75}
.hs-card-big{font-size:clamp(40px,4vw,64px);font-weight:900;letter-spacing:-.04em;color:var(--acc);line-height:1}
.hs-card-big small{font-size:.4em;color:#fff;opacity:.7;letter-spacing:0}
.hs-sum{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.2fr);gap:36px;width:min(1100px,100%);margin:0 auto;background:rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.14);border-radius:28px;padding:28px;cursor:default}
.hs-sum-art{position:relative;border-radius:18px;overflow:hidden;min-height:360px}
.hs-sum-art .hx-art{position:absolute;inset:0;width:100%;height:100%;border-radius:0;filter:grayscale(1) contrast(1.15)}
.hs-sum-title{position:absolute;left:0;right:0;bottom:0;padding:22px;background:linear-gradient(transparent,rgba(0,0,0,.85));display:flex;flex-direction:column}
.hs-sum-title .hs-serif{font-size:56px;line-height:1;color:var(--acc)}
.hs-sum-title b{font-size:18px;letter-spacing:.14em;text-transform:uppercase}
.hs-sum-body{display:flex;flex-direction:column;gap:22px;justify-content:center;min-width:0}
.hs-sum-cols{display:grid;grid-template-columns:1fr 1fr;gap:24px}
.hs-sum-cols>div{min-width:0}
.hs-sum .hs-list{gap:8px;margin-top:10px}
.hs-sum .hs-li{grid-template-columns:20px 44px minmax(0,1fr);gap:12px}
.hs-sum .hs-num{font-size:26px}
.hs-sum .hs-li .hx-art{width:44px;height:44px}
.hs-sum .hs-li-name b{font-size:17px}
.hs-sum .hs-li-name span{font-size:13px}
.hs-sum .hs-li-plays{display:none}
.hs-sum-album{display:flex;gap:14px;align-items:center;min-width:0}
.hs-sum-album .hx-art{width:60px;height:60px;border-radius:6px}
.hs-sum-album>div{min-width:0}
.hs-shot-msg{align-self:center;margin-right:6px;font-size:13px;font-weight:700;opacity:.85}
.hs-ctl:disabled{opacity:.4;cursor:default}
.hs-sum-big{display:block;font-size:64px;font-weight:900;letter-spacing:-.04em;color:var(--acc);line-height:1.1}
.hs-sum-mid{display:block;font-size:28px;font-weight:900;margin-top:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hs-sum-btns{display:flex;gap:10px}
.hs-btn{white-space:nowrap;border:0;border-radius:999px;padding:11px 22px;background:#fff;color:#000!important;font-weight:800;transition:opacity .2s}
.hs-btn:hover{opacity:.85}
.hs-btn.ghost{background:rgba(255,255,255,.12);color:#fff!important}
@keyframes hsfill{to{transform:none}}
@keyframes hsin{to{opacity:1;transform:none}}
@keyframes hsfade{from{opacity:0}}
@keyframes hsspin{to{transform:rotate(1turn)}}
@media (max-width:1000px){.hs-quiz,.hs-four{grid-template-columns:repeat(2,minmax(0,1fr))}.hs-cards{grid-template-columns:1fr 1fr}.hs-row{gap:4vw}.hs-sum{grid-template-columns:1fr}.hs-sum-art{min-height:200px}}
@media (max-height:760px){.hs-vinyl,.hs-sleeve{width:min(38vh,360px)}.hs-quiz .hx-art{max-height:22vh}.hs-list{gap:6px}}
@media (prefers-reduced-motion:reduce){.hs-in{animation:none;opacity:1;transform:none}.hs-vinyl .hx-art,.hs-bg img{animation:none}.hs-racer,.hs-fill,.hs-opt{transition:none}}
`;
