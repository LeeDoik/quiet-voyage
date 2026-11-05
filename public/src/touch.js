// Touch controls for phones and tablets. Fingers on the on-screen buttons become the same key
// events a keyboard sends, so the game keeps one input path (ctx.keys in update()). The
// buttons are drawn by interface.js from state(); nothing here touches the DOM beyond styles.
import { platform } from './platform.js';

const HOLD_MIN = 90; // ms a tap holds its key, so a quick tap still spans a simulation frame

export function createTouch(canvas) {
  let active = platform.touch, phase = 'menu', practice = false, mode = 'play';
  let buttons = [], phrases = [];
  const fingers = new Map(); // pointerId → button id
  const held = new Map();    // code → { count, since }

  for (const el of [canvas, document.body]) {
    el.style.touchAction = 'none';
    el.style.userSelect = 'none';
    el.style.webkitUserSelect = 'none';
    el.style.webkitTouchCallout = 'none';
    el.style.webkitTapHighlightColor = 'transparent';
  }
  document.documentElement.style.overscrollBehavior = 'none';

  function key(code, down) {
    const letter = code.startsWith('Key') ? code.slice(3).toLowerCase() : code;
    window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: letter }));
  }
  function press(code) {
    const h = held.get(code);
    if (h) { h.count++; return; }
    held.set(code, { count: 1, since: performance.now() });
    key(code, true);
  }
  function release(code) {
    const h = held.get(code);
    if (!h) return;
    if (--h.count > 0) return;
    const wait = Math.max(0, HOLD_MIN - (performance.now() - h.since));
    held.delete(code);
    setTimeout(() => { if (!held.has(code)) key(code, false); }, wait);
  }

  function layout() {
    const w = innerWidth, h = innerHeight, m = Math.min(w, h);
    const R = Math.max(30, m * .085), r = Math.max(22, m * .052), pad = m * .045;
    const at = (id, label, caption, code, x, y, radius) => ({ id, label, caption, code, x, y, radius });
    const list = [
      at('left', '◀', mode === 'photo' ? '돌기' : '왼쪽', 'KeyA', pad + R, h - pad - R, R),
      at('right', '▶', mode === 'photo' ? '돌기' : '오른쪽', 'KeyD', pad + R * 3.35, h - pad - R, R),
      at('fast', '▲', mode === 'photo' ? '가까이' : '빠르게', 'KeyW', w - pad - R, h - pad - R * 3.75, R),
      at('slow', '▼', mode === 'photo' ? '멀리' : '천천히', 'KeyS', w - pad - R, h - pad - R, R),
    ];
    const row = mode === 'photo' ? [['shot', '저장', 'Space'], ['photo', '닫기', 'KeyC']]
      : [['journal', '노트', 'KeyJ'], ['guide', '도감', 'KeyK'], ['pulse', '빛', 'KeyE'], ['trace', '흔적', 'KeyR'], ['bottle', '편지', 'KeyB'], ['photo', '사진', 'KeyC'], ...(practice ? [['practice', '동행', 'KeyH']] : [])];
    row.forEach(([id, label, code], i) => list.push(at(id, label, '', code, w - pad - r - i * r * 2.4, pad + r, r)));
    // Bottle phrases: wide rows (rectangles) down the middle of the screen.
    if (mode === 'picker') phrases.forEach((text, i) => list.push({ id: `phrase-${i}`, label: `${i + 1}  ${text}`, caption: '', code: `Digit${i + 1}`, x: w / 2, y: h * .2 + i * Math.max(40, h * .075), radius: 0, w: Math.min(w * .86, 520), h: Math.max(34, h * .062) }));
    buttons = list;
  }
  const hit = (x, y) => buttons.find(b => b.w ? Math.abs(x - b.x) < b.w / 2 && Math.abs(y - b.y) < b.h / 2 : Math.hypot(x - b.x, y - b.y) < b.radius * 1.15);

  function down(event) {
    if (event.pointerType !== 'touch') return;
    active = true; layout();
    event.preventDefault();
    if (phase !== 'playing') { press('Enter'); fingers.set(event.pointerId, 'Enter'); return; }
    const b = hit(event.clientX, event.clientY);
    if (!b) return;
    fingers.set(event.pointerId, b.code); press(b.code);
  }
  function move(event) {
    if (event.pointerType !== 'touch' || !fingers.has(event.pointerId) || phase !== 'playing') return;
    const b = hit(event.clientX, event.clientY), was = fingers.get(event.pointerId);
    // Sliding a thumb between the two rudder buttons changes direction without lifting.
    if (b && b.code !== was && ['KeyA', 'KeyD', 'KeyW', 'KeyS'].includes(b.code)) { release(was); press(b.code); fingers.set(event.pointerId, b.code); }
  }
  function up(event) {
    const code = fingers.get(event.pointerId);
    if (!code) return;
    fingers.delete(event.pointerId); release(code);
  }
  canvas.addEventListener('pointerdown', down, { passive: false });
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
  window.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
  window.addEventListener('gesturestart', e => e.preventDefault());
  addEventListener('resize', layout);
  layout();

  return {
    setPhase(next, canPractice, nextMode = 'play', nextPhrases = []) { if (next !== phase || canPractice !== practice || nextMode !== mode) { phase = next; practice = canPractice; mode = nextMode; phrases = nextPhrases; layout(); } },
    state() {
      const w = innerWidth, h = innerHeight, pressed = new Set(fingers.values());
      return {
        active,
        buttons: active ? buttons.map(b => ({ id: b.id, label: b.label, caption: b.caption, x: b.x / w, y: b.y / h, r: b.radius / h, w: b.w ? b.w / w : 0, h: b.h ? b.h / h : 0, pressed: pressed.has(b.code) })) : [],
      };
    },
  };
}
