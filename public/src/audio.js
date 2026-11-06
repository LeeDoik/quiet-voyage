// Synthesised sounds of the sea. No files: noise and oscillators shaped into water, wind and the
// working boat, and a few soft cues for what the player does and finds. Quiet on purpose: every
// sound belongs to something on screen, and there is no music.
//
//   ambient layers + one-shot cues → master (mute, hidden tab) → limiter → speakers
//
// main.js calls listen(camera) and sea(boat, dt) once a frame. The ambient layers follow the
// boat's real motion; cues with a place in the world are panned, faded and darkened as heard from
// the camera. Starts on the first key or touch, as browsers require.
import { platform } from './platform.js';
import { clearance } from './sea.js';
import { WORLD_RADIUS } from './world-gen.js';

// Linear gains before the limiter, set by measuring the master output in headless Chrome:
// ambience -35 dBFS RMS cruising, -32 under full sail; single cues peak at -20 to -32 dBFS.
const LEVEL = { wash: .07, rush: .11, wind: .105, luff: .045, rain: .05, lap: .11, slap: .17, creak: .11, drop: .06, surf: .15, blow: .14, song: .031, gull: .06, whistle: .026, chime: .05, bloom: .028, motif: .04, cork: .057, paper: .1, page: .08 };
const MAX_VOICES = 16;   // one-shot cues sounding at once; more are dropped

let ctx = null, master = null, noise = null, bed = null, seed = 7, voices = 0, pause = 0, rainLevel = 0, motifAt = 0;
let muted = typeof window === 'object' && platform.read('sea.sound') === 'off';   // node tests import this file
// Own generator: sound variety must not draw from the simulation's Math.random.
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const audible = () => !muted && !(typeof document === 'object' && document.hidden);
const live = () => ctx?.state === 'running' && audible();
const fade = (distance, range) => Math.max(0, 1 - distance / range) ** 2;
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const ear = { x: 0, z: 0, rx: 1, rz: 0 };   // the camera on the water: where it is, and its right hand

function noiseBuffer(channels, seconds, s) {
  const buffer = ctx.createBuffer(channels, ctx.sampleRate * seconds, ctx.sampleRate);
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) { s = (s * 16807) % 2147483647; data[i] = s / 2147483647 * 2 - 1; }
  }
  return buffer;
}

function build() {
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  // A safety net for stacked cues, set high enough that ordinary play never reaches it.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6; limiter.knee.value = 6; limiter.ratio.value = 12; limiter.attack.value = .003; limiter.release.value = .25;
  master = ctx.createGain(); master.gain.value = 0;
  master.connect(limiter).connect(ctx.destination);
  noise = noiseBuffer(1, 2, 91);
  const wide = noiseBuffer(2, 6, 479);   // independent left and right, so the beds sound open
  // A bed: looping noise → filter → shape (for LFOs) → level (set from the boat) → out.
  const layer = (type, hz, q, at, out = master) => {
    const src = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), shape = ctx.createGain(), level = ctx.createGain();
    src.buffer = wide; src.loop = true; filter.type = type; filter.frequency.value = hz; filter.Q.value = q; level.gain.value = 0;
    src.connect(filter).connect(shape).connect(level).connect(out); src.start(0, at);
    return { filter, shape, level };
  };
  const lfo = (hz, ...targets) => {
    const o = ctx.createOscillator(); o.frequency.value = hz;
    for (const [param, depth] of targets) { const d = ctx.createGain(); d.gain.value = depth; o.connect(d).connect(param); }
    o.start(); return o;
  };
  const windPan = ctx.createStereoPanner(); windPan.connect(master);
  bed = { windPan, wash: layer('lowpass', 420, .5, 0), rush: layer('bandpass', 500, .7, 1.7), wind: layer('bandpass', 700, .5, 3.1, windPan), luff: layer('bandpass', 1100, .9, 4.3), rain: layer('bandpass', 1600, .5, 5.2) };
  // The swell: two slow, unrelated sines, so the wash never settles into a beat you can count.
  lfo(.067, [bed.wash.shape.gain, .25], [bed.wash.filter.frequency, 90]);
  lfo(.109, [bed.wash.shape.gain, .15], [bed.wash.filter.frequency, 60]);
  // Gusts riding on the real apparent wind.
  lfo(.13, [bed.wind.shape.gain, .28], [bed.wind.filter.frequency, 110]);
  lfo(.047, [bed.wind.shape.gain, .2]);
  // A luffing sail: noise chopped by a falling saw, each tooth a flap of cloth, at a wandering rate.
  bed.flutter = lfo(7, [bed.luff.shape.gain, -1]); bed.flutter.type = 'sawtooth';
  lfo(.37, [bed.flutter.frequency, 1.5]);
}

