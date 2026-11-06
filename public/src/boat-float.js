// How a hull rides the shared swell. Pure numbers (no three.js): the player's boat, every remote
// boat and the tests use the same model, and since the waves are shared, a remote boat's tilt is
// computed here from its position — nothing extra crosses the network.
import { surface, sailWind } from './sea.js';

/** Metres of hull below the mean waterline. The model's keel is .25 m below its origin. */
export const DRAFT = .27;
const KEEL = .25;
// Springs, not filters: the hull has inertia, so it lags a crest, overshoots and settles.
const spring = (period, damping) => { const w = 2 * Math.PI / period; return { k: w * w, c: 2 * damping * w }; };
const HEAVE = spring(1.9, .5), PITCH = spring(2.4, .38), ROLL = spring(3.4, .24);
/** Largest heel the wind puts on her (radians, ~14°). */
export const MAX_HEEL = .24;

/** Heel from the wind on the sail: to leeward, growing with the cross-wind's square. Roll +: starboard up. */
export function windHeel(yaw, speed, t) {
  const air = sailWind(yaw, speed, t), across = air.apparentSpeed * Math.sin(air.relativeAngle);
  return -Math.sign(across) * Math.min(MAX_HEEL, .0042 * across * across);
}

export function createFloat() {
  const s = { y: 0, vy: 0, pitch: 0, vp: 0, roll: 0, vr: 0, ready: false };
  const relax = (axis, key, vel, target, h) => { s[vel] += (axis.k * (target - s[key]) - axis.c * s[vel]) * h; s[key] += s[vel] * h; };
  return {
    state: s,
    reset() { Object.assign(s, { y: 0, vy: 0, pitch: 0, vp: 0, roll: 0, vr: 0, ready: false }); },
    /** One frame; returns height of the model origin, pitch (+ bow up) and roll (+ starboard up). */
    step(dt, x, z, yaw, speed, t, rudder = 0) {
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
      const bow = surface(x + fx * 2.4, z + fz * 2.4, t), stern = surface(x - fx * 2.1, z - fz * 2.1, t);
      const port = surface(x - rx * .85, z - rz * .85, t), starboard = surface(x + rx * .85, z + rz * .85, t);
      const mid = surface(x, z, t);
      const level = (bow + stern + port + starboard + mid * 2) / 6;
      const targetY = level + KEEL - DRAFT;
      // A little bow-up trim with speed; a little lean into the turn.
      const targetPitch = Math.atan2(bow - stern, 4.5) + .014 * Math.min(1, speed / 7);
      const targetRoll = Math.atan2(starboard - port, 1.7) + windHeel(yaw, speed, t) - rudder * .03 * Math.min(1, speed / 4);
      if (!s.ready || !(dt > 0)) { Object.assign(s, { y: targetY, pitch: targetPitch, roll: targetRoll, vy: 0, vp: 0, vr: 0, ready: true }); return s; }
      const n = Math.min(12, Math.ceil(dt * 120)), h = dt / n;
      for (let i = 0; i < n; i++) {
        relax(HEAVE, 'y', 'vy', targetY, h);
        relax(PITCH, 'pitch', 'vp', targetPitch, h);
        relax(ROLL, 'roll', 'vr', targetRoll, h);
      }
      return s;
    },
  };
}
