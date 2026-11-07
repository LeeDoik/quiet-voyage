import { islandsNear } from './world-gen.js';
import { clearance } from './sea.js';

// Autopilot (T): the boat sails itself from island to island. It picks the nearest island it has not
// yet passed (favouring ones ahead), steers to pass along its shore, then picks the next. Land and the
// misty edge are kept clear by looking ahead along a few headings and taking the nearest clear one.
// Deterministic: no randomness, so it behaves the same for everyone.
const SEARCH = 2400, PASS = 45, LOOK = [22, 45, 75], CLEAR = 16, FAR = 350;
const SWERVE = [0, .3, -.3, .6, -.6, .9, -.9, 1.25, -1.25, 1.6, -1.6, 2.1, -2.1, 2.7, -2.7];
const turnOf = a => Math.atan2(Math.sin(a), Math.cos(a));
const headingTo = (dx, dz) => Math.atan2(-dx, -dz);       // yaw whose bow points along (dx, dz)

export function createAutopilot() {
  let on = false, target = null, waypoint = null, swerve = 0, look = 0, cruise = 0, search = 0, budget = 0;
  const passed = [], near = [];
  const reach = s => Math.max(s.rx, s.rz) * (1 + Math.abs(s.a2) + Math.abs(s.a3) + Math.abs(s.a5)) + PASS;
  function choose(b) {
    let best = null, score = Infinity;
    for (const s of islandsNear(b.x, b.z, SEARCH, near)) {
      if (passed.includes(s.id)) continue;
      const d = Math.hypot(s.x - b.x, s.z - b.z), off = Math.abs(turnOf(headingTo(s.x - b.x, s.z - b.z) - b.yaw));
      const value = d * (1 + off * .5);
      if (value < score) { score = value; best = s; }
    }
    target = best; waypoint = null;
    if (!best) return;
    // Pass on the island's near side (the least turning), at a safe distance from its coast.
    const dx = best.x - b.x, dz = best.z - b.z, d = Math.hypot(dx, dz) || 1, side = turnOf(headingTo(dx, dz) - b.yaw) > 0 ? 1 : -1;
    const r = Math.min(reach(best), d * .9);
    waypoint = { x: best.x + (-dz / d) * r * side, z: best.z + (dx / d) * r * side };
    budget = d / 2.5 + 90;                                 // a waypoint it cannot reach is given up, not circled forever
  }
  const clearAlong = (b, yaw) => LOOK.every(l => clearance(b.x - Math.sin(yaw) * l, b.z - Math.cos(yaw) * l).distance > CLEAR);
  return {
    get on() { return on; },
    set(value, b) {
      on = !!value; swerve = 0; look = 0;
      if (on && b) { cruise = b.yaw; choose(b); }
    },
    /** Helm for this step: { turn, throttle } in the same ranges as the keys. */
    steer(b, dt) {
      if (!on) return { turn: 0, throttle: 0 };
      if (waypoint && ((budget -= dt) < 0 || Math.hypot(waypoint.x - b.x, waypoint.z - b.z) < 30)) {
        passed.push(target.id); if (passed.length > 24) passed.shift();
        cruise = b.yaw; choose(b);
      }
      // Open water with nothing in reach: hold the course and look again now and then.
      if (!waypoint && (search -= dt) <= 0) { search = 5; choose(b); }
      const desired = waypoint ? headingTo(waypoint.x - b.x, waypoint.z - b.z) : cruise;
      // Looking ahead is costly enough to do a few times a second; the last clear swerve is kept while it stays clear.
      look -= dt;
      if (look <= 0) {
        look = .2;
        if (!clearAlong(b, desired + swerve)) swerve = SWERVE.find(o => clearAlong(b, desired + o)) ?? swerve + .4;
        else if (swerve && clearAlong(b, desired)) swerve = 0;
      }
      const error = turnOf(desired + swerve - b.yaw);
      const turn = Math.abs(error) < .02 ? 0 : Math.max(-1, Math.min(1, error * 1.8));
      const far = waypoint && Math.hypot(waypoint.x - b.x, waypoint.z - b.z) > FAR && !swerve;
      return { turn, throttle: far ? 1 : 0 };
    },
    state() { return { on, target: on ? target?.name ?? null : null }; },
    reset() { on = false; target = null; waypoint = null; swerve = 0; look = 0; passed.length = 0; },
  };
}