// Run the context only while it can be heard: mute or a hidden tab fades it out, then suspends it.
function apply() {
  if (!ctx) return;
  const on = audible();
  clearTimeout(pause);
  master.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, .05);
  if (on) ctx.resume().catch(() => {});
  else pause = setTimeout(() => ctx.suspend().catch(() => {}), 300);
}
function start() {
  if (ctx === null) {
    try { build(); } catch { ctx = false; return; }   // no audio on this device: stay silent, don't retry
    apply();
  } else if (ctx && audible() && ctx.state !== 'running') ctx.resume().catch(() => {});
}
// pointerup too: on touch screens only the lift counts as the gesture that may start audio.
if (typeof window === 'object') for (const e of ['pointerdown', 'pointerup', 'keydown']) window.addEventListener(e, start);
if (typeof document === 'object') document.addEventListener('visibilitychange', apply);

// One cue's way out: its level and pan, and a lowpass when it is far away. Each source adds
// itself; when the last one ends the chain is disconnected and the slot is free again.
function voice(level, pan = 0, hz = 0) {
  if (!live() || voices >= MAX_VOICES || level < 1e-4) return null;
  const out = ctx.createGain(), panner = ctx.createStereoPanner();
  out.gain.value = level; panner.pan.value = pan;
  if (hz) { const lp = ctx.createBiquadFilter(); lp.frequency.value = hz; out.connect(lp).connect(panner); } else out.connect(panner);
  panner.connect(master);
  voices++;
  let open = 0;
  return { out, t: ctx.currentTime + .02, add(src) { open++; src.onended = () => { if (--open === 0) { voices--; panner.disconnect(); } }; } };
}
// A voice at a world position: panned by its bearing from the camera, faded and darkened by distance.
function spot(level, x, z, range) {
  const dx = x - ear.x, dz = z - ear.z, d = Math.hypot(dx, dz);
  if (!(d < range)) return null;
  return voice(level * fade(d, range), d > 1 ? .8 * (dx * ear.rx + dz * ear.rz) / d : 0, 16000 / (1 + d / 40));
}
// Noise through a filter gliding from `hz` to `to`: a rise to `gain` over `attack`, then a long fall.
function hush(v, type, hz, to, q, attack, decay, gain = 1, delay = 0) {
  const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), env = ctx.createGain(), t = v.t + delay, end = t + attack + decay;
  src.buffer = noise; src.loop = true; f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(hz, t); f.frequency.exponentialRampToValueAtTime(to, end);
  env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(gain, t + attack); env.gain.exponentialRampToValueAtTime(.0001, end);
  src.connect(f).connect(env).connect(v.out); src.start(t, rand() * 1.5); src.stop(end + .02); v.add(src);
}
// An oscillator through a filter along [seconds, Hz, gain] points.
function tone(v, type, points, filter = 'lowpass', hz = 4000, q = 1, delay = 0) {
  const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), env = ctx.createGain(), t = v.t + delay;
  o.type = type; f.type = filter; f.frequency.value = hz; f.Q.value = q;
  o.frequency.setValueAtTime(points[0][1], t); env.gain.setValueAtTime(0, t);
  for (const [at, freq, gain] of points) { o.frequency.exponentialRampToValueAtTime(freq, t + at + .001); env.gain.linearRampToValueAtTime(gain, t + at + .001); }
  o.connect(f).connect(env).connect(v.out); o.start(t); o.stop(t + points[points.length - 1][0] + .05); v.add(o);
}
// A struck partial: instant attack, exponential ring-out.
function ring(v, hz, decay, gain = 1, delay = 0) {
  const o = ctx.createOscillator(), env = ctx.createGain(), t = v.t + delay;
  o.frequency.value = hz; env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(gain, t + .004); env.gain.exponentialRampToValueAtTime(.0001, t + decay);
  o.connect(env).connect(v.out); o.start(t); o.stop(t + decay + .02); v.add(o);
}
// Small glass: a fundamental and two inharmonic partials that die away first.
const glass = (v, hz, decay) => { ring(v, hz, decay); ring(v, hz * 2.76, decay * .4, .25); ring(v, hz * 5.4, decay * .18, .08); };

