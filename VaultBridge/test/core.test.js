// Run (from VaultBridge/): node --test test/core.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../vaultbridge.js");

test("LRC parses, sorts, keeps blank gap lines and skips tags", () => {
  const l = C.parseLrc("[ar:Juice WRLD]\n[00:12.34]Second\n[00:01.5]First\n[00:20.00]\n[01:02.345][01:10.00]Twice");
  assert.deepEqual(l.map(x => [x.at, x.text]), [[1500, "First"], [12340, "Second"], [20000, ""], [62345, "Twice"], [70000, "Twice"]]);
});

test("timed lyrics become line-synced TTML that ends each line at the next", () => {
  const t = C.lrcToTtml("[00:01.00]Ayy & <yeah>\n[00:03.50]Line two\n[00:05.00]\n[00:09.00]Last", 10000);
  assert.match(t, /itunes:timing="Line"/);
  assert.match(t, /<p begin="00:00:01.000" end="00:00:03.500">Ayy &amp; &lt;yeah&gt;<\/p>/);
  assert.match(t, /<p begin="00:00:03.500" end="00:00:05.000">Line two<\/p>/, "a blank line ends the one before");
  assert.match(t, /<p begin="00:00:09.000" end="00:00:10.000">Last<\/p>/, "the last line is capped at the song's end");
  assert.equal((t.match(/<p /g) || []).length, 3, "blank lines are not shown");
  assert.equal(C.lrcToTtml("no stamps here"), null);
});

test("plain lyrics become static TTML", () => {
  const t = C.plainToTtml("One\n\n  Two  \n");
  assert.match(t, /itunes:timing="None"/);
  assert.match(t, /<p>One<\/p><p>Two<\/p>/);
  assert.equal(C.plainToTtml("   "), null);
});

test("clock formatting", () => {
  assert.equal(C.clock(3723456), "01:02:03.456");
  assert.equal(C.clock(-5), "00:00:00.000");
});

test("search title drops versions and features", () => {
  assert.equal(C.searchTitle("Bandit (v5) [feat. YoungBoy Never Broke Again]"), "Bandit");
  assert.equal(C.searchTitle("Lovely (Remix) [feat. Billie Eilish & Khalid]"), "Lovely");
  assert.equal(C.searchTitle("Already Dead"), "Already Dead");
});

test("pickLyrics: timed beats plain, closest length wins, far off or instrumental is refused", () => {
  const plain = { duration: 200, plainLyrics: "p" };
  const timedFar = { duration: 215, syncedLyrics: "[00:01.00]x" };
  const timedNear = { duration: 203, syncedLyrics: "[00:01.00]y" };
  const instr = { duration: 200, instrumental: true, plainLyrics: "" };
  assert.equal(C.pickLyrics([plain, timedFar, timedNear, instr], 200), timedNear);
  assert.equal(C.pickLyrics([plain, timedFar], 200), plain, "a timed copy 15s off is a different recording");
  assert.equal(C.pickLyrics([timedFar], 200), null);
  assert.equal(C.pickLyrics([], 200), null);
});

test("ttmlFor falls back to plain when the timed text is unusable", () => {
  assert.match(C.ttmlFor({ syncedLyrics: "garbage", plainLyrics: "Line" }, 0), /timing="None"/);
  assert.equal(C.ttmlFor(null, 0), null);
});

test("juicewrldapi fallback: matched on the base name, same version preferred, empty lyrics skipped", () => {
  const res = [
    { name: "Bask In The Moment (v1)", track_titles: [], lyrics: "wrong song" },
    { name: "Jet Lag (v1)", track_titles: ["Jet Lag (v1)"], lyrics: "v1 words" },
    { name: "Jet Lag (v2)", track_titles: ["Jet Lag (v2)"], lyrics: "v2 words" },
    { name: "Jetlag (v3)", track_titles: [], lyrics: "" },
  ];
  assert.equal(C.pickJwLyrics(res, "Jetlag (v2)"), "v2 words");
  assert.equal(C.pickJwLyrics(res, "Jetlag (v9)"), "v1 words");
  assert.equal(C.pickJwLyrics(res, "In The Moment"), null, "a longer title is a different song here");
  assert.equal(C.pickJwLyrics([], "x"), null);
});

test("newTracks: only unseen URIs, newest first", () => {
  const tracks = [
    { uri: "a", addedAt: "2026-11-01T00:00:00Z" },
    { uri: "b", addedAt: "2026-11-07T00:00:00Z" },
    { uri: "c", addedAt: "2026-11-05T00:00:00Z" },
  ];
  assert.deepEqual(C.newTracks(tracks, new Set(["a"])).map(t => t.uri), ["b", "c"]);
  assert.deepEqual(C.newTracks(tracks, new Set(["a", "b", "c"])), []);
});
