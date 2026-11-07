// Run (from LocalPresence/): node --test test/core.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../localpresence.js");
const H = require("../helper/helper.js");

const local = { uri: "spotify:local:Juice+WRLD:Death+Race+For+Love+%28Sessions%29:Ring+Ring:180", name: "Ring Ring", artists: [{ name: "Juice WRLD" }], album: { name: "Death Race For Love (Sessions)" } };

test("local detection", () => {
  assert.equal(C.isLocal(local.uri), true);
  assert.equal(C.isLocal("spotify:track:285pBltuF7vW8TeWk8hdRR"), false);
  assert.equal(C.isLocal(undefined), false);
});

test("private session: on one song early, off at the change into a streamed song", () => {
  // streamed now, local next: switch on ahead, once Spotify has had a few seconds to send the streamed song
  assert.deepEqual(C.privateStep({ cur: false, next: true, on: false, ours: false, positionMs: 9000 }), { set: true, ours: true });
  assert.deepEqual(C.privateStep({ cur: false, next: true, on: false, ours: false, positionMs: 2000 }), { set: null, ours: false });
  // local -> streamed with a local one after it: off at the start so Spotify shows the streamed song, then on again
  assert.deepEqual(C.privateStep({ cur: false, next: true, on: true, ours: true, positionMs: 0 }), { set: false, ours: false });
  assert.deepEqual(C.privateStep({ cur: false, next: true, on: false, ours: false, positionMs: 8000 }), { set: true, ours: true });
  // local now, streamed next: stay on until the change
  assert.deepEqual(C.privateStep({ cur: true, next: false, on: true, ours: true }), { set: null, ours: true });
  // streamed now and next, ours: off
  assert.deepEqual(C.privateStep({ cur: false, next: false, on: true, ours: true }), { set: false, ours: false });
  // nothing to do
  assert.deepEqual(C.privateStep({ cur: false, next: false, on: false, ours: false }), { set: null, ours: false });
});

test("private session Hex turned on is never touched", () => {
  assert.deepEqual(C.privateStep({ cur: false, next: false, on: true, ours: false }), { set: null, ours: false });
  assert.deepEqual(C.privateStep({ cur: true, next: false, on: true, ours: false }), { set: null, ours: false });
});

test("Hex switching it off by hand drops our claim (and a local song arms it again)", () => {
  assert.deepEqual(C.privateStep({ cur: false, next: false, on: false, ours: true }), { set: null, ours: false });
  assert.deepEqual(C.privateStep({ cur: true, next: false, on: false, ours: true }), { set: true, ours: true });
});

test("whose private session: on at start counts as ours, Hex switching it on later does not", () => {
  assert.equal(C.reported({ wasOn: null, v: true, mine: null, ours: false }), true, "left on from before: ours, goes off by itself");
  assert.equal(C.reported({ wasOn: null, v: false, mine: null, ours: false }), false);
  assert.equal(C.reported({ wasOn: false, v: true, mine: true, ours: true }), true, "our own switch coming back");
  assert.equal(C.reported({ wasOn: false, v: true, mine: null, ours: false }), false, "Hex switched it on");
  assert.equal(C.reported({ wasOn: true, v: true, mine: null, ours: true }), true, "repeat report changes nothing");
});

test("shown: local tracks only, bar from position and length, none while paused", () => {
  const s = C.shown(local, { positionMs: 30000, durationMs: 180000, now: 1000000, image: "https://x/y.jpg" });
  assert.deepEqual(s, { title: "Ring Ring", artist: "Juice WRLD", album: "Death Race For Love (Sessions)", image: "https://x/y.jpg", paused: false, startMs: 970000, endMs: 1150000 });
  const p = C.shown(local, { positionMs: 30000, durationMs: 180000, paused: true, now: 1000000 });
  assert.equal(p.paused, true);
  assert.equal(p.startMs, null);
  assert.equal(p.endMs, null);
  assert.equal(C.shown({ uri: "spotify:track:abc", name: "x" }), null);
  assert.equal(C.shown(null), null);
});

test("same: ignores position jitter, catches seeks and changes", () => {
  const a = C.shown(local, { positionMs: 30000, durationMs: 180000, now: 1000000 });
  assert.equal(C.same(a, C.shown(local, { positionMs: 35800, durationMs: 180000, now: 1005000 })), true, "800 ms of jitter");
  assert.equal(C.same(a, C.shown(local, { positionMs: 90000, durationMs: 180000, now: 1005000 })), false, "a seek");
  assert.equal(C.same(a, C.shown(local, { positionMs: 30000, durationMs: 180000, paused: true, now: 1000000 })), false);
  assert.equal(C.same(null, null), true);
  assert.equal(C.same(a, null), false);
});

test("search cover: track by that artist, else artist photo, else none", () => {
  const track = (name, artist, url) => ({ item: { data: { __typename: "Track", name, artists: { items: [{ profile: { name: artist } }] }, albumOfTrack: { coverArt: { sources: [{ url: url + "-64", width: 64 }, { url, width: 640 }] } } } } });
  const singer = (name, url) => ({ item: { data: { __typename: "Artist", profile: { name }, visuals: { avatarImage: { sources: [{ url, width: 320 }] } } } } });
  const items = [track("Lose Yourself", "Eminem", "https://i.scdn.co/ly"), track("Lucid Dreams", "Juice WRLD", "https://i.scdn.co/ld"), singer("Juice WRLD", "https://i.scdn.co/jw")];
  assert.equal(C.pickSearchImage(items, "Lucid Dreams (v2)", "Juice WRLD"), "https://i.scdn.co/ld", "biggest image of the matching track");
  assert.equal(C.pickSearchImage(items, "Unknown Song", "Juice WRLD, Lil Uzi Vert"), "https://i.scdn.co/jw", "first artist's photo");
  assert.equal(C.pickSearchImage(items, "Lucid Dreams", "Someone Else"), null, "same name, other artist");
  assert.equal(C.pickSearchImage([track("X Song", "Y", "http://insecure")], "X Song", "Y"), null, "https only");
  assert.equal(C.pickSearchImage(undefined, "a", "b"), null);
});

