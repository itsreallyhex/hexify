// Hexed tracker: logs every song played in this Spotify window and shows your play count on tracks.
(function hexedTracker() {
  const S = window.Spicetify;
  if (!S?.Player?.addEventListener || !S.Player.data || !S.LocalStorage || !window.HexedCore || !window.HexedStore) return setTimeout(hexedTracker, 300);

  // ---- tracking ----
  const CUR = "hexed:current"; // in-progress stream, so a Spotify crash/close loses at most ~10s
  let cur = null, lastPos = 0, lastSnap = 0;

  const save = rec => HexedStore.add(rec).then(paintNowPlaying).catch(e => console.error("[hexed] save failed", e));

  function finish() {
    if (cur && cur.ms > 0) save(cur);
    cur = null;
    S.LocalStorage.remove(CUR);
  }

  function begin() {
    const it = S.Player.data?.item;
    const u = it?.uri || "";
    if (!/^spotify:(track|local):/.test(u)) { cur = null; return; } // skip podcasts and ads
    lastPos = S.Player.getProgress() || 0;
    cur = { s: Date.now() - lastPos, ms: 0, u, n: it.name || "", a: it.artists?.[0]?.name || "", al: it.album?.name || "", src: "live" };
  }

  S.Player.addEventListener("songchange", () => { finish(); begin(); paintNowPlaying(); });
  S.Player.addEventListener("onprogress", e => {
    if (!cur) return;
    const p = e.data, d = p - lastPos;
    lastPos = p;
    if (d < -5000 && p < 3000) { finish(); begin(); return; } // same song restarted (repeat one)
    if (d > 0 && d < 3000 && S.Player.isPlaying()) cur.ms += d; // ignores seeks and pauses
    if (Date.now() - lastSnap > 10000) { lastSnap = Date.now(); S.LocalStorage.set(CUR, JSON.stringify(cur)); }
  });

  let left = null;
  try { left = JSON.parse(S.LocalStorage.get(CUR) || "null"); } catch {}
  S.LocalStorage.remove(CUR);
  begin();
  if (cur && HexedCore.shouldResume(left, cur.u, lastPos)) cur = left; // same listen continues after a reload
  else if (left?.ms > 0) save(left);

  // ---- play count badges ----
  const css = document.createElement("style");
  css.textContent = `.hexed-badge{margin-inline-start:8px;font-size:11px;font-weight:700;color:var(--spice-button,#1ed760);opacity:.9;white-space:nowrap}`;
  document.head.append(css);

  function badge(host, n) {
    let b = host.querySelector(":scope > .hexed-badge");
    if (!n) return b?.remove();
    if (!b) { b = document.createElement("span"); b.className = "hexed-badge"; b.title = "Your plays (Hexed)"; host.append(b); }
    const text = `${n} play${n === 1 ? "" : "s"}`;
    if (b.textContent !== text) b.textContent = text;
  }

  // Spotify 1.3.8 rows have no track links; the row's React props carry `uri` a few levels up.
  function rowUri(row) {
    const fk = Object.keys(row).find(k => k.startsWith("__reactFiber"));
    for (let f = fk && row[fk], i = 0; f && i < 6; f = f.return, i++) {
      const u = f.memoizedProps?.uri;
      if (typeof u === "string" && u.startsWith("spotify:track:")) return u;
    }
    return null;
  }

  function paintRows() {
    for (const row of document.querySelectorAll('main [role="row"]')) {
      const title = row.querySelector('[aria-colindex="2"] [dir="auto"]');
      const u = title && rowUri(row);
      if (u) badge(title.parentElement, HexedStore.playsOf(u));
    }
  }

  // Spotify 1.3.8's now-playing title has no link or test id: find the leaf span holding the song name.
  function paintNowPlaying() {
    const w = document.querySelector('[data-testid="now-playing-widget-v2"], [data-testid="now-playing-widget"]');
    const item = S.Player.data?.item;
    if (!w || !item) return;
    const title = [...w.querySelectorAll("span")].find(s => !s.children.length && s.textContent === item.name);
    if (title) badge(title.parentElement, HexedStore.playsOf(item.uri));
  }

  let queued = false;
  const repaint = () => { if (queued) return; queued = true; setTimeout(() => { queued = false; paintRows(); paintNowPlaying(); }, 250); };
  // ignore our own badge edits so painting doesn't retrigger itself
  new MutationObserver(muts => { if (muts.some(m => !(m.target instanceof Element && m.target.closest(".hexed-badge")) && ![...m.addedNodes].every(n => n.classList?.contains("hexed-badge")))) repaint(); })
    .observe(document.body, { childList: true, subtree: true });
  window.addEventListener("hexed:counts", repaint);
  repaint();
})();
