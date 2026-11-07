// Hexed page: your own Wrapped for any time range, plus import / backup.
function render() {
  return Spicetify.React.createElement(HexedApp);
}

// ---- song art + artist photos via Spotify's own GraphQL (cached for the session) ----
var HexedMeta = window.HexedMeta = window.HexedMeta || (() => {
  const cache = new Map();
  const pick = (sources, min = 300) => {
    if (!sources?.length) return null;
    const s = [...sources].sort((a, b) => (a.width || 0) - (b.width || 0));
    return (s.find(x => (x.width || 0) >= min) || s[s.length - 1]).url;
  };
  // Local files: Spotify already reads the cover embedded in the MP3 (spotify:localfileimage:...), which <img> can load.
  let localArt = null;
  const localKey = (n, a) => `${(n || "").toLowerCase()}|${(a || "").toLowerCase()}`;
  function local(uri) {
    localArt ||= Spicetify.Platform.LocalFilesAPI.getTracks().then(list => {
      const m = new Map();
      for (const t of list) {
        const img = t.album?.images?.[0]?.url;
        if (!img) continue;
        m.set(t.uri, img);
        m.set(localKey(t.name, t.artists?.[0]?.name), img); // fallback if the URI encoding differs
      }
      return m;
    }).catch(() => new Map());
    const [, , a, , n] = uri.split(":").map(s => decodeURIComponent(s.replace(/\+/g, " ")));
    return localArt.then(m => { const cover = m.get(uri) || m.get(localKey(n, a)); return cover ? { cover } : null; });
  }
  function track(uri) {
    if (uri?.startsWith("spotify:local:")) return local(uri);
    if (!uri?.startsWith("spotify:track:")) return Promise.resolve(null);
    if (!cache.has(uri)) {
      cache.set(uri, Spicetify.GraphQL.Request(Spicetify.GraphQL.Definitions.getTrack, { uri })
        .then(r => {
          const t = r?.data?.trackUnion;
          if (!t) return null;
          const ar = t.firstArtist?.items?.[0];
          return { cover: pick(t.albumOfTrack?.coverArt?.sources), album: t.albumOfTrack?.uri, artist: ar?.uri, photo: pick(ar?.visuals?.avatarImage?.sources) };
        })
        .catch(() => null));
    }
    return cache.get(uri);
  }
  return { track };
})();

// Most vibrant colour of an image, brightened enough to read on a dark background.
function hexedAccent(url) {
  return new Promise(ok => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onerror = () => ok(null);
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = c.height = 24;
        const g = c.getContext("2d");
        g.drawImage(img, 0, 0, 24, 24);
        const d = g.getImageData(0, 0, 24, 24).data, px = [];
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i], gr = d[i + 1], b = d[i + 2], mx = Math.max(r, gr, b), mn = Math.min(r, gr, b);
          px.push({ s: (mx ? (mx - mn) / mx : 0) * (mx / 255), rgb: [r, gr, b] });
        }
        px.sort((a, b) => b.s - a.s);
        const top = px.slice(0, 12);
        let rgb = [0, 1, 2].map(i => top.reduce((s, p) => s + p.rgb[i], 0) / top.length);
        const mx = Math.max(...rgb);
        if (mx < 190) rgb = rgb.map(v => v * (190 / Math.max(mx, 1)));
        ok(`rgb(${rgb.map(v => Math.min(255, Math.round(v))).join(",")})`);
      } catch { ok(null); } // tainted canvas: keep the theme colour
    };
    img.src = url;
  });
}