// ---- helper ----

test("IPC frames: op and length little-endian, then JSON; split reads wait for the rest", () => {
  const f = H.frame(1, { cmd: "SET_ACTIVITY" });
  assert.equal(f.readInt32LE(0), 1);
  assert.equal(f.readInt32LE(4), Buffer.byteLength('{"cmd":"SET_ACTIVITY"}'));
  assert.equal(f.subarray(8).toString(), '{"cmd":"SET_ACTIVITY"}');
  const two = Buffer.concat([H.frame(1, { evt: "READY" }), H.frame(2, { code: 1000 })]);
  const part = H.readFrames(two.subarray(0, two.length - 3));
  assert.deepEqual(part.frames, [{ op: 1, data: { evt: "READY" } }]);
  const restFrames = H.readFrames(Buffer.concat([part.rest, two.subarray(two.length - 3)]));
  assert.deepEqual(restFrames.frames, [{ op: 2, data: { code: 1000 } }]);
  assert.equal(restFrames.rest.length, 0);
});

const songs = [
  { id: "rel-1", title: "Lucid Dreams", alt_names: [], category: "released" },
  { id: "ses-1", title: "Ring Ring", alt_names: ["Ring Ring (v1)"], category: "main" },
  { id: "ins-1", title: "Ring Ring", alt_names: [], category: "instrumental" },
  { id: "stem-1", title: "Ring Ring", alt_names: [], category: "stem" },
];

test("vault cover: by title or other name, of the album's kind, Juice WRLD only", () => {
  const cdn = "https://api.juicevault.xyz/cdn/music/covers/";
  assert.equal(H.vaultCover(songs, { title: "Ring Ring", artist: "Juice WRLD", album: "Death Race For Love (Sessions)" }), cdn + "ses-1");
  assert.equal(H.vaultCover(songs, { title: "Ring Ring", artist: "Juice WRLD", album: "Instrumentals" }), cdn + "ins-1");
  assert.equal(H.vaultCover(songs, { title: "Ring Ring", artist: "Juice WRLD", album: "Stem Edits" }), cdn + "stem-1");
  assert.equal(H.vaultCover(songs, { title: "ring ring (v1)", artist: "Juice WRLD, Clever", album: "x" }), cdn + "ses-1", "other name, any kind as last resort");
  assert.equal(H.vaultCover(songs, { title: "Lucid Dreams", artist: "Eminem", album: "x" }), null);
  assert.equal(H.vaultCover(songs, { title: "Nope", artist: "Juice WRLD", album: "x" }), null);
});

test("cover order: vault, then Sessions album art, then the extension's, https only", () => {
  const s = { title: "Not In Vault", artist: "Juice WRLD", album: "Death Race For Love (Sessions)", image: "https://i.scdn.co/x" };
  assert.match(H.coverFor(songs, s), /lastfm/);
  assert.equal(H.coverFor(songs, { ...s, album: "Whatever" }), "https://i.scdn.co/x");
  assert.equal(H.coverFor(songs, { ...s, album: "Whatever", image: "javascript:alert(1)" }), null);
  assert.match(H.coverFor(songs, { ...s, title: "Ring Ring" }), /covers\/ses-1$/);
});

test("activity: Listening, artist under the name, bar in seconds; paused says Paused, no bar", () => {
  const s = { title: "Ring Ring", artist: "Juice WRLD", album: "Death Race For Love (Sessions)", image: null, paused: false, startMs: 1700000000500, endMs: 1700000180500 };
  const a = H.activity(s, songs);
  assert.match(a.assets.small_image, /^https:\/\/cdn\.discordapp\.com\/app-assets\/1548116060031680664\/\d+\.png$/, "close or wide");
  assert.deepEqual(a, {
    type: 2, status_display_type: 1, details: "Ring Ring", state: "Juice WRLD",
    assets: { large_image: "https://api.juicevault.xyz/cdn/music/covers/ses-1", large_text: "Death Race For Love (Sessions)", small_image: a.assets.small_image, small_text: "Juice WRLD" },
    timestamps: { start: 1700000000, end: 1700000180 },
  });
  const p = H.activity({ ...s, paused: true, startMs: null, endMs: null }, songs);
  assert.equal(p.state, "Paused");
  assert.equal(p.timestamps, undefined);
  const bare = H.activity({ title: "X", artist: "", album: "", paused: false, startMs: null }, []);
  assert.equal(bare.details.length, 2, "padded to Discord's 2-character minimum");
  assert.equal(bare.assets, undefined, "no cover: Discord shows the app icon");
  const other = H.activity({ title: "Lose Yourself", artist: "Eminem", album: "8 Mile", image: "https://i.scdn.co/x" }, []);
  assert.equal(other.assets.small_image, undefined, "small picture is Juice WRLD's only");
  assert.equal(H.activity({}, songs), null, "empty body clears");
  assert.equal(H.activity(null, songs), null);
  assert.equal(H.activity({ title: "y".repeat(300), artist: "a" }, []).details.length, 128);
});
