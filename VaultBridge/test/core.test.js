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

test("pickLyrics: timing copied from a take of another length is used as words only", () => {
  const lrc = "[00:18.53]What will you do\n[02:33.37]";
  const short = { duration: 156, syncedLyrics: lrc, plainLyrics: "What will you do" };
  const mislabelled = { duration: 331, syncedLyrics: lrc, plainLyrics: "What will you do" };
  const results = [short, { ...short, duration: 155, syncedLyrics: lrc.replace("do", "do?") }, mislabelled]; // spelling differs, timing same
  const picked = C.pickLyrics(results, 332);
  assert.equal(picked.syncedLyrics, null, "two 2:35 copies outvote one 5:31 label");
  assert.equal(picked.plainLyrics, "What will you do");
  assert.equal(C.pickLyrics(results, 156).syncedLyrics, lrc, "the take the timing belongs to keeps it");
  assert.equal(C.pickLyrics([mislabelled], 332).syncedLyrics, lrc, "a lone copy is trusted");
});

test("ttmlFor falls back to plain when the timed text is unusable", () => {
  assert.match(C.ttmlFor({ syncedLyrics: "garbage", plainLyrics: "Line" }, 0), /timing="None"/);
  assert.equal(C.ttmlFor(null, 0), null);
});

test("juicewrldapi: matched on the base name, same version preferred, empty lyrics skipped", () => {
  const res = [
    { name: "Bask In The Moment (v1)", track_titles: [], lyrics: "wrong song" },
    { name: "Jet Lag (v1)", track_titles: ["Jet Lag (v1)"], lyrics: "v1 words" },
    { name: "Jet Lag (v2)", track_titles: ["Jet Lag (v2)"], lyrics: "v2 words" },
    { name: "Jetlag (v3)", track_titles: [], lyrics: "" },
  ];
  assert.equal(C.pickJw(res, "Jetlag (v2)").lyrics, "v2 words");
  assert.equal(C.pickJw(res, "Jetlag (v9)").lyrics, "v1 words");
  assert.equal(C.pickJw(res, "In The Moment"), null, "a longer title is a different song here");
  assert.equal(C.pickJw([], "x"), null);
});

test("juicewrldapi: timed beats plain, but never another version's timing", () => {
  const res = [
    { name: "Your Mom", track_titles: [], lyrics: "words", synced_lyrics: "" },
    { name: "Your Mom (v1)", track_titles: [], lyrics: "words", synced_lyrics: "[0:00.00] v1 timing" },
    { name: "Your Mom (v2)", track_titles: [], lyrics: "words", synced_lyrics: "[0:00.80] v2 timing" },
    { name: "Your Mom (v3)", track_titles: [], lyrics: "v3 words", synced_lyrics: "" },
  ];
  assert.match(C.pickJw(res, "Your Mom (v2)").synced_lyrics, /v2 timing/);
  assert.match(C.pickJw(res, "Your Mom").synced_lyrics, /timing/, "no version: any timed one");
  assert.equal(C.pickJw(res, "Your Mom (v3)").lyrics, "v3 words", "its own plain text, not v1's timing");
  const t = C.lrcToTtml("[0:00.40] [Intro]\n[0:01.60] First line\n[0:04.00] Second", 10000);
  assert.doesNotMatch(t, /Intro/, "section labels are dropped");
  assert.match(t, /<p begin="00:00:01.600" end="00:00:04.000">First line<\/p>/);
});

test("juicewrldapi: an entry far from the song's length is another take, never used for timing", () => {
  const res = [
    { name: "Tales Of The Toxic", category: "unreleased", length: "2:35", lyrics: "short words", synced_lyrics: "[0:18.53] short" },
    { name: "Tales Of The Toxic", category: "recording_session", length: "", lyrics: "", synced_lyrics: "" },
  ];
  const session = C.pickJw(res, "Tales Of The Toxic (Sessions)", 332);
  assert.equal(C.jwFits(session, 332), false, "2:35 vs 5:32");
  assert.equal(C.jwPlain(session), "short words", "its words can still show, untimed");
  assert.equal(C.jwFits(C.pickJw(res, "Tales Of The Toxic", 156), 156), true);
  assert.equal(C.jwFits({ length: "" }, 300), true, "unknown length is trusted");
  const two = [
    { name: "Sip (v1)", length: "2:12", synced_lyrics: "[0:01.00] v1" },
    { name: "Sip", length: "3:12", lyrics: "fits" },
  ];
  assert.equal(C.pickJw(two, "Sip", 192).lyrics, "fits", "a fitting plain entry beats another take's timing");
  assert.equal(C.lengthSec("16:22"), 982);
  assert.equal(C.lengthSec("1:02:03"), 3723);
  assert.equal(C.lengthSec(""), 0);
  assert.equal(C.jwPlain({ synced_lyrics: "[0:01.00] a\n[0:02.00] b" }), "a\nb");
});

test("ours: lyrics VaultBridge wrote, timed or not; nothing else", () => {
  assert.equal(C.ours(C.plainToTtml("words")), true);
  assert.equal(C.ours(C.lrcToTtml("[0:01.00] x", 5000)), true);
  assert.equal(C.ours('<tt xmlns="http://www.w3.org/ns/ttml" itunes:timing="Line"><body/></tt>'), false, "a hand upload");
  assert.equal(C.ours(null), false);
});

test("choose: juicewrldapi timing beats everything, other sources never touch your uploads", () => {
  const upload = '<tt xmlns="http://www.w3.org/ns/ttml" itunes:timing="Line"><body/></tt>';
  const mine = C.plainToTtml("old"), jw = C.lrcToTtml("[0:01.00] jw", 5000), other = C.plainToTtml("other");
  assert.equal(C.choose(upload, jw, null), jw, "juicewrldapi replaces your upload");
  assert.equal(C.choose(upload, null, other), null, "LRCLIB or plain text never does");
  assert.equal(C.choose(mine, null, other), other, "VaultBridge's own entry is redone");
  assert.equal(C.choose(undefined, null, other), other, "an empty slot is filled");
  assert.equal(C.choose(mine, null, null), null, "nothing found keeps what's there");
  assert.equal(C.choose(jw, jw, null), null, "same lyrics: no write");
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