// Album covers for local-file albums Spotify has no art for, keyed "album|artist" (lowercase). Source: Last.fm.
// shortcut: hand-picked list; switch to the Last.fm API (needs a free key) if many local albums need covers.
var HEXED_ALBUM_ART = {
  "goodbye & good riddance (sessions)|juice wrld": "https://lastfm-img.freetls.fastly.net/i/u/300x300/ff8591e4ffa5c13f7bb91191f8733ac7.jpg",
  "outsiders (sessions)|juice wrld": "https://lastfm-img.freetls.fastly.net/i/u/300x300/35912a0eaff6ed9f9b9a8e57a9f17cd4.jpg",
  "death race for love (sessions)|juice wrld": "https://lastfm-img.freetls.fastly.net/i/u/300x300/65d8bf225327df3e9edde0d418095785.jpg",
  "wrld on drugs (sessions)|juice wrld": "https://lastfm-img.freetls.fastly.net/i/u/300x300/ea920d57d84dbd4f8a4b29880f48d6ae.jpg",
  "fighting demons (sessions)|juice wrld": "https://lastfm-img.freetls.fastly.net/i/u/300x300/361bf4b81f0038d48d4ef90afc2522f9.jpg",
  "the party never ends (sessions)|juice wrld": "https://lastfm-img.freetls.fastly.net/i/u/300x300/6114e90f259e8f4493a3ca3c34cbe17b.jpg",
};

// Module-level so it keeps its state between renders (defined inside HexedApp it would remount and blink).
function HexedArt({ uri, kind, override }) {
  const R = Spicetify.React;
  const [src, setSrc] = R.useState(override || null);
  R.useEffect(() => {
    if (override) return setSrc(override);
    let live = true;
    HexedMeta.track(uri).then(m => live && setSrc(m && (kind === "photo" ? m.photo || m.cover : m.cover)));
    return () => { live = false; };
  }, [uri, kind, override]);
  const cls = "hx-art" + (kind === "photo" ? " round" : "");
  if (src) return R.createElement("img", { className: cls, src, alt: "", loading: "lazy" });
  // no art anywhere (e.g. a local file without an embedded cover): music note placeholder
  return R.createElement("div", { className: cls + " hx-art-none" },
    R.createElement("svg", { viewBox: "0 0 24 24", fill: "currentColor", "aria-hidden": true }, R.createElement("path", { d: "M9 18V6l11-2v12M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3Zm11-2a3 3 0 1 1-3-3 3 3 0 0 1 3 3Z", fill: "none", stroke: "currentColor", strokeWidth: 1.8 })));
}

