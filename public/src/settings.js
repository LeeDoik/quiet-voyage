// Settings: a paper panel under the top-right badges with one volume slider per kind of sound.
// Open with O or the slider badge. Keys: ↑ ↓ choose a row, ← → change it by 10%, Esc or O closes.
// The mouse or a finger drags a bar. Like fullscreen.js, pointers are read here against the boxes
// interface.js drew last (in fractions of the frame), so the HUD stays the one place that draws.
import { sfx, SOUND_GROUPS } from './audio.js';

export function createSettings(canvas, boxes) {
  let open = false, row = 0, previous = new Set(), dragging = null;
  const keys = SOUND_GROUPS.map(([key]) => key);
  const inside = (b, x, y) => b && x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
  const at = event => [event.clientX / innerWidth, event.clientY / innerHeight];
  function slide(bar, x) { sfx.setVolume(bar.key, (x - bar.x0) / (bar.x1 - bar.x0)); row = keys.indexOf(bar.key); }
  canvas.addEventListener('pointerdown', event => {
    const b = boxes(); if (!b) return;
    const [x, y] = at(event);
    if (inside(b.badge, x, y)) { open = !open; event.preventDefault(); return; }
    if (!open) return;
    const bar = b.rows?.find(r => inside(r, x, y));
    if (bar) { dragging = { id: event.pointerId, bar }; slide(bar, x); event.preventDefault(); }
    else if (!inside(b.panel, x, y) && !inside(b.close, x, y)) open = false;
  });
  addEventListener('pointermove', event => { if (dragging?.id === event.pointerId) slide(dragging.bar, at(event)[0]); });
  addEventListener('pointerup', event => { if (dragging?.id === event.pointerId) dragging = null; });
  addEventListener('pointercancel', () => { dragging = null; });
  return {
    get open() { return open; },
    /** Keys while open belong to the panel; returns true when the game should not see them. */
    update(input, playing) {
      const pressed = code => input.keys.has(code) && !previous.has(code);
      if (pressed('KeyO')) open = !open;
      if (!playing) open = false;
      if (open) {
        if (pressed('Escape')) open = false;
        if (pressed('ArrowUp') || pressed('KeyW')) row = (row + keys.length - 1) % keys.length;
        if (pressed('ArrowDown') || pressed('KeyS')) row = (row + 1) % keys.length;
        const step = (pressed('ArrowRight') || pressed('KeyD') ? 1 : 0) - (pressed('ArrowLeft') || pressed('KeyA') ? 1 : 0);
        if (step) sfx.setVolume(keys[row], sfx.volumes()[keys[row]] + step * .1);
      }
      previous = new Set(input.keys);
      return open;
    },
    state: () => ({ open, row, volumes: sfx.volumes(), groups: SOUND_GROUPS.map(([key, label]) => ({ key, label })) }),
    reset() { open = false; dragging = null; },
  };
}
