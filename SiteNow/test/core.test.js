// Run (from SiteNow/): node --test test/core.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../sitenow.js");

const streamed = { uri: "spotify:track:285pBltuF7vW8TeWk8hdRR", name: "Lucid Dreams", artists: [{ name: "Juice WRLD" }], metadata: { image_xlarge_url: "spotify:image:ab67616d0000b273f7b7174bef6f3fbfda3a0bb7" } };
const local = { uri: "spotify:local:Juice+WRLD::Let%27s+Ride+%28v3%29:171", name: "Let's Ride (v3)", artists: [{ name: "Juice WRLD" }], metadata: { image_url: "spotify:localfileimage:song.mp3" } };

test("song: cover link for streamed songs, none for local files", () => {
  const s = C.song(streamed, { positionMs: 20000, durationMs: 239000, playing: true });
  assert.equal(s.cover, "https://i.scdn.co/image/ab67616d0000b273f7b7174bef6f3fbfda3a0bb7");
  assert.deepEqual({ ...s, cover: undefined }, { title: "Lucid Dreams", artist: "Juice WRLD", cover: undefined, duration_ms: 239000, position_ms: 20000, playing: true });
  assert.equal(C.song(local, { positionMs: 0, durationMs: 171000, playing: true }).cover, null);
  assert.equal(C.song(null, {}), null);
});

test("several artists are joined", () => {
  const s = C.song({ ...streamed, artists: [{ name: "Juice WRLD" }, { name: "Marshmello" }] }, { playing: true });
  assert.equal(s.artist, "Juice WRLD, Marshmello");
});

const run = (ticks) => {
  let state = {};
  return ticks.map((t) => { const r = C.step(state, t); state = r.state; return r.send; });
};

test("nothing is sent before 15 seconds of a song", () => {
  const sends = run([
    { uri: "a", positionMs: 1000, playing: true, now: 1000 },
    { uri: "a", positionMs: 10000, playing: true, now: 10000 },
    { uri: "b", positionMs: 2000, playing: true, now: 12000 }, // skipped on
    { uri: "c", positionMs: 3000, playing: true, now: 15000 },
  ]);
  assert.deepEqual(sends, [false, false, false, false]);
});

test("sent once at 15 seconds, then quiet while it plays on", () => {
  const sends = run([
    { uri: "a", positionMs: 14000, playing: true, now: 14000 },
    { uri: "a", positionMs: 16000, playing: true, now: 16000 },
    { uri: "a", positionMs: 19000, playing: true, now: 19000 },
    { uri: "a", positionMs: 60000, playing: true, now: 60000 },
  ]);
  assert.deepEqual(sends, [false, true, false, false]);
});

test("pause and play are sent right away once the song was sent", () => {
  const sends = run([
    { uri: "a", positionMs: 16000, playing: true, now: 16000 },
    { uri: "a", positionMs: 20000, playing: false, now: 20000 },
    { uri: "a", positionMs: 20000, playing: false, now: 80000 },
    { uri: "a", positionMs: 20000, playing: true, now: 90000 },
  ]);
  assert.deepEqual(sends, [true, true, false, true]);
});

test("pausing before 15 seconds sends nothing", () => {
  assert.deepEqual(run([
    { uri: "a", positionMs: 5000, playing: true, now: 5000 },
    { uri: "a", positionMs: 6000, playing: false, now: 6000 },
  ]), [false, false]);
});

test("a seek is sent, small timing jitter is not", () => {
  const sends = run([
    { uri: "a", positionMs: 16000, playing: true, now: 16000 },
    { uri: "a", positionMs: 19500, playing: true, now: 19000 }, // 500 ms off: fine
    { uri: "a", positionMs: 90000, playing: true, now: 22000 }, // jumped ahead
    { uri: "a", positionMs: 0, playing: true, now: 25000 },     // same song again from the start (repeat)
  ]);
  assert.deepEqual(sends, [true, false, true, true]);
});

test("token is 64 hex characters", () => {
  const t = C.newToken((a) => { for (let i = 0; i < a.length; i++) a[i] = i * 7; return a; });
  assert.match(t, /^[0-9a-f]{64}$/);
});