// Water against the hull: a small plap.
function lap(level, pan) {
  const v = voice(LEVEL.lap * level, pan); if (!v) return;
  const hz = 500 + rand() * 600;
  hush(v, 'bandpass', hz, hz * (.3 + rand() * .2), 1 + rand() * 1.5, .008 + rand() * .03, .1 + rand() * .25);
}
// The bow coming down on a wave: a low thump with a little spray on top.
function slap(level) {
  const v = voice(LEVEL.slap * level, (rand() - .5) * .3); if (!v) return;
  hush(v, 'lowpass', 1200, 200, 1, .006, .3);
  hush(v, 'bandpass', 2600, 1000, 1.2, .01, .2, .3, .02);
}
// Hull and rigging working: a stick-slip buzz through a wooden resonance.
function creak(level) {
  const v = voice(LEVEL.creak * (.4 + .6 * level), (rand() - .5) * .5); if (!v) return;
  const base = 24 + rand() * 16, len = .3 + rand() * .35;
  tone(v, 'sawtooth', [[0, base, 0], [.06, base, 1], [len * .6, base * (1.25 + rand() * .3), .8], [len, base * 1.1, 0]], 'bandpass', 320 + rand() * 300, 4);
}
// Rain on the deck: a tick somewhere around the boat.
function drop() {
  const v = voice(LEVEL.drop * (.3 + .7 * rand()), (rand() - .5) * 1.2); if (!v) return;
  const hz = 2500 + rand() * 3000;
  hush(v, 'bandpass', hz, hz * .7, 3 + rand() * 4, .001, .015 + rand() * .03);
}
// A wave breaking on the nearest shore: the swell rises and breaks, and its foam fizzes back.
function surf(x, z) {
  const v = spot(LEVEL.surf, x, z, 210); if (!v) return;
  const rise = .5 + rand() * .6;
  hush(v, 'bandpass', 700 + rand() * 300, 380, .55, rise, 1.6 + rand() * 1.2);
  hush(v, 'bandpass', 2600, 1400, .8, rise + .3, 1.5 + rand(), .35);
}

// What sea() remembers between its steps.
const m = { last: null, step: 0, speed: 0, stir: 0, dip: 0, armed: true, turn: 0, rollAt: 0, creakAt: 0, lapIn: 0, surfIn: 0, shoreIn: 0, shore: null };

