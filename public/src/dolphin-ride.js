// How a dolphin pod rides a boat's bow wave. Pure state, no three.js, so tests can run it.
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const RIDE = { join: 110, joinSpeed: 2.4, holdSpeed: 2, reach: 400, maxTime: 90, rest: 60, shortRest: 10 };

/**
 * Advance one pod's ride. `home`: metres from the pod's own path to the boat.
 * The pod rides a while, then lets go before the boat drags it far from its own water: it dives,
 * slips back underwater and surfaces on its own path, so it never pops out or slides across the sea.
 */
export function rideStep(r, dt, home, speed) {
  r = r ?? { amount: 0, time: 0, rest: 0, leaving: false, peak: 1, dive: 0 };
  r.rest = Math.max(0, r.rest - dt);
  if (!r.leaving && r.amount > .2) {
    const tired = home > RIDE.reach || r.time > RIDE.maxTime;
    if (tired || speed <= RIDE.holdSpeed) { r.leaving = true; r.peak = r.amount; r.rest = tired ? RIDE.rest : RIDE.shortRest; }
  }
  const near = home < RIDE.join && speed > RIDE.joinSpeed && r.rest === 0;
  const riding = !r.leaving && (near || r.amount > .2);
  r.amount += ((riding ? 1 : 0) - r.amount) * (1 - Math.exp(-dt * (riding ? .35 : .25)));
  if (riding && r.amount > .2) r.time += dt;
  const k = r.leaving ? 1 - r.amount / r.peak : 0;
  r.dive = smooth(0, .25, k) * (1 - smooth(.9, 1, k));
  if (r.leaving && r.amount < .01) { r.leaving = false; r.time = 0; r.amount = 0; r.dive = 0; }
  return r;
}
