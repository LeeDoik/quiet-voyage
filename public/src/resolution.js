// Dynamic resolution for the web build: trade sharpness for frame rate, but only where the trade
// works. Pure state, no DOM, so tests can run it (tests/resolution.mjs); graphics.js feeds it the
// measured frame rate and applies the pixel ratio it returns.
//
// - Never below one pixel per CSS pixel: the HUD is painted at the same resolution, and text below
//   that breaks up.
// - "Slow" is judged against the best rate this screen reaches, not a fixed 60: a display or a
//   power-saving mode that caps the frame rate at 30 is not a slow GPU, and fewer pixels would not
//   make it faster.
// - A drop must pay for itself: if the rate does not rise afterwards, the pixels were not the
//   bottleneck, so the old ratio comes back and drops rest for a while. A raise that costs the rate
//   is taken back the same way.
// - Nothing is judged in the first seconds, while shaders compile and the world streams in.
export const RES = {
  warmup: 6,          // seconds before the first judgement
  every: 2,           // seconds between judgements
  slow: 46,           // below this many frames a second (or below `headroom` of the best) is slow
  headroom: .8,
  settle: .93,        // at this share of the best rate there is room to sharpen
  drop: .85, raise: 1.12,
  payoff: 1.08,       // a drop must lift the rate by this factor to stay
  raiseRest: 20,      // seconds after a drop before sharpening again
  futileRest: 90,     // seconds without drops after one that did not help
  forget: 600,        // seconds over which the best rate seen fades (a move to another screen)
};

export function createResolution(max, start = max) {
  const min = Math.min(1, max);
  return { min, max, ratio: Math.min(max, Math.max(min, start)), best: 0, warm: RES.warmup, clock: 0, raiseAfter: 0, dropAfter: 0, last: null };
}

/** One frame: `fps` is the rate measured over the last second (0 or null when unknown). Returns the ratio to draw at. */
export function resolutionStep(s, fps, dt) {
  if (!(fps > 0)) return s.ratio;
  s.best = Math.max(s.best * Math.exp(-dt / RES.forget), fps);
  s.warm -= dt; s.raiseAfter -= dt; s.dropAfter -= dt;
  if (s.warm > 0) return s.ratio;
  s.clock += dt;
  if (s.clock < RES.every) return s.ratio;
  s.clock = 0;
  const slow = fps < Math.min(RES.slow, s.best * RES.headroom);
  // Judge the last change first.
  const last = s.last; s.last = null;
  if (last?.kind === 'drop' && fps < last.fps * RES.payoff) {
    s.ratio = last.from; s.dropAfter = RES.futileRest; return s.ratio;
  }
  if (last?.kind === 'raise' && slow) {
    s.ratio = last.from; s.raiseAfter = RES.futileRest; return s.ratio;
  }
  if (slow && s.ratio > s.min && s.dropAfter <= 0) {
    s.last = { kind: 'drop', from: s.ratio, fps };
    s.ratio = Math.max(s.min, s.ratio * RES.drop); s.raiseAfter = RES.raiseRest;
  } else if (!slow && fps >= s.best * RES.settle && s.ratio < s.max && s.raiseAfter <= 0) {
    s.last = { kind: 'raise', from: s.ratio, fps };
    s.ratio = Math.min(s.max, s.ratio * RES.raise);
  }
  return s.ratio;
}