export const sfx = {
  /** Once a frame: where the camera is and which way its right hand points on the water. */
  listen(camera) {
    const p = camera.position, q = camera.quaternion;
    const rx = 1 - 2 * (q.y * q.y + q.z * q.z), rz = 2 * (q.x * q.z - q.w * q.y), l = Math.hypot(rx, rz) || 1;
    ear.x = p.x; ear.z = p.z; ear.rx = rx / l; ear.rz = rz / l;
  },
  /** Once a frame with sailing.state(): the wash, wind, water and hull, creaks, rain on deck, surf. */
  sea(s, dt) {
    if (!live() || !bed) { m.last = null; return; }
    if ((m.step += dt) < .05) return;   // twenty updates a second are plenty for smoothed levels
    const h = m.step, now = ctx.currentTime, L = m.last, b = bed;
    m.step = 0;
    const moved = L ? Math.hypot(s.x - L.x, s.z - L.z) : Infinity;
    m.last = { x: s.x, z: s.z, y: s.y, w: s.surfaceHeight, pitch: s.pitch, roll: s.roll };
    if (moved > 40) return;   // the first step, or the boat was placed somewhere new
    // Rates from the boat's pose, so they hold whatever moves the hull; speed too (the title
    // screen's boat lies still whatever its sim speed says).
    const vy = (s.y - L.y) / h, vw = (s.surfaceHeight - L.w) / h, vp = (s.pitch - L.pitch) / h, vr = (s.roll - L.roll) / h;
    const dip = vw - vy - 3 * vp;   // the bow falling onto the water, m/s
    m.speed += (moved / h - m.speed) * (1 - Math.exp(-h / .4));
    m.stir += (Math.abs(vw - vy) + 2.5 * Math.abs(vp) + 1.2 * Math.abs(vr) - m.stir) * (1 - Math.exp(-h / .6));
    m.dip += (Math.abs(dip) - m.dip) * (1 - Math.exp(-h / 6));

    // Hull: a slap when the bow comes down harder than it has lately, and small laps between,
    // busier with motion and speed, on the side that is dipping.
    if (m.armed && dip > Math.max(.08, m.dip * 2.2)) { m.armed = false; slap(Math.min(1, dip / .6)); }
    else if (dip < m.dip) m.armed = true;
    if ((m.lapIn -= h) <= 0) {
      const busy = Math.min(1, m.stir * 1.5 + m.speed * .04), starboard = Math.cos(s.yaw) * ear.rx - Math.sin(s.yaw) * ear.rz;
      lap(.25 + .75 * busy * rand(), starboard * (vr > 0 ? -.3 : .3) + (rand() - .5) * .2);
      m.lapIn = (.4 + rand() * 1.2) * (1.7 - busy);
    }
    // A creak when the roll turns back, now and then, never twice in quick succession.
    const turn = vr > .004 ? 1 : vr < -.004 ? -1 : m.turn;
    if (turn !== m.turn) {
      const swing = Math.abs(s.roll - m.rollAt); m.rollAt = s.roll;
      if (m.turn && now > m.creakAt && swing > .02 && rand() < .5) { creak(Math.min(1, swing / .1)); m.creakAt = now + 5 + rand() * 7; }
      m.turn = turn;
    }
    // Water rushing past the hull, surging as the bow pushes into a wave.
    b.rush.level.gain.setTargetAtTime(LEVEL.rush * Math.min(m.speed, 9) / 7 * (1 + .6 * Math.min(1, Math.max(0, dip))), now, .25);
    b.rush.filter.frequency.setTargetAtTime(280 + 75 * m.speed, now, .3);
    // Wind: the apparent wind, panned toward where it comes from (cos a over the bow, sin a over port).
    const air = s.sail.apparentSpeed, a = s.sail.relativeAngle, fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
    b.wind.level.gain.setTargetAtTime(LEVEL.wind * (.15 + .85 * Math.min(1, air / 12) ** 1.5), now, .5);
    b.wind.filter.frequency.setTargetAtTime(350 + 55 * Math.min(air, 14), now, .5);
    b.windPan.pan.setTargetAtTime(.35 * ((Math.cos(a) * fx + Math.sin(a) * fz) * ear.rx + (Math.cos(a) * fz - Math.sin(a) * fx) * ear.rz), now, .5);
    // The sail luffs when she points into the wind (the rig flutters there too).
    b.luff.level.gain.setTargetAtTime(LEVEL.luff * smooth(.35, .16, s.sail.efficiency) * Math.min(1, air / 5), now, .3);
    b.flutter.frequency.setTargetAtTime(4 + .6 * Math.min(air, 12), now, .5);
    // The open sea, a little rougher in a strong wind.
    b.wash.level.gain.setTargetAtTime(LEVEL.wash * (.75 + .25 * Math.min(2, s.wind.strength)), now, 1.5);
    // Rain: a soft hiss over the water and the odd drop on the deck.
    b.rain.level.gain.setTargetAtTime(LEVEL.rain * rainLevel, now, .8);
    if (rand() < 3 * rainLevel * h) drop();
    // Surf on the nearest coast within reach; the coast lookup runs four times a second.
    if ((m.shoreIn -= h) <= 0) {
      m.shoreIn = .25; m.shore = null;
      if (s.clearance < 230) {
        const c = clearance(s.x, s.z);
        // Land only: the misty edge of the map is reported as a coast too.
        if (c.distance < 210 && c.distance < WORLD_RADIUS - Math.hypot(s.x, s.z) - 1) m.shore = { x: s.x - c.nx * c.distance, z: s.z - c.nz * c.distance };
      }
    }
    if ((m.surfIn -= h) <= 0 && m.shore) { surf(m.shore.x, m.shore.z); m.surfIn = 3 + rand() * 4.5; }
  },
  /** Rain, 0..1, from world.js each frame. */
  rain(level) { rainLevel = level; },
  /** A whale or dolphin breath: a filtered rush of air. */
  blow(x, z, strength) {
    const v = spot(LEVEL.blow * strength, x, z, 700); if (!v) return;
    hush(v, 'bandpass', 1100, 520, .6, .07, 1.25);
    hush(v, 'lowpass', 420, 200, 1, .1, 1.4, .5);
  },
  /** A humpback phrase: slow glides heard as if through the hull. */
  song(x, z) {
    const v = spot(LEVEL.song, x, z, 900); if (!v) return;
    const base = 180 + rand() * 160;
    tone(v, 'sine', [[0, base, 0], [.6, base * 1.6, 1], [1.8, base * .7, .8], [2.6, base * 1.2, .6], [3.4, base * .5, 0]], 'lowpass', 900);
  },
  /** A gull's call: two or three falling, nasal cries. */
  gull(x, z) {
    const v = spot(LEVEL.gull, x, z, 160); if (!v) return;
    const n = 2 + Math.floor(rand() * 2), k = .9 + rand() * .25;
    for (let i = 0; i < n; i++) tone(v, 'sawtooth', [[0, 1500 * k, 0], [.03, 1900 * k, 1], [.22, 1100 * k, .6], [.3, 900 * k, 0]], 'lowpass', 2600, 1, i * .26);
  },
  /** Dolphin whistle: a quick rising-falling chirp. */
  whistle(x, z) {
    const v = spot(LEVEL.whistle, x, z, 150); if (!v) return;
    const f = 5000 + rand() * 3000;
    tone(v, 'sine', [[0, f, 0], [.05, f * 1.4, 1], [.2, f * .8, .7], [.28, f * 1.1, 0]], 'lowpass', 12000);
  },
  /** Light pulse (E): a small glass chime where the light spreads. */
  pulse(x, z) { const v = spot(LEVEL.chime, x, z, 150); if (v) glass(v, 1318.5, 2.2); },
  /** Light trace (R): a lower chime where the light is left. */
  trace(x, z) { const v = spot(LEVEL.chime, x, z, 150); if (v) glass(v, 493.9, 3.2); },
  /** A trace blooms (yours, or someone's you sail through): a tiny chime with its notice. */
  bloom() { const v = voice(LEVEL.bloom); if (v) glass(v, 1975.5, .9); },
  /** A first-ever island or creature: three soft notes, at most one motif every few seconds. */
  discover() {
    if (!live() || ctx.currentTime < motifAt) return;
    const v = voice(LEVEL.motif); if (!v) return;
    motifAt = ctx.currentTime + 4;
    [659.3, 987.8, 830.6].forEach((hz, i) => { ring(v, hz, 1.8, 1, i * .2); ring(v, hz * 2, .9, .18, i * .2); ring(v, hz * 3, .5, .06, i * .2); });
  },
  /** A bottle floated: the cork pressed home, then the plop as it goes over the side. */
  cork() {
    const v = voice(LEVEL.cork); if (!v) return;
    tone(v, 'sine', [[0, 900, 0], [.004, 900, 1], [.03, 380, 0]], 'lowpass', 3000);
    hush(v, 'bandpass', 2200, 1600, 2, .001, .02, .6);
    tone(v, 'sine', [[0, 260, 0], [.006, 260, .8], [.07, 720, .3], [.14, 760, 0]], 'lowpass', 2000, 1, .42);
    hush(v, 'bandpass', 1300, 420, .9, .005, .3, .7, .42);
  },
  /** A bottle found: the letter unrolled. */
  paper() {
    const v = voice(LEVEL.paper); if (!v) return;
    hush(v, 'bandpass', 1800, 2800, .9, .12, .3, .5);
    for (let i = 0, t = .05; i < 5; i++, t += .03 + rand() * .07) hush(v, 'bandpass', 2500 + rand() * 2500, 2000 + rand() * 2000, 1.5 + rand(), .003, .03 + rand() * .05, .5 + rand() * .5, t);
  },
  /** The journal or field guide opened: a page turning. */
  page() {
    const v = voice(LEVEL.page); if (!v) return;
    hush(v, 'bandpass', 1200, 3400, .8, .07, .16);
    hush(v, 'lowpass', 900, 260, 1, .004, .12, .6, .17);
  },
  /** M: sound off or on, remembered on this browser. */
  toggleMute() { muted = !muted; platform.write('sea.sound', muted ? 'off' : 'on'); apply(); },
  state: () => ({ muted }),
};
