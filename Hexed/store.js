// Hexed storage: every stream lives in IndexedDB (big, survives restarts); per-song play counts are cached
// in LocalStorage so the badges never need to load the whole history.
// Loaded by both the tracker and the page: keep one shared instance.
var HexedStore = window.HexedStore = window.HexedStore || (() => {
  let dbp;
  const db = () => (dbp ||= new Promise((ok, bad) => {
    const r = indexedDB.open("hexed", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("plays", { autoIncrement: true });
    r.onsuccess = () => ok(r.result);
    r.onerror = () => bad(r.error);
  }));
  const tx = async (mode, fn) => {
    const d = await db();
    return new Promise((ok, bad) => {
      const t = d.transaction("plays", mode);
      const req = fn(t.objectStore("plays"));
      t.oncomplete = () => ok(req?.result);
      t.onerror = t.onabort = () => bad(t.error);
    });
  };

  const COUNTS = "hexed:counts";
  let counts = null;
  const getCounts = () => (counts ||= JSON.parse(Spicetify.LocalStorage.get(COUNTS) || "{}"));
  const saveCounts = () => Spicetify.LocalStorage.set(COUNTS, JSON.stringify(counts));

  return {
    all: () => tx("readonly", s => s.getAll()),
    count: () => tx("readonly", s => s.count()),
    async add(rec) {
      await tx("readwrite", s => s.add(rec));
      if (HexedCore.isPlay(rec) && rec.u) { const c = getCounts(); c[rec.u] = (c[rec.u] || 0) + 1; saveCounts(); }
      window.dispatchEvent(new CustomEvent("hexed:added", { detail: rec })); // open Hexed page updates live
    },
    async replaceAll(recs) {
      await tx("readwrite", s => { s.clear(); for (const r of recs) s.add(r); });
      counts = Object.fromEntries(HexedCore.counts(recs));
      saveCounts();
      window.dispatchEvent(new Event("hexed:counts"));
    },
    playsOf: uri => getCounts()[uri] || 0,
  };
})();