function HexedApp() {
  const R = Spicetify.React, h = R.createElement;
  const [recs, setRecs] = R.useState(null);
  const [range, setRange] = R.useState("month");
  const [custom, setCustom] = R.useState({ from: "", to: "" });
  const [msg, setMsg] = R.useState("");
  const [showAll, setShowAll] = R.useState(false);
  const [hero, setHero] = R.useState(null); // { photo, cover, artist }
  const [accent, setAccent] = R.useState(null);
  const fileRef = R.useRef(null);

  const load = () => HexedStore.all().then(setRecs).catch(e => setMsg("Couldn't read your data: " + e.message));
  R.useEffect(() => {
    load();
    const onAdd = e => setRecs(r => (r ? r.concat(e.detail) : r)); // live: new plays show up without reopening
    window.addEventListener("hexed:added", onAdd);
    return () => window.removeEventListener("hexed:added", onAdd);
  }, []);

  const DAY = 86400000, now = Date.now(), y = new Date().getFullYear(), minute = Math.floor(now / 60000);
  const RANGES = {
    week: ["Last 7 days", now - 7 * DAY, now + 1, "the 7 days before"],
    month: ["Last 30 days", now - 30 * DAY, now + 1, "the 30 days before"],
    year: [`${y} so far`, new Date(y, 0, 1).getTime(), now + 1, "the same stretch before"],
    lastyear: [`${y - 1}`, new Date(y - 1, 0, 1).getTime(), new Date(y, 0, 1).getTime(), `${y - 2}`],
    all: ["All time", -Infinity, Infinity, ""],
    custom: ["Custom", custom.from ? new Date(custom.from + "T00:00").getTime() : -Infinity, custom.to ? new Date(custom.to + "T00:00").getTime() + DAY : Infinity, "the period before"],
  };
  const [label, from, to, prevLabel] = RANGES[range];
  const deps = [recs, range, custom.from, custom.to, minute];
  const st = R.useMemo(() => recs && HexedCore.stats(recs, from, to), deps);
  const prev = R.useMemo(() => { const p = recs && HexedCore.prevRange(from, to); return p && HexedCore.stats(recs, p[0], p[1]); }, deps);
  const notes = R.useMemo(() => st ? HexedCore.insights(st, prev, Number.isFinite(from) ? HexedCore.newArtists(recs, from, st) : null, prevLabel) : [], [st, prev]);

  // hero art + accent colour follow the #1 artist of the selected range
  const topArtist = st?.topArtists[0];
  // accent comes from the #1 artist's art, or the top streamed song if that artist is only local files
  const accentUri = topArtist?.u?.startsWith("spotify:track:") ? topArtist.u : st?.topSongs.find(s => s.u?.startsWith("spotify:track:"))?.u;
  R.useEffect(() => {
    let live = true;
    setHero(null);
    if (topArtist?.u) HexedMeta.track(topArtist.u).then(m => live && m && setHero(m));
    return () => { live = false; };
  }, [topArtist?.u]);
  R.useEffect(() => {
    let live = true;
    if (accentUri) HexedMeta.track(accentUri).then(m => m && hexedAccent(m.cover)).then(c => live && c && setAccent(c));
    return () => { live = false; };
  }, [accentUri]);

  async function onImport(e) {
    const files = [...e.target.files];
    e.target.value = "";
    if (!files.length) return;
    setMsg("Importing…");
    try {
      let incoming = [];
      for (const f of files) {
        try { incoming = incoming.concat(HexedCore.parseExport(JSON.parse(await f.text()))); }
        catch (err) { throw new Error(`${f.name}: ${err.message}`); }
      }
      const r = HexedCore.merge(await HexedStore.all(), incoming);
      await HexedStore.replaceAll(r.merged);
      setMsg(`Added ${r.added.toLocaleString()} streams, skipped ${r.skipped.toLocaleString()} already counted` + (r.dropped ? `, replaced ${r.dropped.toLocaleString()} rough account-data rows with the detailed history` : "") + ".");
      load();
    } catch (err) {
      setMsg("Import failed, nothing changed. " + err.message);
    }
  }

  function onBackup() {
    const blob = new Blob([JSON.stringify(recs)], { type: "application/json" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `hexed-backup-${HexedCore.dayStr(Date.now())}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    setMsg("Backup saved to your Downloads. Load it with Import if you ever reinstall Spotify.");
  }

  // ---- small pieces ----
  const fmt = n => (n >= 10000 ? new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n) : Math.round(n).toLocaleString());
  const mins = ms => fmt(ms / 60000);
  const playsTxt = n => fmt(n) + (n === 1 ? " play" : " plays");
  const go = uri => { const [, type, id] = (uri || "").split(":"); if (id) Spicetify.Platform.History.push(`/${type}/${id}`); };

  function Delta({ cur, was }) {
    const d = prev ? HexedCore.delta(cur, was) : null;
    if (d === null) return null;
    return h("span", { className: "hx-delta " + (d >= 0 ? "up" : "down"), title: `vs ${prevLabel}` }, `${d >= 0 ? "↑" : "↓"} ${Math.abs(d)}%`);
  }
  const kpi = (big, small, cur, was) => h("div", { className: "hx-card hx-kpi" }, h("div", { className: "hx-kpi-num" }, big), h("div", { className: "hx-kpi-label" }, small, " ", Delta({ cur, was })));

  const Art = HexedArt;

  function Activity() {
    const start = Number.isFinite(from) ? from : st.first, end = Math.min(Number.isFinite(to) ? to : now, now);
    const pts = [];
    for (let t = new Date(new Date(start).toDateString()).getTime(); t <= end; t += DAY) pts.push([t, st.days.get(HexedCore.dayStr(t)) || 0]);
    let series = pts;
    if (pts.length > 180) { series = []; for (let i = 0; i < pts.length; i += 7) series.push([pts[i][0], pts.slice(i, i + 7).reduce((s, p) => s + p[1], 0)]); }
    const W = 600, H = 120, max = Math.max(1, ...series.map(p => p[1]));
    const x = i => (series.length < 2 ? W / 2 : (i / (series.length - 1)) * W), yv = v => H - (v / max) * (H - 8);
    const line = series.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${yv(p[1]).toFixed(1)}`).join("");
    const dayLabel = t => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return h("div", { className: "hx-card hx-wide" },
      h("div", { className: "hx-card-title" }, series === pts ? "Daily listening" : "Weekly listening", st.bestDay && h("span", { className: "hx-muted" }, ` · peak ${mins(st.bestDay.ms)} min on ${dayLabel(Date.parse(st.bestDay.day + "T12:00"))}`)),
      h("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", className: "hx-area", role: "img", "aria-label": "Listening per day" },
        h("defs", null, h("linearGradient", { id: "hxg", x1: 0, x2: 0, y1: 0, y2: 1 }, h("stop", { offset: "0%", stopColor: "var(--hx-accent)", stopOpacity: 0.45 }), h("stop", { offset: "100%", stopColor: "var(--hx-accent)", stopOpacity: 0 }))),
        series.length > 1 && h("path", { d: `${line}L${W},${H}L0,${H}Z`, fill: "url(#hxg)" }),
        h("path", { d: line, fill: "none", stroke: "var(--hx-accent)", strokeWidth: 2, vectorEffect: "non-scaling-stroke" })),
      h("div", { className: "hx-axis" }, h("span", null, dayLabel(series[0]?.[0] ?? now)), h("span", null, dayLabel(series[series.length - 1]?.[0] ?? now))));
  }

  function Heat() {
    const max = Math.max(1, ...st.heat.flat());
    const order = [1, 2, 3, 4, 5, 6, 0], names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const hr = i => (i === 0 ? "12a" : i < 12 ? i + "a" : i === 12 ? "12p" : i - 12 + "p");
    return h("div", { className: "hx-card hx-wide" },
      h("div", { className: "hx-card-title" }, "When you listen"),
      h("div", { className: "hx-heat", role: "img", "aria-label": "Listening by weekday and hour" },
        order.map(d => h(R.Fragment, { key: d },
          h("span", { className: "hx-heat-day" }, names[d]),
          st.heat[d].map((v, i) => h("span", { key: i, className: "hx-cell", title: `${names[d]} ${hr(i)} · ${mins(v)} min`, style: { background: v ? `color-mix(in srgb, var(--hx-accent) ${Math.round(15 + (v / max) * 85)}%, transparent)` : undefined } })))),
        h("span", null), [0, 6, 12, 18].map(i => h("span", { key: i, className: "hx-heat-hr", style: { gridColumn: `${i + 2} / span 6` } }, hr(i)))),
      h("div", { className: "hx-legend" }, "less", [15, 40, 70, 100].map(p => h("span", { key: p, className: "hx-cell", style: { background: `color-mix(in srgb, var(--hx-accent) ${p}%, transparent)` } })), "more"));
  }

  function TopList({ title, items, kind, line }) {
    const shown = items.slice(0, showAll ? 50 : 10), top = items[0]?.plays || 1;
    return h("section", { className: "hx-list" }, h("h3", null, title),
      shown.length ? shown.map((it, i) => h("button", { key: i, className: "hx-row", onClick: () => (kind === "song" ? it.u && Spicetify.Player.playUri(it.u) : HexedMeta.track(it.u).then(m => go(kind === "photo" ? m?.artist : m?.album))), title: kind === "song" ? "Play" : "Open" },
        h("span", { className: "hx-bar", style: { width: (it.plays / top) * 100 + "%" } }),
        h("span", { className: "hx-rank" }, i + 1),
        h(Art, { uri: it.u, kind: kind === "photo" ? "photo" : "cover", override: kind === "album" ? HEXED_ALBUM_ART[`${it.al}|${it.a}`.toLowerCase()] : undefined }),
        h("span", { className: "hx-name" }, line(it)),
        h("span", { className: "hx-plays" }, fmt(it.plays))))
        : h("p", { className: "hx-muted" }, "Nothing yet"));
  }

  // ---- page ----
  const chips = h("div", { className: "hx-ranges", role: "tablist" },
    Object.entries(RANGES).map(([k, [l]]) => h("button", { key: k, role: "tab", "aria-selected": k === range, className: "hx-chip" + (k === range ? " on" : ""), onClick: () => setRange(k) }, l)),
    range === "custom" && h("span", { className: "hx-custom" },
      h("input", { type: "date", "aria-label": "From", value: custom.from, onChange: e => setCustom({ ...custom, from: e.target.value }) }), " to ",
      h("input", { type: "date", "aria-label": "To", value: custom.to, onChange: e => setCustom({ ...custom, to: e.target.value }) })));

  let body;
  if (!st) {
    body = h("div", { className: "hx-bento" }, [2, 1, 1, 1, 1].map((s, i) => h("div", { key: i, className: "hx-card hx-skel" + (s === 2 ? " hx-hero" : "") })));
  } else if (!st.plays) {
    body = h("div", { className: "hx-card hx-empty" },
      h("div", { className: "hx-kpi-num" }, "Nothing here yet"),
      h("p", { className: "hx-muted" }, recs.length ? "No plays in this range. Try a longer one, like All time." : "Play a few songs (30 seconds counts as a play), or import your Spotify history below to fill this in from day one."));
  } else {
    const song = st.topSongs[0];
    body = h(R.Fragment, null,
      h("div", { className: "hx-bento" },
        h("button", { className: "hx-card hx-hero", onClick: () => go(hero?.artist), title: "Open artist" },
          (hero?.photo || hero?.cover) && h("img", { className: "hx-hero-img", src: hero.photo || hero.cover, alt: "" }),
          h("div", { className: "hx-hero-shade" }),
          h("div", { className: "hx-hero-text" },
            h("span", { className: "hx-tag" }, "#1 artist"),
            h("div", { className: "hx-hero-name" }, topArtist.a),
            h("div", null, `${playsTxt(topArtist.plays)} · ${mins(topArtist.ms)} min · ${Math.round((topArtist.ms / st.ms) * 100)}% of your listening`))),
        kpi(mins(st.ms), "minutes", st.ms, prev?.ms),
        kpi(fmt(st.plays), "plays", st.plays, prev?.plays),
        kpi(fmt(st.uniqueSongs), "songs", st.uniqueSongs, prev?.uniqueSongs),
        kpi(fmt(st.uniqueArtists), "artists", st.uniqueArtists, prev?.uniqueArtists),
        Activity(),
        h("div", { className: "hx-card hx-wide hx-song" },
          h(Art, { uri: song.u, kind: "cover" }),
          h("div", { className: "hx-song-text" },
            h("span", { className: "hx-tag" }, "#1 song"),
            h("div", { className: "hx-song-name" }, song.n),
            h("div", { className: "hx-muted" }, `${song.a} · ${playsTxt(song.plays)}`),
            song.u && h("button", { className: "hx-btn hx-play", onClick: () => Spicetify.Player.playUri(song.u) }, "Play"))),
        h("div", { className: "hx-card hx-wide" },
          h("div", { className: "hx-card-title" }, "Insights"),
          notes.length ? h("ul", { className: "hx-notes" }, notes.slice(0, 5).map((n, i) => h("li", { key: i }, n))) : h("p", { className: "hx-muted" }, "Keep listening. Insights show up once there's a bit more to go on.")),
        Heat()),
      h("div", { className: "hx-cols" },
        TopList({ title: "Top songs", items: st.topSongs, kind: "song", line: s => [h("b", { key: 1 }, s.n), h("span", { key: 2, className: "hx-muted" }, s.a)] }),
        TopList({ title: "Top artists", items: st.topArtists, kind: "photo", line: a => h("b", null, a.a) }),
        TopList({ title: "Top albums", items: st.topAlbums, kind: "album", line: a => [h("b", { key: 1 }, a.al), h("span", { key: 2, className: "hx-muted" }, a.a)] })),
      st.topSongs.length > 10 && h("button", { className: "hx-btn hx-ghost", onClick: () => setShowAll(!showAll) }, showAll ? "Show top 10" : "Show top 50"));
  }

  return h("div", { className: "hx", style: accent ? { "--hx-accent": accent } : undefined },
    h("style", null, HEXED_CSS),
    h("header", { className: "hx-head" },
      h("h1", null, "Hexed"),
      h("p", { className: "hx-sub" }, `You've been Hexed: ${label}`),
      chips),
    body,
    h("details", { className: "hx-data" },
      h("summary", null, `Your data · ${recs ? fmt(recs.length) : "…"} streams saved on this PC`),
      h("p", { className: "hx-muted" }, "Import your Spotify history: unzip the email from Spotify and pick every Streaming_History_Audio_*.json (or StreamingHistory_music_*.json) file. Hexed backups load the same way. Importing twice never double counts."),
      h("input", { ref: fileRef, type: "file", accept: ".json", multiple: true, hidden: true, onChange: onImport }),
      h("button", { className: "hx-btn", onClick: () => fileRef.current.click() }, "Import"),
      h("button", { className: "hx-btn", onClick: onBackup, disabled: !recs?.length }, "Back up"),
      msg && h("p", { className: "hx-msg", role: "status" }, msg)));
}

