import assert from 'node:assert/strict';
import { createResolution, resolutionStep, RES } from '../public/src/resolution.js';

const dt = 1 / 60;
/** Run `seconds` with a frame rate that depends on the ratio: fps(ratio). Returns the ratios seen. */
function run(s, seconds, fps) {
  const seen = [];
  for (let i = 0; i < seconds / dt; i++) seen.push(resolutionStep(s, fps(s.ratio), dt));
  return seen;
}

{ // A screen capped at 30 fps (power saving, a 30 Hz display): fewer pixels do not help, so a try
  // is undone at once and tried again ever more rarely; the picture stays sharp.
  const s = createResolution(2);
  const seen = run(s, 600, () => 30);
  const sharp = seen.filter(r => r === 2).length / seen.length;
  assert(sharp > .98, `a capped frame rate keeps full resolution (${(sharp * 100).toFixed(1)}% of the time)`);
  assert.equal(seen.at(-1), 2);
  let tries = 0; for (let i = 1; i < seen.length; i++) if (seen[i] < seen[i - 1]) tries++;
  assert(tries <= 4, `a few tries in ten minutes (${tries})`);
}
{ // Slow from the first frame (a weak GPU never shows a better rate): it still drops while that helps.
  const s = createResolution(2);
  const seen = run(s, 60, r => Math.min(60, 22 / (r * r)));
  assert.equal(seen.at(-1), 1, 'down to the floor');
  assert(s.strained, 'and strained there, so effects go next');
}
{ // A fill-bound GPU on a 60 Hz screen: the rate rises as pixels go, so it drops until it holds, and no further.
  const s = createResolution(2);
  const fps = r => Math.min(60, 48 / (r * r) * 2.2);   // 2.0 -> 26 fps, 1.3 -> 60 fps
  run(s, 60, () => 60);                                   // learn the screen's rate first
  const seen = run(s, 120, fps);
  const end = seen.at(-1);
  assert(end < 1.6 && end >= s.min, `dropped to a ratio that holds the rate (${end.toFixed(2)})`);
  assert(fps(end) >= RES.slow, 'the rate recovers');
}
{ // CPU-bound: the rate does not move with the ratio, so the first drop is taken back and drops rest.
  const s = createResolution(2);
  run(s, 30, () => 60);
  const seen = run(s, 60, () => 35);
  assert.equal(seen.at(-1), 2, 'a drop that did not help is undone');
  assert(Math.min(...seen) >= 2 * RES.drop - 1e-9, 'only one probing step was tried');
}
{ // Never below one pixel per CSS pixel, however slow.
  const s = createResolution(3, 1.5);
  run(s, 20, () => 60);
  const seen = run(s, 300, r => 10 / r);
  assert(Math.min(...seen) >= 1, 'the floor holds at 1');
}
{ // Room to spare: a phone that starts at 1.5 sharpens toward 2 while the rate holds.
  const s = createResolution(2, 1.5);
  const seen = run(s, 120, () => 60);
  assert.equal(seen.at(-1), 2, 'sharpens to the maximum');
}
{ // Loading stutter in the first seconds is not judged.
  const s = createResolution(2);
  const seen = run(s, RES.warmup - .5, () => 12);
  assert.equal(Math.min(...seen), 2, 'no change during warm-up');
}
console.log('resolution: capped screens keep resolution, fill-bound drops, futile drops undone, floor at 1, sharpen, warm-up passed');

{ // At the floor and still slow: strained, so the game turns effects down instead.
  const s = createResolution(1);
  run(s, 20, () => 60);
  run(s, 10, () => 20);
  assert.equal(s.ratio, 1); assert(s.strained, 'strained at the floor');
  run(s, 10, () => 60); assert(!s.strained, 'relieved once the rate is back');
}
console.log('resolution: strain at the floor passed');
