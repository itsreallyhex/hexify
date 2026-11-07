// Dev check for VaultBridge, run inside Spotify: node cdp.mjs -f vbcheck.js
(async () => {
  await new Promise(r => setTimeout(r, 170000)); // let the first pass get going
  const known = JSON.parse(Spicetify.LocalStorage.get("vaultbridge:known") || "[]");
  const missed = Object.keys(JSON.parse(Spicetify.LocalStorage.get("vaultbridge:nolyrics") || "{}"));
  const db = await new Promise(ok => { const r = indexedDB.open("spicylyrics"); r.onsuccess = () => ok(r.result); });
  const get = (fn) => new Promise(ok => { const r = fn(db.transaction("lyricsStore").objectStore("lyricsStore")); r.onsuccess = () => ok(r.result); });
  const keys = await get(s => s.getAllKeys());
  const k = keys.find(x => /Obsessed|Hypnotic|Hell/.test(x)) || keys[0];
  const sample = k ? await get(s => s.get(k)) : null;
  db.close();
  return JSON.stringify({
    known: known.length,
    lyricsStored: keys.length,
    noLyrics: missed.length,
    sampleKey: k,
    sampleType: sample && (sample.match(/itunes:timing="(\w+)"/) || [])[1],
    sampleStart: sample && sample.slice(sample.indexOf("<div>"), sample.indexOf("<div>") + 160),
  }, null, 1);
})()
