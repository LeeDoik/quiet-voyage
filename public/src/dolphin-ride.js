// How a dolphin pod rides a boat's bow wave. Pure state, no three.js, so tests can run it.
export const RIDE = { join: 110, joinSpeed: 2.4, holdSpeed: 2, reach: 400, maxTime: 90, rest: 60, shortRest: 10 };

/**
 * Advance one pod's ride. `home`: metres from the pod's own path to the boat.
 * The pod rides a while, then lets go before the boat drags it far from its own water. Each dolphin
 * then swims off on its own way at the surface, breathing and leaping as before (dolphinStep).
 */
export function rideStep(r, dt, home, speed) {
  r = r ?? { amount: 0, time: 0, rest: 0, leaving: false };
  r.rest = Math.max(0, r.rest - dt);
  if (!r.leaving && r.amount > .2) {
    const tired = home > RIDE.reach || r.time > RIDE.maxTime;
    if (tired || speed <= RIDE.holdSpeed) { r.leaving = true; r.rest = tired ? RIDE.rest : RIDE.shortRest; }
  }
  const near = home < RIDE.join && speed > RIDE.joinSpeed && r.rest === 0;
  const riding = !r.leaving && (near || r.amount > .2);
  r.amount += ((riding ? 1 : 0) - r.amount) * (1 - Math.exp(-dt * (riding ? .35 : .25)));
  if (riding && r.amount > .2) r.time += dt;
  if (r.leaving && r.amount < .01) { r.leaving = false; r.time = 0; r.amount = 0; }
  return r;
}

const turnOf = a => Math.atan2(Math.sin(a), Math.cos(a));
export const SWIM = { turn: 1.3, top: 10.5, cruise: 4.2, lead: 6, home: 3 };

/**
 * Where dolphin `i` rides by the bow: a few metres ahead of the stem and off to one side, drifting
 * slowly so the pod keeps changing places the way a real one does.
 */
export function bowSlot(i, T, boat) {
  const side = (i % 2 ? 1 : -1) * (1.9 + (i % 3) * 1.1 + Math.sin(T * .31 + i * 1.7) * .8);
  const ahead = 4 + (i % 4) * 1.8 + Math.sin(T * .43 + i * 2.3) * 1.5 + Math.sin(T * .17 + i) * 1.2;
  const fx = -Math.sin(boat.yaw), fz = -Math.cos(boat.yaw), rx = Math.cos(boat.yaw), rz = -Math.sin(boat.yaw);
  return { x: boat.x + fx * ahead + rx * side, z: boat.z + fz * ahead + rz * side };
}

/**
 * One dolphin swimming on its own: it steers toward a point a little ahead of `target` (so it ends up
 * running alongside rather than circling it) with a limited turn rate, and eases its speed. `want`:
 * the speed it would like. Banks into its turns. Mutates and returns `a` ({x, z, yaw, speed, bank}).
 */
export function swimStep(a, dt, target, want) {
  const tx = target.x - Math.sin(target.yaw) * SWIM.lead, tz = target.z - Math.cos(target.yaw) * SWIM.lead;
  const error = turnOf(Math.atan2(-(tx - a.x), -(tz - a.z)) - a.yaw);
  const rate = Math.max(-SWIM.turn, Math.min(SWIM.turn, error * 2.2));
  a.yaw += rate * dt;
  a.bank += (-rate * .32 - a.bank) * (1 - Math.exp(-dt * 4));
  a.speed += (Math.max(0, Math.min(SWIM.top, want)) - a.speed) * (1 - Math.exp(-dt * 1.4));
  a.x -= Math.sin(a.yaw) * a.speed * dt; a.z -= Math.cos(a.yaw) * a.speed * dt;
  return a;
}

/**
 * Advance dolphin `i` of a pod. `free`: where it would be on its own path ({x, z, yaw}); `r`: the ride
 * (rideStep). While the pod rides it swims in to its place by the bow and keeps pace; when the pod lets
 * go it peels away and swims back to its own path, where it rejoins the shared timeline seamlessly.
 * Returns the pose to draw: {x, z, yaw, speed, bank}.
 */
export function dolphinStep(r, i, dt, T, free, boat) {
  const agents = r.agents ??= [];
  let a = agents[i];
  const riding = !r.leaving && r.amount > .05;
  if (!a || (!a.active && !riding)) {
    a = agents[i] = { x: free.x, z: free.z, yaw: free.yaw, speed: SWIM.cruise, bank: 0, active: false };
    return a;
  }
  a.active = true;
  if (riding) {
    const slot = bowSlot(i, T, boat), fx = -Math.sin(boat.yaw), fz = -Math.cos(boat.yaw);
    const behind = (slot.x - a.x) * fx + (slot.z - a.z) * fz;   // > 0: the slot is still ahead of it
    swimStep(a, dt, { x: slot.x, z: slot.z, yaw: boat.yaw }, boat.speed + Math.max(-2.5, Math.min(3.5, behind * .7)));
  } else {
    const d = Math.hypot(free.x - a.x, free.z - a.z);
    swimStep(a, dt, free, SWIM.cruise + Math.min(4, d * .25));
    // Close to its own path it is eased onto it, and once there it hands over to the shared timeline.
    if (d < SWIM.home) {
      const pull = 1 - Math.exp(-dt * 1.5);
      a.x += (free.x - a.x) * pull; a.z += (free.z - a.z) * pull; a.yaw += turnOf(free.yaw - a.yaw) * pull;
      if (Math.hypot(free.x - a.x, free.z - a.z) < .08 && Math.abs(turnOf(a.yaw - free.yaw)) < .05) { a.active = false; Object.assign(a, { x: free.x, z: free.z, yaw: free.yaw, bank: 0 }); }
    }
  }
  return a;
}