var HEXED_CSS = `
.hx{--hx-accent:var(--spice-button,#1ed760);--hx-card:rgba(255,255,255,.06);--hx-line:rgba(255,255,255,.08);padding:32px 40px 80px;max-width:1400px;color:var(--spice-text)}
.hx :focus-visible{outline:2px solid var(--hx-accent)!important;outline-offset:2px}
.hx button{font:inherit;color:inherit;cursor:pointer}
.hx-head h1{font-size:72px;font-weight:900;margin:0;letter-spacing:-3px;line-height:1}
.hx-sub{color:var(--spice-subtext);margin:8px 0 18px;font-size:16px}
.hx-muted{color:var(--spice-subtext);font-size:13px}
.hx-ranges{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:24px}
.hx-chip{border:0;border-radius:999px;padding:7px 16px;background:var(--hx-card);font-weight:600;transition:background-color .15s,color .15s}
.hx-chip:hover{background:rgba(255,255,255,.14)}
.hx-chip.on{background:var(--hx-accent);color:#000}
.hx-custom input{background:var(--hx-card);color:var(--spice-text);border:0;border-radius:8px;padding:5px 8px;color-scheme:dark}
.hx-bento{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));grid-auto-rows:minmax(140px,auto);gap:14px}
.hx-card{background:var(--hx-card);border:1px solid var(--hx-line);border-radius:20px;padding:20px;position:relative;overflow:hidden;text-align:left}
.hx-wide{grid-column:span 2}
.hx-card-title{font-weight:800;font-size:15px;margin-bottom:12px}
.hx-hero{grid-column:span 2;grid-row:span 2;min-height:300px;padding:0;border:0;display:block;transition:transform .2s}
.hx-hero:hover{transform:translateY(-2px)}
.hx-hero-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.hx-hero-shade{position:absolute;inset:0;background:linear-gradient(180deg,transparent 30%,color-mix(in srgb,var(--hx-accent) 25%,rgba(0,0,0,.92)) 100%)}
.hx-hero-text{position:absolute;left:24px;right:24px;bottom:22px}
.hx-hero-name{font-size:52px;font-weight:900;letter-spacing:-1.5px;line-height:1.05;margin:8px 0 6px}
.hx-tag{display:inline-block;background:var(--hx-accent);color:#000;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;border-radius:999px;padding:3px 10px}
.hx-kpi{display:flex;flex-direction:column;justify-content:flex-end}
.hx-kpi-num{font-size:44px;font-weight:900;letter-spacing:-1.5px;line-height:1;font-variant-numeric:tabular-nums}
.hx-kpi-label{color:var(--spice-subtext);margin-top:8px;font-size:14px}
.hx-delta{font-weight:800;font-size:12px;border-radius:999px;padding:2px 8px;margin-left:4px}
.hx-delta.up{background:color-mix(in srgb,var(--hx-accent) 22%,transparent);color:var(--hx-accent)}
.hx-delta.down{background:rgba(255,255,255,.08);color:var(--spice-subtext)}
.hx-area{width:100%;height:120px;display:block}
.hx-axis{display:flex;justify-content:space-between;color:var(--spice-subtext);font-size:11px;margin-top:4px}
.hx-song{display:flex;gap:18px;align-items:center}
.hx-song .hx-art{width:124px;height:124px;border-radius:12px;flex:none}
.hx-song-text{min-width:0}
.hx-song-name{font-size:26px;font-weight:900;margin:8px 0 2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hx-play{margin-top:12px}
.hx-notes{margin:0;padding:0;list-style:none;display:grid;gap:10px}
.hx-notes li{padding-left:16px;position:relative;line-height:1.45}
.hx-notes li::before{content:"";position:absolute;left:0;top:.5em;width:7px;height:7px;border-radius:50%;background:var(--hx-accent)}
.hx-heat{display:grid;grid-template-columns:34px repeat(24,1fr);gap:3px;align-items:center}
.hx-heat-day,.hx-heat-hr{font-size:10px;color:var(--spice-subtext)}
.hx-cell{display:block;aspect-ratio:1;border-radius:3px;background:rgba(255,255,255,.05)}
.hx-legend{display:flex;gap:4px;align-items:center;justify-content:flex-end;font-size:10px;color:var(--spice-subtext);margin-top:10px}
.hx-legend .hx-cell{width:10px}
.hx-cols{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:28px;margin-top:36px}
.hx-list h3{font-size:20px;margin:0 0 10px}
.hx-row{position:relative;display:flex;gap:12px;align-items:center;width:100%;border:0;background:none;padding:6px 8px;border-radius:10px;text-align:left;transition:background-color .15s}
.hx-row:hover{background:var(--hx-card)}
.hx-bar{position:absolute;left:0;top:4px;bottom:4px;border-radius:8px;background:color-mix(in srgb,var(--hx-accent) 12%,transparent);pointer-events:none}
.hx-rank{width:20px;text-align:right;color:var(--spice-subtext);font-variant-numeric:tabular-nums;position:relative}
.hx-art{width:40px;height:40px;border-radius:6px;object-fit:cover;flex:none;position:relative;background:rgba(255,255,255,.06)}
.hx-art.round{border-radius:50%}
.hx-art-none{display:flex;align-items:center;justify-content:center;color:var(--spice-subtext)}
.hx-art-none svg{width:45%;height:45%;opacity:.7}
.hx-name{flex:1;min-width:0;display:flex;flex-direction:column;position:relative}
.hx-name b,.hx-name span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hx-plays{color:var(--spice-subtext);font-variant-numeric:tabular-nums;position:relative}
.hx-btn{border:0;border-radius:999px;padding:8px 18px;margin-right:10px;background:var(--spice-text);color:#000!important;font-weight:700;transition:opacity .15s}
.hx-btn:hover{opacity:.85}
.hx-btn:disabled{opacity:.4;cursor:default}
.hx-ghost{background:var(--hx-card);color:var(--spice-text)!important;margin-top:16px}
.hx-empty{padding:40px}
.hx-skel{min-height:140px;animation:hxpulse 1.4s ease-in-out infinite}
.hx-data{margin-top:44px;color:var(--spice-subtext)}
.hx-data summary{cursor:pointer;font-weight:700;margin-bottom:10px}
.hx-msg{margin-top:12px;font-weight:600;color:var(--spice-text)}
@keyframes hxpulse{50%{opacity:.5}}
@media (prefers-reduced-motion:reduce){.hx-skel{animation:none}.hx-hero{transition:none}}
@media (max-width:1100px){.hx-bento{grid-template-columns:repeat(2,minmax(0,1fr))}.hx-cols{grid-template-columns:1fr}}
`;
