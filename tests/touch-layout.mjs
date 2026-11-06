import assert from 'node:assert/strict';
// The phone buttons at small and large screens: every action reachable in each mode, no two
// buttons' touch areas overlapping, all of them on screen. touch.js needs only a stub page.
globalThis.matchMedia = () => ({ matches: true });
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.document = { body: { style: {} }, documentElement: { style: {} }, querySelector: () => null };
const { createTouch } = await import('../public/src/touch.js');
const phrases = Array.from({ length: 8 }, (_, i) => `phrase ${i}`);
const NEED = {
  play: ['KeyA', 'KeyD', 'KeyW', 'KeyS', 'KeyJ', 'KeyK', 'KeyB', 'KeyM', 'KeyC', 'KeyH', 'KeyE', 'KeyR'],
  photo: ['KeyA', 'KeyD', 'KeyW', 'KeyS', 'Space', 'KeyC'],
  book: ['KeyJ', 'KeyK', 'KeyB', 'KeyM', 'KeyC', 'KeyH'],
  picker: ['KeyB', 'KeyM', 'KeyC', ...phrases.map((_, i) => `Digit${i + 1}`)],
};
for (const [w, h] of [[360, 740], [390, 844], [844, 390], [1024, 768]]) {
  Object.assign(globalThis, { innerWidth: w, innerHeight: h });
  const touch = createTouch({ style: {}, addEventListener() {} });
  for (const [mode, codes] of Object.entries(NEED)) {
    touch.setPhase('playing', true, mode, phrases);
    const list = touch.state().buttons.map(b => ({ ...b, x: b.x * w, y: b.y * h, r: b.r * h * 1.15, w: b.w * w, h: b.h * h }));
    for (const code of codes) assert(list.some(b => b.code === code), `${w}×${h} ${mode}: no button sends ${code}`);
    const box = b => b.w ? [b.x - b.w / 2, b.y - b.h / 2, b.x + b.w / 2, b.y + b.h / 2] : [b.x - b.r, b.y - b.r, b.x + b.r, b.y + b.r];
    for (const b of list) { const [l, t, r, d] = box(b); assert(l >= 0 && t >= 0 && r <= w && d <= h, `${w}×${h} ${mode}: ${b.id} off screen`); }
    list.forEach((a, i) => list.slice(i + 1).forEach(b => {
      const apart = a.w || b.w ? (() => { const [al, at, ar, ad] = box(a), [bl, bt, br, bd] = box(b); return al >= br || bl >= ar || at >= bd || bt >= ad; })() : Math.hypot(a.x - b.x, a.y - b.y) >= a.r + b.r;
      assert(apart, `${w}×${h} ${mode}: ${a.id} and ${b.id} overlap`);
    }));
  }
}
console.log('touch-layout: every action reachable, no overlapping buttons, all on screen at four sizes');
