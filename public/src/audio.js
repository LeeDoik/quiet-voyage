// Synthesised sounds of the sea, one AudioContext for the game's cues (sailing.js keeps its own
// ambient bed). Everything is made from noise and oscillators, so there are no files to load.
// Starts on the first key or touch, as browsers require. Distance fades every cue.
let ctx = null, noise = null, out = null, rainGain = null, seed = 7;
// Own generator: sound variety must not draw from the simulation's Math.random.
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

function start() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noise.getChannelData(0);
    let s = 91; for (let i = 0; i < data.length; i++) { s = (s * 16807) % 2147483647; data[i] = s / 2147483647 * 2 - 1; }
    out = ctx.createGain(); out.gain.value = .9; out.connect(ctx.destination);
  } catch { ctx = null; }
}
if (typeof window === 'object') for (const e of ['pointerdown', 'keydown']) window.addEventListener(e, start);

const fade = (distance, range) => Math.max(0, 1 - distance / range) ** 2;
function noiseBurst(level, freq, q, attack, decay, type = 'lowpass') {
  const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), t = ctx.currentTime;
  src.buffer = noise; src.loop = true; f.type = type; f.frequency.value = freq; f.Q.value = q;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + attack); g.gain.exponentialRampToValueAtTime(.0001, t + attack + decay);
  src.connect(f).connect(g).connect(out); src.start(t, rand() * 1.5); src.stop(t + attack + decay + .05);
}
function tone(type, level, points, filterHz = 4000) {
  const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain(), t = ctx.currentTime;
  o.type = type; f.type = 'lowpass'; f.frequency.value = filterHz;
  o.frequency.setValueAtTime(points[0][1], t);
  g.gain.setValueAtTime(0, t);
  for (const [at, hz, gain] of points) { o.frequency.exponentialRampToValueAtTime(hz, t + at + .001); g.gain.linearRampToValueAtTime(level * gain, t + at + .001); }
  const end = points[points.length - 1][0];
  o.connect(f).connect(g).connect(out); o.start(t); o.stop(t + end + .05);
}

export const sfx = {
  /** A whale or dolphin breath: a filtered rush of air. */
  blow(distance, strength) {
    if (!ctx || distance > 700) return;
    noiseBurst(.5 * strength * fade(distance, 700), 900 - Math.min(600, distance), .7, .08, 1.3);
  },
  /** A gull's call: two or three falling, nasal cries. */
  gull(distance) {
    if (!ctx || distance > 160) return;
    const level = .09 * fade(distance, 160), n = 2 + Math.floor(rand() * 2);
    for (let i = 0; i < n; i++) setTimeout(() => ctx && tone('sawtooth', level, [[0, 1500, 0], [.03, 1900, 1], [.22, 1100, .6], [.3, 900, 0]], 2600), i * 260);
  },
  /** A humpback phrase: slow glides heard as if through the hull. */
  song(distance) {
    if (!ctx || distance > 900) return;
    const level = .12 * fade(distance, 900), base = 180 + rand() * 160;
    tone('sine', level, [[0, base, 0], [.6, base * 1.6, 1], [1.8, base * .7, .8], [2.6, base * 1.2, .6], [3.4, base * .5, 0]], 900);
  },
  /** Dolphin whistle: a quick rising-falling chirp. */
  whistle() {
    if (!ctx) return;
    const b = 5000 + rand() * 3000;
    tone('sine', .035, [[0, b, 0], [.05, b * 1.4, 1], [.2, b * .8, .7], [.28, b * 1.1, 0]]);
  },
  /** The hull and rigging working in a swell. */
  creak(level) {
    if (!ctx) return;
    noiseBurst(.05 + .08 * Math.min(1, level), 180 + rand() * 120, 14, .06, .45, 'bandpass');
  },
  /** Continuous rain hiss, 0..1. */
  rain(level) {
    if (!ctx) return;
    if (!rainGain) {
      const src = ctx.createBufferSource(), f = ctx.createBiquadFilter();
      src.buffer = noise; src.loop = true; f.type = 'highpass'; f.frequency.value = 1800;
      rainGain = ctx.createGain(); rainGain.gain.value = 0;
      src.connect(f).connect(rainGain).connect(out); src.start();
    }
    rainGain.gain.setTargetAtTime(level * .22, ctx.currentTime, .8);
  },
};
