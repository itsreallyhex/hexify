// Run (from Hexglass/): node --test test/accent.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { hsl, pickAccent, toMs, parseTtml } = require("../theme.js");

const pixels = colors => Uint8ClampedArray.from(colors.flatMap(c => [...c, 255]));

test("picks the vivid colour, not the dark or grey ones, and makes it readable", () => {
  const c = pickAccent(pixels([[10, 10, 10], [128, 128, 128], [200, 30, 40], [240, 240, 240]]));
  const [h, s, l] = hsl(...c);
  assert.ok(h < 10 || h > 350, `hue ${h} should be red`);
  assert.ok(s >= 0.45);
  assert.ok(Math.abs(l - 0.72) < 0.02);
});

test("lyric times in every TTML spelling", () => {
  assert.equal(toMs("00:01:02.345"), 62345);
  assert.equal(toMs("1:02.5"), 62500);
  assert.equal(toMs("62.345s"), 62345);
});

test("timed TTML lines come out sorted and cleaned, plain TTML gives null", () => {
  const timed = `<tt itunes:timing="Line"><body><div><p begin="00:00:05.000" end="00:00:07.000">second &amp; last</p><p begin="00:00:01.500" end="00:00:05.000"><span>first</span> <span>line</span></p></div></body></tt>`;
  assert.deepEqual(parseTtml(timed), [{ t: 1500, text: "first line" }, { t: 5000, text: "second & last" }]);
  assert.equal(parseTtml(`<tt itunes:timing="None"><body><div><p>no timing</p></div></body></tt>`), null);
  assert.equal(parseTtml(null), null);
});

test("a grey cover gives no accent", () => {
  assert.equal(pickAccent(pixels([[0, 0, 0], [90, 92, 90], [250, 250, 250]])), null);
});
