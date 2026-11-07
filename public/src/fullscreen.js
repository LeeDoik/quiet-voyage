// Fullscreen: F, the corner button (mouse), or the touch button (touch.js sends KeyF). Browsers enter
// fullscreen only from a user gesture, so this answers the key and pointer events directly instead of
// waiting for update(). Where the page cannot go fullscreen (iPhone Safari), there is no button.
export function createFullscreen(canvas, button) {
  const root = document.documentElement;
  const supported = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  const on = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  function toggle() {
    if (!supported) return;
    try {
      const done = on()
        ? (document.exitFullscreen || document.webkitExitFullscreen).call(document)
        : (root.requestFullscreen || root.webkitRequestFullscreen).call(root, { navigationUI: 'hide' });
      done?.catch?.(() => {});
    } catch { /* refused: stay as we are */ }
  }
  addEventListener('keydown', event => { if (event.code === 'KeyF' && !event.repeat) toggle(); });
  canvas.addEventListener('pointerdown', event => {
    if (event.pointerType === 'touch') return;
    const b = button();                       // the badge interface.js drew last, in fractions of the frame
    if (!b) return;
    const x = event.clientX / innerWidth, y = event.clientY / innerHeight;
    if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) { event.preventDefault(); toggle(); }
  });
  return { supported, state: () => (supported ? { on: on() } : null) };
}
