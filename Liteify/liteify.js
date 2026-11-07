// Liteify: a lighter Spotify.
// Lite mode (leaf button, green = on): no blur, no Canvas/videos, no looping animations.
// Away mode (automatic): the same while Spotify is unfocused, plus animated canvases hidden.
// Measured on Spotify 1.3.8: this saves CPU, not RAM. The big RAM win is Spotify's own
// "hardware acceleration" setting OFF (1.39 GB -> 0.99 GB); lite mode keeps that setting smooth,
// because blur and animations are the expensive parts to draw without the GPU.
// (A "sleep mode" that unmounted the UI when unfocused was tried and removed: it freed ~0 MB.)
(function liteify() {
  const S = window.Spicetify;
  if (!S?.Playbar?.Button || !S.LocalStorage) return setTimeout(liteify, 300);

  const root = document.documentElement;
  const style = document.createElement("style");
  style.id = "liteify-style";
  style.textContent = `
    html.liteify-lite *, html.liteify-lite *::before, html.liteify-lite *::after,
    html.liteify-away *, html.liteify-away *::before, html.liteify-away *::after {
      backdrop-filter: none !important; animation-duration: 0.001s !important; animation-iteration-count: 1 !important;
    }
    html.liteify-lite video, html.liteify-away video { display: none !important; }
    html.liteify-away canvas { visibility: hidden !important; } /* animated backgrounds (e.g. Spicy Lyrics) */
  `;
  document.head.append(style);

  // Away mode: on a second monitor Spotify keeps animating while you're in another window.
  // Go lite while unfocused, restore on focus. Nothing unmounts, so coming back is instant.
  const away = on => root.classList.toggle("liteify-away", on);
  window.addEventListener("blur", () => away(true));
  window.addEventListener("focus", () => away(false));
  away(!document.hasFocus());

  const KEY = "liteify:lite";
  // leaf; explicit width/height or Spotify renders it tiny
  const ICON = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M14.8 1.2C7.6.9 2.6 4.2 2.1 9.6c-.1 1.4.2 2.6.8 3.5L1.2 14.8l.9.9 1.7-1.7c.9.6 2.1.9 3.5.8 5.4-.5 8.7-5.5 8.4-12.7zM4.6 12.3c1.6-3 4-5.5 7.3-7.4l.6 1c-3.1 1.8-5.3 4-6.8 6.9z"/></svg>`;
  const isLite = () => root.classList.contains("liteify-lite");
  const setLite = on => { root.classList.toggle("liteify-lite", on); S.LocalStorage.set(KEY, on ? "1" : "0"); };
  const label = () => `Liteify lite mode: ${isLite() ? "ON" : "OFF"}`;

  setLite(S.LocalStorage.get(KEY) !== "0"); // on by default
  new S.Playbar.Button(label(), ICON, self => {
    setLite(!isLite());
    self.active = isLite();
    self.label = label();
  }, false, isLite(), true);
})();
