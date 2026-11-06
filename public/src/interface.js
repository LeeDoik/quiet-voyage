import { platform } from './platform.js';
import { sfx } from './audio.js';
import { lang, t } from './i18n.js';

const CARDINAL = { 0: t('북'), 45: t('북동'), 90: t('동'), 135: t('남동'), 180: t('남'), 225: t('남서'), 270: t('서'), 315: t('북서') };
const WEATHER = { rain: t('비'), gust: t('돌풍'), haze: t('해무'), breeze: t('산들바람'), rainbow: t('무지개') };
const pad2 = n => String(Math.floor(n)).padStart(2, '0');
function duration(seconds) {
  const s = Math.max(0, Math.floor(seconds)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
  return h ? t('{h}시간 {m}분', { h, m: pad2(m) }) : t('{m}분 {s}초', { m, s: pad2(s % 60) });
}
const km = metres => metres >= 1000 ? `${(metres / 1000).toFixed(metres >= 100000 ? 0 : 1)} km` : `${Math.round(metres)} m`;
const knots = speed => (speed * 1.944).toFixed(1);

export function createInterface() {
  let elapsed = 0;
  let journalOpen = false;
  let guideOpen = false;
  let previousKeys = new Set();
  let moved = false;
  let turned = false;
  let greeted = false;
  let wasPlaying = false;
  let pressedAt = new Map(); // key code → play time of its first press, to fade its hint

  const has = (keys, ...names) => names.some(name => keys.has(name));
  const pressed = (keys, ...names) => names.some(name => keys.has(name) && !previousKeys.has(name));

  return {
    reset() {
      elapsed = 0; journalOpen = false; guideOpen = false; previousKeys = new Set();
      moved = false; turned = false; greeted = false; wasPlaying = false; pressedAt = new Map();
    },
    update(dt, input, state) {
      const keys = input.keys;
      if (state.phase === 'playing') {
        elapsed += dt;
        if (wasPlaying) {
          if (pressed(keys, 'KeyJ', 'j')) { journalOpen = !journalOpen; guideOpen = false; if (journalOpen) sfx.page(); }
          if (pressed(keys, 'KeyK', 'k')) { guideOpen = !guideOpen; journalOpen = false; if (guideOpen) sfx.page(); }
          if (pressed(keys, 'Escape') || state.photo) { journalOpen = false; guideOpen = false; }
          if (has(keys, 'KeyW', 'w', 'ArrowUp')) moved = true;
          if (has(keys, 'KeyA', 'a', 'KeyD', 'd', 'ArrowLeft', 'ArrowRight')) turned = true;
          if (has(keys, 'KeyE', 'e')) greeted = true;
          for (const key of keys) if (!pressedAt.has(key)) pressedAt.set(key, elapsed);
        }
        wasPlaying = true;
      } else {
        wasPlaying = false;
      }
      previousKeys = new Set(keys);
    },
    /** Is the journal or the field guide open (touch hides the sailing buttons while it is)? */
    reading: () => journalOpen || guideOpen,
    hud(state) {
      const h = window.__studio.hud;
      h.clear();
      const view = state.view ?? { aspect: 16 / 9, k: 1 };
      const p = pen(h, view, state.world?.night ?? 0);
      const { A, K, px, em, lh } = p;
      const touch = state.touch?.active, buttons = state.touch?.buttons ?? [];
      // Developer panels keep the studio look: white text with a shadow on dark glass.
      const text = (id, value, x, y, size, color = '#f7f8ef', align = 'left') =>
        h.text(id, String(value), { x, y, size: size * K, color, align, shadow: true });
      // The touch row along the top edge, where paper must not cover it.
      const row = buttons.filter(b => !b.w && b.y < .3);
      const rowBottom = row.length ? Math.max(...row.map(b => b.y + b.r)) + 8 * px : 0;

      if (state.phase === 'menu') {
        drawTitle(p, touch);
        return;
      }
      const boat = state.boat, log = state.log;
      if (state.photo) {
        const a = Math.max(0, Math.min(1, 4 - state.photo.time));
        if (a > 0) note(p, 'photo-hint', t(touch ? '사진 모드 · ◀▶ 돌기 · ▲▼ 거리 · 저장 · 닫기' : '사진 모드 · ← → 돌기 · ↑ ↓ 거리 · Space 저장 · C 나가기'), touch ? .62 : .9, 13, a);
        if (state.photo.saved > 0) note(p, 'photo-saved', t('사진을 저장했어요'), .48, 16, Math.min(1, state.photo.saved));
        drawTouch(p, state);
        return;
      }
      const book = { x0: .03, x1: .97, y0: Math.max(.05, rowBottom), y1: .95 };
      const half = Math.min(.46, (book.y1 - book.y0) * (K > 1.2 ? 2.3 : 1.5) / A / 2); // a notebook's proportions; wider on phones
      if (A >= 1) Object.assign(book, { x0: .5 - half, x1: .5 + half });
      if (guideOpen && log?.guide) {
        drawGuide(p, log.guide, book, touch);
        drawTouch(p, state);
        return;
      }
      if (journalOpen) {
        drawJournal(p, log, book, touch);
        drawTouch(p, state);
        return;
      }

      // Developer panels: the owner only (studio, localhost, or the site with ?dev=<key>).
      if (platform.dev && state.performance?.panel) {
        const perf = state.performance, bots = state.bots;
        const results = perf.completedCases === 24 ? perf.summary : [];
        h.panel('perf-panel', { x: .02, y: .02, w: .64, h: results.length ? .49 : .26, fill: 'rgba(10,30,34,.88)' });
        text('perf-title', t('성능 시험 · 로컬 봇 (서버 부하 제외)'), .035, .045, 15);
        text('perf-controls', t('1: 0척   2: 16척   3: 64척   4: 128척   L: 최적화 전환'), .035, .09, 12);
        text('perf-run', t('B: 시험 항로에서 비교 측정   O: 결과 저장   P: 닫기'), .035, .13, 12);
        text('perf-count', t('{mode} · 봇 {count} · 시야 후보 {candidates} · 저상세 {low}', { mode: t(perf.optimized ? '컬링 + LOD' : '기준 모드'), count: bots.count, candidates: bots.high + bots.low, low: bots.low }), .035, .17, 12);
        text('perf-draw', t('그리기 {calls}회 · 삼각형 {triangles}개', { calls: perf.draw.calls, triangles: perf.draw.triangles.toLocaleString() }), .035, .21, 12);
        if (perf.error || perf.progress) text('perf-progress', perf.error || perf.progress, .035, .255, 12, '#ead8a7');
        if (results.length) {
          text('perf-result-title', t('동기식 처리 중앙값(ms) · 기준 → 최적화 · FPS 아님'), .035, .305, 12, '#ead8a7');
          results.forEach((row, i) => text(`perf-result-${i}`, t('{bots}척: {a} → {b} ms   /   그리기 {c} → {d}회', { bots: row.bots, a: row.baseline.medianMs, b: row.optimized.medianMs, c: row.baseline.calls, d: row.optimized.calls }), .035, .35 + i * .04, 12));
        }
      }
      const g = state.graphics;
      if (platform.dev && g?.shown) {
        h.panel('graphics-panel', { x: .70, y: .12, w: .46, h: .5, fill: 'rgba(10,30,34,.88)' });
        text('graphics-title', t('그래픽 현황  ·  G 닫기'), .715, .145, 14);
        text('graphics-fps', g.status === 'live' ? t('렌더 FPS {fps} · 해상도 배율 {dpr}', { fps: g.fps, dpr: g.dpr?.toFixed?.(2) ?? g.dpr }) : t('프레임 측정 대기 / 일시정지'), .715, .19, 12);
        text('graphics-time', t('간격 {mean} ms / P95 {p95}', { mean: g.meanMs ?? '—', p95: g.p95Ms ?? '—' }), .715, .23, 12);
        text('graphics-draw', t('그리기 {calls} · 삼각형 {triangles}', { calls: g.calls, triangles: g.triangles.toLocaleString() }), .715, .27, 12);
        text('graphics-assets', t('지오메트리 {g} · 텍스처 {t} · 셰이더 {p}', { g: g.geometries, t: g.textures, p: g.programs }), .715, .31, 12);
        const w = state.world;
        text('graphics-world', t('섬 {loaded} (대기 {queued}) · 생물 그룹 {groups} / 보임 {visible}', { loaded: w?.islands?.loaded ?? 0, queued: w?.islands?.queued ?? 0, groups: w?.life?.groups ?? 0, visible: w?.life?.visible ?? 0 }), .715, .35, 11);
        text('graphics-culling', t('시야 제외: 나무 {trees} · 바다 {water}', { trees: state.visibility.culledTrees, water: state.water.culled }), .715, .39, 11);
        text('graphics-pos', t('위치 {x}, {z} · 시계 {clock}s', { x: Math.round(boat?.x ?? 0), z: Math.round(boat?.z ?? 0), clock: Math.round(w?.clock ?? 0) }), .715, .43, 11);
        text('graphics-net', t('네트워크: {net} · 근처 배 {peers}', { net: state.social?.availability ?? '—', peers: state.social?.peers ?? 0 }), .715, .47, 11);
      }

      // The compass sits at the top, or under the touch row when the row would cross it.
      const span = Math.min(.92, .42 * Math.max(1, 1.6 / A));
      const crossed = row.some(b => Math.abs(b.x - .5) < span / 2 + b.r / A);
      let below = .022;
      if (boat?.helm && !(touch && state.bottles?.picker)) below = drawCompass(p, boat, crossed ? rowBottom : .022, span, WEATHER[state.world?.rainbow ? 'rainbow' : state.world?.weather] ?? '');

      const social = state.social;
      if (social && !touch) {
        const mode = social.practice ? t('동행 연습 · 로컬 배 1척') : social.connected ? t('같은 바다 · 근처 배 {n}척', { n: social.peers }) : t('혼자 흐르는 바다');
        tag(p, 'quiet-mode', social.name && social.connected ? `${mode}  ·  ${social.name}` : mode, .02, .815, 11);
        // Key hints fade once their key is used, and all of them after the first few minutes.
        const seen = code => Math.max(0, Math.min(1, (HINT_TIME - elapsed) / 4, pressedAt.has(code) ? 1 - (elapsed - pressedAt.get(code)) / 2 : 1));
        const keys = [...t('E  빛물결    R  빛의 흔적').split(/\s{3,}/), ...(social.canPractice ? [`H  ${t(social.practice ? '동행 연습 마치기' : '동행 연습')}`] : [])];
        keyTags(p, 'quiet-key', keys, .87, seen);
        keyTags(p, 'journal-key', `${t('J 노트   K 도감   B 편지   C 사진')}${platform.dev ? t('   P 성능   G 그래픽') : ''}`.trim().split(/\s{3,}/), .925, seen);
      } else if (social?.connected) {
        const peers = t('근처 배 {n}척', { n: social.peers });
        tag(p, 'quiet-mode', peers, .5 - p.widthOf(peers, 11) / 2 - 8 * px / A, below + 4 * px, 11);
        below += em(11) + 14 * px;
      }
      if (social?.resonance > .1) {
        const label = t(social.companions ? '같은 바람을 타고 있어요' : '나란히 흐르는 중');
        const w = Math.max(.22, p.widthOf(label, 11) + 16 * px / A), x = touch ? .5 - w / 2 : .02, y = touch ? below + 4 * px : .74;
        p.sheet('quiet-together', x, y, w, lh(11) + 14 * px, { radius: 2 * px });
        p.write('quiet-together-label', label, x + 8 * px / A, y + 5 * px, 11, p.teal);
        p.box('quiet-resonance-back', x + 8 * px / A, y + lh(11) + 5 * px, w - 16 * px / A, 2 * px, 'rgba(43,107,102,.18)');
        p.box('quiet-resonance', x + 8 * px / A, y + lh(11) + 5 * px, (w - 16 * px / A) * Math.min(1, social.resonance), 2 * px, p.teal);
        if (touch) below = y + lh(11) + 14 * px;
      }
      // One prompt at a time, dismissed by the action it teaches or by time. On touch, prompts and
      // notices stack under the compass, clear of the boat and the thumbs.
      let hint = '', until = 42;
      if (elapsed < 15 && !moved) { hint = touch ? '▲  바람을 타고 나아가기' : 'W / ↑  바람을 타고 나아가기'; until = 15; }
      else if (elapsed < 28 && !turned) { hint = touch ? '◀ ▶  천천히 방향 바꾸기' : 'A D / ← →  천천히 방향 바꾸기'; until = 28; }
      else if (elapsed > 32 && elapsed < 42 && !greeted && social?.connected) hint = touch ? '빛  버튼으로 인사하기' : 'E  빛으로 인사하기';
      const picking = touch && state.bottles?.picker; // the touch picker's letter takes the screen
      if (hint && !picking) {
        const bottom = note(p, 'hint', t(hint), touch ? below + 6 * px : .875, 14, Math.max(0, Math.min(1, elapsed / 1.5, (until - elapsed) / 2)));
        if (touch) below = bottom;
      }
      const message = log?.notice || social?.notice;
      if (message && !picking) {
        const top = touch ? Math.max(view.portrait ? .3 : .24, below + 6 * px) : .76;
        if (message.includes('\n')) drawLetter(p, message, top, touch ? top + .2 : .86);
        else note(p, 'notice', message, top, 15);
      }
      if (state.sound && !touch) drawSound(p, state.sound.muted);
      if (state.bottles?.picker && !touch) drawPicker(p, state.bottles.phrases);
      drawTouch(p, state);
    },
  };
}

const HINT_TIME = 180; // seconds of play before every key hint has faded

// ── paper and ink ──

const PAPER = [241, 232, 212], LAMP = [56, 34, 12];
const INK = [45, 36, 27], SOFT = [104, 88, 66], STAMP = [163, 64, 46], TEAL = [43, 107, 102], CLOTH = [44, 58, 56];
const rgba = (c, a = 1) => `rgba(${c.map(Math.round).join(',')},${a})`;
const mix = (a, b, f) => a.map((v, i) => v + (b[i] - v) * f);
const SERIF = lang === 'ko' ? '"QV Serif KO", AppleMyungjo, Batang, "Noto Serif KR", serif' : '"QV Serif", "QV Symbols", Georgia, "Times New Roman", serif';
const HAND = `${lang === 'ko' ? '"QV Hand KO"' : '"QV Hand"'}, ${SERIF}`;
// The pen faces draw small beside the serif. They hold only the text in tools/glyphs.mjs HAND.
const HAND_SIZE = lang === 'ko' ? 1.32 : 1.2;
const FONTS = lang === 'ko' ? { 'QV Serif KO': 'qv-serif-ko', 'QV Hand KO': 'qv-hand-ko' } : { 'QV Serif': 'qv-serif', 'QV Symbols': 'qv-symbols', 'QV Hand': 'qv-hand' };
let paper = null, paperScale = 0, meter = null;

/** Cream paper, made once from a seeded generator: mottling, grain and fibres on a seamless tile. */
function makePaper() {
  const S = 384, canvas = document.createElement('canvas'), g = canvas.getContext('2d');
  canvas.width = canvas.height = S;
  let seed = 20261106;
  const rand = () => { seed = (seed + 0x6d2b79f5) >>> 0; let x = seed; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  const octave = N => { const cells = Array.from({ length: N * N }, rand), at = (i, j) => cells[(j % N) * N + (i % N)];
    return (x, y) => { const fx = x / S * N, fy = y / S * N, i = Math.floor(fx), j = Math.floor(fy), u = (fx - i) ** 2 * (3 - 2 * (fx - i)), v = (fy - j) ** 2 * (3 - 2 * (fy - j));
      return (at(i, j) * (1 - u) + at(i + 1, j) * u) * (1 - v) + (at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u) * v - .5; }; };
  const coarse = octave(6), fine = octave(17);
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = coarse(x, y) * 10 + fine(x, y) * 6 + (rand() - .5) * 14, k = (y * S + x) * 4;
    img.data.set([PAPER[0] + n, PAPER[1] + n, PAPER[2] + n * 1.15, 255], k);
  }
  g.putImageData(img, 0, 0);
  // Fibres: short faint curves, drawn on the neighbouring tiles too so they wrap across edges.
  for (let f = 0; f < 300; f++) {
    const x = rand() * S, y = rand() * S, a = rand() * Math.PI, len = 6 + rand() * 18, bend = (rand() - .5) * 8, c = Math.cos(a), s = Math.sin(a);
    g.strokeStyle = rand() < .6 ? `rgba(120,92,58,${.05 + rand() * .07})` : `rgba(255,253,244,${.3 + rand() * .3})`;
    g.lineWidth = .5 + rand() * .6;
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      g.beginPath();
      g.moveTo(x + ox, y + oy);
      g.quadraticCurveTo(x + ox + c * len / 2 - s * bend, y + oy + s * len / 2 + c * bend, x + ox + c * len, y + oy + s * len);
      g.stroke();
    }
  }
  for (let i = 0; i < 16; i++) { g.fillStyle = `rgba(90,68,40,${.12 + rand() * .2})`; g.fillRect(rand() * S, rand() * S, 1, 1); }
  return g.createPattern(canvas, 'repeat');
}

/** A repeatable 0..1 jitter for torn edges and tallies, so they hold still from frame to frame. */
const jag = i => { const x = Math.sin(i * 12.9898 + 4.1414) * 43758.5453; return x - Math.floor(x); };

/** The frame's drawing kit: sizes, paper sheets, ink text, measuring, torn edges and icons. */
function pen(h, view, night) {
  const A = view.aspect, K = view.k, U = view.unit ?? 1 / 720;
  if (!paper) {
    paper = makePaper();
    meter = document.createElement('canvas').getContext('2d');
    for (const [family, file] of Object.entries(FONTS)) h.font(family, new URL(`../assets/fonts/${file}.woff2`, import.meta.url).href);
  }
  // One texel per design pixel at any pixel ratio: the HUD paints at the drawing buffer's size.
  const scale = U * (document.querySelector('canvas')?.height || 720);
  if (scale !== paperScale) { paperScale = scale; paper.setTransform?.(new DOMMatrix([scale, 0, 0, scale, 0, 0])); }
  const lamp = Math.min(1, night) * .32;     // paper under lamplight: dimmer at night, ink stays dark
  const px = U * K, em = size => size * px, lh = size => em(size) * 1.5;
  const flat = rgba(mix(PAPER, LAMP, lamp));
  const box = (id, x, y, w, hh, fill, radius = 0) => h.panel(id, { x, y, w: w * A, h: hh, radius, fill });
  /** A sheet of paper with a soft shadow: x and w are fractions of the frame width, y and hh of its height. */
  function sheet(id, x, y, w, hh, { radius = 3 * px, alpha = 1, lift = true, press = 0 } = {}) {
    if (lift) { // larger than the sheet so it holds it, torn edges included
      box(`${id}-shade`, x - 6 * px / A, y - px, w + 12 * px / A, hh + 10 * px, `rgba(30,18,6,${.1 * alpha})`, radius + 6 * px);
      box(`${id}-shadow`, x - 3.5 * px / A, y - .5 * px, w + 7 * px / A, hh + 5 * px, `rgba(30,18,6,${.15 * alpha})`, radius + 3 * px);
    }
    box(id, x, y, w, hh, alpha < 1 ? rgba(PAPER, alpha) : paper, radius);
    if (lamp + press > .01) box(`${id}-lamp`, x, y, w, hh, rgba(LAMP, (lamp + press) * alpha), radius);
  }
  const write = (id, value, x, y, size, color = INK, align = 'left', font = SERIF) =>
    h.text(id, String(value), { x, y, size: size * K, color: typeof color === 'string' ? color : rgba(color), align, font, weight: 400, shadow: false });
  const hand = (id, value, x, y, size, color = INK, align = 'left') => write(id, value, x, y, size * HAND_SIZE, color, align, HAND);
  /** The width of a line of text as a fraction of the frame width. */
  function widthOf(value, size, font = SERIF) {
    meter.font = `400 100px ${font}`;
    return Math.max(...String(value).split('\n').map(line => meter.measureText(line).width)) / 100 * em(size) / A;
  }
  const handWidth = (value, size) => widthOf(value, size * HAND_SIZE, HAND);
  /** Where the ink of a line sits under its top, as fractions of the frame height: [top, bottom]. */
  function inkOf(value, size, font = SERIF) {
    meter.font = `400 100px ${font}`;
    meter.textBaseline = 'top';
    const m = meter.measureText(value);
    return [-m.actualBoundingBoxAscent / 100 * em(size), m.actualBoundingBoxDescent / 100 * em(size)];
  }
  /** `value` cut to `width` with an ellipsis, if it is longer (by code point: names may hold emoji). */
  function fit(value, size, width, font = SERIF) {
    const s = String(value), chars = [...s];
    if (widthOf(s, size, font) <= width) return s;
    let lo = 1, hi = chars.length - 1; // the longest start that still fits with the ellipsis
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (widthOf(`${chars.slice(0, mid).join('')}…`, size, font) <= width) lo = mid; else hi = mid - 1; }
    return `${chars.slice(0, lo).join('').trimEnd()}…`;
  }
  /** `value` broken into lines no wider than `width`; past `most` lines the rest is cut. */
  function wrap(value, size, width, font = SERIF, most = 9) {
    const lines = [];
    for (const word of String(value).split(' ')) {
      const next = lines.length ? `${lines[lines.length - 1]} ${word}` : word;
      if (lines.length && widthOf(next, size, font) <= width) lines[lines.length - 1] = next;
      else lines.push(word);
    }
    if (lines.length > most) lines.splice(most - 1, lines.length, lines.slice(most - 1).join(' '));
    return lines.map(line => fit(line, size, width, font));
  }
  /** Like wrap, but as narrow as keeps the same number of lines, so no word hangs alone. */
  function balance(value, size, width, font = SERIF, most = 9) {
    const lines = wrap(value, size, width, font, most);
    if (lines.length < 2) return lines;
    let lo = width / lines.length, hi = width;
    for (let i = 0; i < 7; i++) { const mid = (lo + hi) / 2; if (wrap(value, size, mid, font).length > lines.length) lo = mid; else hi = mid; }
    return wrap(value, size, hi, font, most);
  }
  /** Paper teeth along one edge of a sheet (left, right or bottom), in the flat paper colour. */
  function torn(id, x, y, w, hh, side, alpha = 1) {
    const depth = 3 * px, lap = .5 * px, along = side === 'bottom' ? w * A : hh, n = Math.max(3, Math.round(along / (5 * px)));
    const B = 100, L = B * along / (depth + lap), inner = B * lap / (depth + lap), points = [[0, 0]];
    for (let i = 0; i <= n; i++) {
      points.push([inner + (.35 + .65 * jag(i + id.length * 7)) * (B - inner), i / n * L]);
      if (i < n) points.push([inner + .15 * jag(i + .5) * (B - inner), (i + .5) / n * L]);
    }
    points.push([0, L]);
    const at = ([a, b]) => side === 'right' ? [a, b] : side === 'left' ? [B - a, b] : [b, a];
    const d = `M${points.map(q => at(q).map(v => v.toFixed(1)).join(' ')).join(' L')} Z`;
    const opts = { fill: alpha < 1 ? rgba(mix(PAPER, LAMP, lamp), alpha) : flat };
    if (side === 'bottom') h.path(id, d, { ...opts, x, y: y + hh - lap, w: w * A, h: depth + lap, viewBox: `0 0 ${L} ${B}` });
    else h.path(id, d, { ...opts, x: side === 'left' ? x - depth / A : x + w - lap / A, y, w: depth + lap, h: hh, viewBox: `0 0 ${B} ${L}` });
  }
  /** An ink icon (a path in a 100 × 100 box) centred on cx, cy with height `size`. */
  const icon = (id, d, cx, cy, size, opts) => h.path(id, d, { x: cx - size / 2 / A, y: cy - size / 2, w: size, h: size, ...opts });
  const soft = rgba(mix(SOFT, INK, night * .6));
  return { h, A, K, px, em, lh, lamp, night, box, sheet, write, hand, widthOf, handWidth, inkOf, fit, wrap, balance, torn, icon, soft, teal: rgba(mix(TEAL, INK, night * .4)), stamp: rgba(mix(STAMP, INK, night * .35)) };
}

/** A torn paper slip centred on the frame, holding one line (or a few, wrapped) of ink text. */
function note(p, id, value, top, size, alpha = 1) {
  const { A, px, em } = p, pad = 12 * px / A, room = .94 - 2 * pad;
  const lines = p.balance(value, size, room, undefined, 3), w = p.widthOf(lines.join('\n'), size) + 2 * pad;
  const hh = em(size) * (1.25 * (lines.length - 1) + 1) + 14 * px, x = .5 - w / 2;
  p.sheet(id, x, top, w, hh, { radius: px, alpha });
  p.torn(`${id}-left`, x, top, w, hh, 'left', alpha);
  p.torn(`${id}-right`, x, top, w, hh, 'right', alpha);
  p.write(`${id}-text`, lines.join('\n'), .5, top + 7 * px, size, rgba(INK, alpha), 'center');
  return top + hh;
}

/** A small paper tag with one line of soft ink, its left edge at x. */
function tag(p, id, value, x, y, size, alpha = 1) {
  const { A, px, em } = p, w = p.widthOf(value, size) + 16 * px / A;
  p.sheet(id, x, y, w, em(size) + 10 * px, { radius: 2 * px, alpha });
  p.write(`${id}-text`, value, x + 8 * px / A, y + 5 * px, size, alpha < 1 ? rgba(mix(SOFT, INK, p.night * .6), alpha) : p.soft);
  return w;
}

/** A row of key tags ("E  빛물결"), each fading on its own key; slots stay put as others fade. */
function keyTags(p, id, parts, y, seen) {
  let x = .02;
  parts.forEach((part, i) => {
    const code = `Key${part[0]}`, a = seen(code), w = p.widthOf(part, 11) + 16 * p.px / p.A;
    if (a > 0) tag(p, `${id}-${i}`, part, x, y, 11, a);
    x += w + 5 * p.px / p.A;
  });
}

// ── the title card ──

const STAMP_RING = 'M50 4 C75 4 96 25 96 50 C96 75 75 96 50 96 C25 96 4 75 4 50 C4 25 25 4 50 4 Z M50 12 C29 12 12 29 12 50 C12 71 29 88 50 88 C71 88 88 71 88 50 C88 29 71 12 50 12 Z';
const STAMP_BOAT = 'M24 62 L76 62 L68 72 L32 72 Z M51 22 L51 58 L28 58 Z M54 26 C64 36 70 46 72 58 L54 58 Z';
const WAVE = (n, w) => `M0 6 ${Array.from({ length: n }, (_, i) => `Q${(i + .25) * w} 0 ${(i + .5) * w} 6 T${(i + 1) * w} 6`).join(' ')}`;

function drawTitle(p, touch) {
  const { A, px, em, lh } = p, title = t('함께 흐르는 바다'), subtitle = t('바람이 이끄는 곳으로, 천천히'), eyebrow = 'A  Q U I E T  V O Y A G E';
  const pad = 28 * px / A, widest = Math.max(p.handWidth(title, 38), p.handWidth(subtitle, 16));
  const k = Math.min(1, (.92 - 2 * pad) / widest), w = Math.max(widest * k, p.widthOf(eyebrow, 11)) + 2 * pad, x = .5 - w / 2, top = .13;
  const rule = Math.min(w - 2 * pad, .3 / A), ruleH = rule * A / 10;
  const rows = [22 * px, lh(11), em(38 * k * HAND_SIZE) * 1.25 + 4 * px, ruleH + 8 * px, em(16 * k * HAND_SIZE) * 1.25 + 18 * px];
  const ys = rows.map((_, i) => top + rows.slice(0, i + 1).reduce((a, b) => a + b, 0));
  p.sheet('title-card', x, top, w, ys[4] - top, { radius: px });
  p.torn('title-card-edge', x, top, w, ys[4] - top, 'bottom');
  p.write('eyebrow', eyebrow, .5, ys[0], 11, p.stamp, 'center');
  p.hand('title', title, .5, ys[1], 38 * k, INK, 'center');
  p.h.path('title-rule', WAVE(6, 20), { x: .5 - rule / 2, y: ys[2], w: rule * A, h: ruleH, viewBox: '0 0 120 12', fill: null, stroke: p.teal, width: 1.4 * px });
  p.hand('subtitle', subtitle, .5, ys[3], 16 * k, p.soft, 'center');
  const sx0 = Math.min(x + w - 8 * px / A, .99 - 23 * px / A);
  p.icon('title-stamp', STAMP_RING, sx0, top + 6 * px, 46 * px, { fill: rgba(STAMP, .75) });
  p.icon('title-stamp-boat', STAMP_BOAT, sx0, top + 6 * px, 46 * px, { fill: rgba(STAMP, .75) });
  const start = t(touch ? '화면을 눌러 출항하기' : '아무 키나 눌러 출항하기'), detail = t('끝없는 바다, 섬과 고래와 다른 배들');
  const sw = Math.max(p.widthOf(start, 16), p.widthOf(detail, 11)) + 30 * px / A, sh = lh(16) + lh(11) + 10 * px, sx = .5 - sw / 2, sy = .8;
  p.sheet('start', sx, sy, sw, sh, { radius: px });
  p.torn('start-left', sx, sy, sw, sh, 'left');
  p.torn('start-right', sx, sy, sw, sh, 'right');
  p.write('start-text', start, .5, sy + 7 * px, 16, INK, 'center');
  p.write('start-detail', detail, .5, sy + 7 * px + lh(16), 11, p.soft, 'center');
}

// ── the compass ──

// A paper strip across the top: cardinal points slide past a red lubber mark, a teal diamond is
// where the wind blows from, and a tag underneath reads heading, speed, wind and weather.
// Returns the bottom of what it drew.
function drawCompass(p, boat, top, w, sky) {
  const { A, px, em, lh } = p, heading = boat.helm.heading, span = 70, left = .5 - w / 2, height = Math.max(.05, em(30));
  p.sheet('compass-back', left, top, w, height, { radius: 2 * px });
  const at = deg => { const d = ((deg - heading + 540) % 360) - 180; return Math.abs(d) <= span ? d / span * .46 : null; };
  let ticks = '';
  const VW = 1000, VH = VW * height / (w * A);
  for (let deg = 0; deg < 360; deg += 5) {
    const f = at(deg);
    if (f === null) continue;
    const label = CARDINAL[deg], x = .5 + f * w;
    if (label) p.write(`compass-${deg}`, label, x, top + height * (label.length === 1 ? .16 : .26), label.length === 1 ? 13 : 9.5, deg === 0 ? p.stamp : label.length === 1 ? INK : p.soft, 'center');
    else ticks += `M${((f + .5) * VW).toFixed(1)} ${VH * (deg % 15 ? .8 : .68)} V${VH * .94} `;
  }
  if (ticks) p.h.path('compass-ticks', ticks, { x: left, y: top, w: w * A, h: height, viewBox: `0 0 ${VW} ${VH.toFixed(1)}`, fill: null, stroke: rgba(INK, .55), width: 1.1 * px });
  const from = (((-boat.wind.direction * 180 / Math.PI) % 360) + 360 + 180) % 360, wind = at(from);
  if (wind !== null) p.icon('compass-wind', 'M50 4 L92 50 L50 96 L8 50 Z', .5 + wind * w, top, 9 * px, { fill: p.teal });
  p.icon('compass-mark', 'M10 8 H90 L50 92 Z', .5, top - 1 * px, 9 * px, { fill: p.stamp });
  p.box('compass-lubber', .5 - .6 * px / A, top + height * .62, 1.2 * px / A, height * .34, p.stamp);
  const readout = `${String(Math.round(heading) % 360).padStart(3, '0')}°  ·  ${t('{v}노트', { v: knots(boat.speed) })}${wind === null ? `  ·  ${t('바람 {dir}에서', { dir: CARDINAL[Math.round(from / 45) * 45 % 360] })}` : ''}${sky ? `  ·  ${sky}` : ''}`;
  const tw = p.widthOf(readout, 12) + 20 * px / A, ty = top + height + 5 * px;
  p.sheet('compass-tag', .5 - tw / 2, ty, tw, lh(12) + 4 * px, { radius: 2 * px });
  p.write('compass-heading', readout, .5, ty + 2 * px + (lh(12) - em(12)) / 2, 12, INK, 'center');
  return ty + lh(12) + 4 * px;
}

// ── the bottle letter, the picker and the sound tag ──

const SEAL = 'M50 6 C62 4 70 12 80 14 C90 18 94 30 94 40 C98 52 92 62 90 72 C84 84 72 90 60 92 C48 96 36 92 28 86 C16 80 8 70 6 58 C4 46 8 34 14 26 C22 14 36 8 50 6 Z';

/** A found bottle: a letter card, the title in small serif and the phrase in handwriting. */
function drawLetter(p, message, top, limit) {
  const { A, px, em, lh } = p, [title, ...rest] = message.split('\n'), pad = 18 * px / A;
  const phrase = p.balance(rest.join(' '), 17 * HAND_SIZE, .92 - 2 * pad - 20 * px / A, HAND, 3);
  const w = Math.min(.92, Math.max(p.widthOf(title, 11), p.widthOf(phrase.join('\n'), 17 * HAND_SIZE, HAND)) + 2 * pad + 20 * px / A);
  const hh = 12 * px + lh(11) + em(17 * HAND_SIZE) * 1.25 * phrase.length + 14 * px, x = .5 - w / 2, y = Math.min(top, limit - hh);
  p.sheet('letter', x, y, w, hh, { radius: px });
  p.torn('letter-edge', x, y, w, hh, 'bottom');
  p.write('letter-title', p.fit(title, 11, w - 2 * pad - 20 * px / A), x + pad, y + 12 * px, 11, p.stamp);
  p.hand('letter-phrase', phrase.join('\n'), .5, y + 12 * px + lh(11), 17, INK, 'center');
  p.icon('letter-seal', SEAL, x + w - 14 * px / A, y + 2 * px, 22 * px, { fill: rgba(STAMP, .85) });
}

function drawPicker(p, phrases) {
  const { A, px, em, lh } = p, [title, ...help] = t('병에 담을 말 고르기 · 숫자 키 · B 닫기').split(' · ');
  const step = lh(14 * HAND_SIZE) * .9, pad = 22 * px / A, margin = 26 * px / A;
  const w = Math.min(.92, Math.max(...phrases.map(s => p.handWidth(t(s), 14)), p.handWidth(title, 20)) + 2 * pad + margin);
  const x = .5 - w / 2, top = .14, hh = 18 * px + lh(20 * HAND_SIZE) + lh(10) + phrases.length * step + 16 * px;
  p.sheet('picker-panel', x, top, w, hh, { radius: px });
  let y = top + 16 * px;
  p.hand('picker-title', title, x + pad, y, 20); y += lh(20 * HAND_SIZE) - 6 * px;
  p.write('picker-help', help.join(' · '), x + pad, y, 10, p.soft); y += lh(10) + 6 * px;
  p.box('picker-margin', x + pad + margin - 8 * px / A, y - 4 * px, 1.2 * px / A, phrases.length * step + 4 * px, rgba(STAMP, .4));
  phrases.forEach((s, i) => {
    const ry = y + i * step;
    p.box(`picker-rule-${i}`, x + pad * .6, ry + step - 1 * px, w - pad * 1.2, px, rgba(TEAL, .25));
    p.write(`picker-n-${i}`, i + 1, x + pad, ry + step - em(12) - 4 * px, 12, p.stamp);
    p.hand(`picker-${i}`, t(s), x + pad + margin, ry + step - em(14 * HAND_SIZE) * 1.05, 14);
  });
}

const SPEAKER = 'M10 38 H30 L54 18 V82 L30 62 H10 Z';
const WAVES = 'M64 34 C72 42 72 58 64 66 M74 24 C88 38 88 62 74 76';
const MUTE = 'M66 36 L90 64 M90 36 L66 64';

/** A speaker, with sound waves or a red cross when muted; the two halves in boxes of their own. */
function speaker(p, id, cx, cy, size, muted) {
  const { A, px } = p, x = cx - size / 2 / A, y = cy - size / 2;
  p.h.path(`${id}-speaker`, SPEAKER, { x, y, w: size * .58, h: size, viewBox: '0 0 58 100', fill: rgba(INK, .85) });
  p.h.path(`${id}-waves`, muted ? MUTE : WAVES, { x: x + size * .6 / A, y, w: size * .4, h: size, viewBox: '60 0 40 100', fill: null, stroke: muted ? p.stamp : rgba(INK, .85), width: 1.4 * px });
}

function drawSound(p, muted) {
  const { A, px } = p, s = 16 * px, w = s / A + 30 * px / A, x = .98 - w, y = .022;
  p.sheet('sound', x, y, w, s + 8 * px, { radius: 2 * px });
  speaker(p, 'sound', x + 6 * px / A + s / 2 / A, y + 4 * px + s / 2, s, muted);
  p.write('sound-key', 'M', x + w - 8 * px / A, y + 4 * px + s / 2 - p.em(10) * .55, 10, p.soft, 'right');
}

// ── the journal and the field guide ──

/** Two facing pages in a cloth cover (one page when the frame is tall): returns the pages. */
function openBook(p, id, area) {
  const { A, px } = p, { x0, x1, y0, y1 } = area, cover = 7 * px;
  p.box(`${id}-shade`, x0 - 6 * px / A, y0 - px, x1 - x0 + 12 * px / A, y1 - y0 + 12 * px, 'rgba(10,8,6,.22)', 10 * px);
  p.box(`${id}-cover`, x0, y0, x1 - x0, y1 - y0, rgba(mix(CLOTH, [8, 10, 12], p.night * .4)), 8 * px);
  const top = y0 + cover, bottom = y1 - cover, l = x0 + cover / A, r = x1 - cover / A, two = A >= 1;
  p.box(`${id}-edges`, l, top, r - l, bottom - top + 1.5 * px, rgba(mix([214, 199, 166], [24, 18, 12], p.lamp)), 2 * px);
  const mid = (l + r) / 2, pages = two ? [[l, mid], [mid, r]] : [[l, r]];
  pages.forEach(([a, b], i) => p.sheet(`${id}-page-${i}`, a, top, b - a, bottom - top - px, { radius: 2 * px, lift: false }));
  if (two) {
    // The fold's shade, half on each page.
    for (const [side, from] of [['left', -1], ['right', 0]]) [[9, .08], [3, .12], [.5, .3]].forEach(([w, a], i) =>
      p.box(`${id}-gutter-${side}-${i}`, mid + from * w * px / A, top, w * px / A, bottom - top - px, `rgba(60,40,20,${a})`));
  }
  return { top, bottom, pages };
}

/** Ruled lines and a red margin on a page: rows of `pitch` from y to the page's bottom. */
function ruled(p, id, x0, x1, y, bottom, pitch, margin) {
  const rows = Math.max(0, Math.floor((bottom - y) / pitch));
  for (let i = 1; i <= rows; i++) p.box(`${id}-rule-${i}`, x0, y + i * pitch, x1 - x0, .8 * p.px, rgba(TEAL, .22));
  if (margin) p.box(`${id}-margin`, margin, y, .9 * p.px / p.A, rows * pitch, rgba(STAMP, .32));
  return rows;
}

const BOAT_SKETCH = 'M18 70 L82 70 L74 80 L26 80 Z M49 18 L49 66 L22 66 Z M53 24 C63 36 69 50 70 66 L53 66 Z';
const SEA_SKETCH = 'M2 88 Q14 82 26 88 T50 88 T74 88 T98 88';

function drawJournal(p, log, area, touch) {
  const { A, px, em, lh } = p, { top, bottom, pages } = openBook(p, 'journal', area);
  const [first, second] = pages, pad = 22 * px / A, L = first[0] + pad, R = first[1] - pad;
  let y = top + 18 * px;
  p.write('journal-kicker', 'VOYAGE NOTES', L, y, 10, p.stamp); y += lh(10);
  p.hand('journal-title', t('항해 노트'), L, y - 2 * px, 26);
  p.write('journal-close', t(touch ? '노트 버튼으로 닫기' : 'J / ESC 닫기'), (second ?? first)[1] - pad, top + 18 * px, 10, p.soft, 'right');
  y += em(26 * HAND_SIZE) * 1.2;
  p.box('journal-rule', L, y, R - L, 1.2 * px, rgba(TEAL, .5)); y += 12 * px;
  const v = log?.voyage, room = R - L;
  if (v) {
    p.write('voyage-label', t('이번 항해'), L, y, 11, p.stamp); y += lh(11);
    p.write('voyage-distance', p.fit(`${km(v.distance)}  ·  ${duration(v.time)}`, 19, room), L, y, 19); y += lh(19);
    p.write('voyage-detail', p.fit(t('최고 {top}노트  ·  섬 {islands}곳  ·  생물 {species}종', { top: knots(v.top), islands: v.islands, species: v.species }), 12, room), L, y, 12, p.soft); y += lh(12) + 10 * px;
  }
  const tt = log?.totals;
  if (tt) {
    p.write('total-label', t('지금까지'), L, y, 11, p.stamp); y += lh(11);
    p.write('total-distance', p.fit(t('{distance}  ·  {time}  ·  {n}번째 항해', { distance: km(tt.distance), time: duration(tt.time), n: tt.voyages }), 14, room), L, y, 14); y += lh(14);
    p.write('total-detail', p.fit(t('만난 섬 {islands}곳  ·  만난 생물 {species}종', { islands: tt.islands, species: tt.species }), 11, room), L, y, 11, p.soft); y += lh(11) + 10 * px;
  }
  // The log of moments: on the right-hand page, or under the figures on a single page.
  const [a, b] = second ?? first, logTop = second ? top + 18 * px + lh(10) : y + 4 * px;
  const left = a + pad, margin = left + 18 * px / A, pitch = lh(14) * 1.08, rows = ruled(p, 'journal', a + pad * .5, b - pad * .5, logTop, bottom - 10 * px, pitch, margin);
  if (second && bottom - y > .14) {
    const s = Math.min(bottom - y - 16 * px, (R - L) * A * .28);
    p.icon('journal-boat', BOAT_SKETCH, (L + R) / 2, bottom - 14 * px - s / 2, s, { fill: rgba(TEAL, .5) });
    p.h.path('journal-sea', SEA_SKETCH, { x: (L + R) / 2 - s / 2 / A, y: bottom - 14 * px - s * .22, w: s, h: s * .14, viewBox: '0 78 100 14', fill: null, stroke: rgba(TEAL, .5), width: 1.2 * px });
  }
  const textX = margin + 8 * px / A, width = b - pad - textX, line = i => logTop + i * pitch;
  const entries = log?.voyage?.entries ?? [];
  if (!entries.length) {
    if (rows > 0) p.write('journal-empty', p.fit(t('아직 기록된 순간이 없어요'), 14, width), textX, line(1) - em(14) * 1.05, 14);
    if (rows > 1) p.write('journal-empty-detail', p.fit(t('지나온 섬과 만난 생물이 여기에 남아요.'), 11, width), textX, line(2) - em(11) * 1.1, 11, p.soft);
    return;
  }
  entries.slice(-Math.floor(rows / 2)).reverse().forEach((entry, i) => {
    const r1 = line(2 * i + 1), r2 = line(2 * i + 2);
    p.write(`record-mark-${i}`, entry.kind === 'creature' ? '◆' : entry.kind === 'island' ? '▲' : '◇', margin - 4 * px / A, r1 - em(10) * 1.15, 10, entry.kind === 'creature' ? p.teal : p.stamp, 'right');
    p.write(`record-title-${i}`, p.fit(entry.title, 14, width), textX, r1 - em(14) * 1.05, 14);
    if (entry.description) p.write(`record-detail-${i}`, p.fit(entry.description, 11, width), textX, r2 - em(11) * 1.1, 11, p.soft);
  });
}

// One ink silhouette per species in a 200 × 100 box, facing right; every subpath winds clockwise
// so overlaps join, and eyes wind the other way so they show as holes.
const SPECIES = {
  dolphin: 'M186 68 C176 66 166 61 158 57 C154 60 148 64 140 68 C144 62 146 56 146 50 C132 42 112 40 92 46 C70 54 52 68 40 79 C36 82 32 86 28 92 C26 82 20 76 12 72 C22 70 30 71 37 72 C40 68 44 63 48 58 C62 42 80 31 96 27 C98 21 98 15 96 8 C104 11 110 17 114 25 C122 24 132 25 140 27 C156 30 168 40 172 52 C176 56 180 62 186 68 Z M160 40 C162 42 165 42 166 40 C165 38 162 38 160 40 Z',
  humpback: 'M93 92 C93 82 92 72 90 64 C76 58 60 52 44 49 C32 47 20 42 10 37 C22 33 38 34 52 38 C72 44 90 52 101 58 C99 68 99 80 100 92 Z M99 58 C110 52 128 44 148 38 C162 34 178 33 190 37 C180 42 168 47 156 49 C140 52 124 58 110 64 C108 72 107 82 107 92 L100 92 Z M84 92 C92 90 108 90 116 92 C108 95 92 95 84 92 Z',
  orca: 'M186 60 C180 67 166 72 150 74 C128 76 100 76 72 74 C52 74 34 72 21 68 C16 72 9 77 2 80 C3 75 7 70 11 66 C10 60 7 55 2 48 C8 49 14 54 18 60 C24 61 30 59 38 56 C52 50 70 46 90 44 C96 32 102 16 106 2 C112 14 116 30 120 44 C128 43 138 43 148 44 C166 46 180 52 186 60 Z M152 52 C158 55 164 55 170 54 C166 51 158 50 152 52 Z',
  turtle: 'M100 22 C128 22 148 36 148 52 C148 70 128 80 100 80 C72 80 52 70 52 52 C52 36 72 22 100 22 Z M146 46 C156 40 164 40 170 44 C176 48 176 56 170 60 C164 64 156 62 146 56 Z M128 30 C144 16 160 8 178 8 C172 18 158 30 138 38 Z M138 66 C156 74 170 86 176 94 C160 94 144 88 128 74 Z M66 38 C54 34 42 28 36 20 C50 18 62 22 74 30 Z M74 74 C62 82 50 86 36 84 C42 76 54 70 66 66 Z M56 54 C46 56 38 55 30 52 C38 49 46 48 56 50 Z',
  manta: 'M100 26 C112 26 122 32 130 40 C150 42 174 46 196 56 C176 58 152 62 132 66 C124 74 112 80 100 82 C88 80 76 74 68 66 C48 62 24 58 4 56 C26 46 50 42 70 40 C78 32 88 26 100 26 Z M103 80 C101 89 99 95 95 99 C97 94 98 88 98 80 Z M86 30 C84 20 86 14 90 10 C92 16 93 22 93 28 Z M107 28 C107 22 108 16 110 10 C114 14 116 20 114 30 Z',
  flyingfish: 'M188 52 C178 58 162 61 140 62 C100 64 60 63 34 61 L2 88 C8 76 16 66 22 57 C20 52 16 44 8 34 L32 54 C40 54 48 53 60 51 C90 47 120 44 150 44 C166 44 180 46 188 52 Z M112 49 C94 39 80 30 72 22 C70 18 68 12 62 5 C96 15 122 30 142 48 Z M134 59 C118 71 98 81 74 89 C90 77 104 67 118 59 Z M168 50 C170 52 173 52 174 50 C173 48 170 48 168 50 Z',
  gull: 'M100 52 C108 44 120 36 136 32 C154 28 174 30 194 38 C174 38 156 40 142 46 C128 52 116 58 108 62 C104 66 102 70 100 74 C98 70 96 66 92 62 C84 58 72 52 58 46 C44 40 26 38 6 38 C26 30 46 28 64 32 C80 36 92 44 100 52 Z',
};

/** Tally marks for a count, in groups of five: a path 7 units a mark, 16 units tall. */
function tally(n) {
  let d = '';
  for (let i = 0, x = 3; i < n; i++) {
    if (i % 5 === 4) d += `M${x - 30} 12 L${x - 2} 4 `;
    else d += `M${x + jag(i) * 1.5} 2 L${x - .5} 15 `;
    x += i % 5 === 4 ? 9 : 7;
  }
  return d;
}

function drawGuide(p, guide, area, touch) {
  const { A, px, em, lh } = p, { top, bottom, pages } = openBook(p, 'guide', area), two = pages.length === 2;
  const pad = 22 * px / A, L = pages[0][0] + pad, R = pages[pages.length - 1][1] - pad, seen = guide.filter(g => g.seen).length;
  let y = top + 18 * px;
  p.write('guide-kicker', 'FIELD GUIDE', L, y, 10, p.stamp);
  p.write('guide-close', t(touch ? '도감 버튼으로 닫기' : 'K / ESC 닫기'), R, y, 10, p.soft, 'right'); y += lh(10);
  p.hand('guide-title', t('바다 도감  {seen} / {total}', { seen, total: guide.length }), L, y - 2 * px, 24);
  y += em(24 * HAND_SIZE) * 1.15;
  // Cards: four columns over the spread (two a page), or one card a row on a single page.
  const cols = two ? 4 : 1, rows = Math.ceil(guide.length / cols), gap = (two ? 10 : 5) * px;
  const cell = (i) => {
    const c = i % cols, r = Math.floor(i / cols), page = pages[two ? Math.floor(c / 2) : 0];
    const pl = page[0] + pad, pw = page[1] - page[0] - 2 * pad, per = two ? 2 : 1, cw = (pw - (per - 1) * gap / A) / per;
    const ch = (bottom - 12 * px - y - (rows - 1) * gap) / rows;
    return { x: pl + (c % per) * (cw + gap / A), y: y + r * (ch + gap), w: cw, h: ch };
  };
  guide.forEach((g, i) => {
    const c = cell(i), id = `guide-card-${i}`;
    p.box(id, c.x, c.y, c.w, c.h, rgba(mix([255, 252, 242], LAMP, p.lamp), .35), 2 * px);
    p.h.panel(`${id}-line`, { x: c.x, y: c.y, w: c.w * A, h: c.h, radius: 2 * px, fill: null, stroke: rgba(INK, .22), width: .8 * px });
    if (two) p.h.path(`${id}-tape`, `M0 ${2 + jag(i) * 4} L100 0 L100 ${16 - jag(i) * 4} L0 18 Z`, { x: c.x + c.w / 2 - 14 * px / A, y: c.y - 5 * px, w: 28 * px, h: 9 * px, viewBox: '0 0 100 18', fill: rgba(mix([250, 244, 226], LAMP, p.lamp), .7) });
    const inner = 8 * px / A, d = SPECIES[g.key];
    // The sketch: on top in a grid card, to the left in a row card.
    const sh = two ? Math.min(c.h * .38, (c.w - 2 * inner) * A / 2) : Math.min(c.h - 12 * px, (c.w * .28) * A / 2);
    const sx = two ? c.x + c.w / 2 - sh / A : c.x + inner, sy = two ? c.y + 10 * px : c.y + (c.h - sh) / 2;
    if (d) p.h.path(`${id}-sketch`, d, { x: sx, y: sy, w: sh * 2, h: sh, viewBox: '0 0 200 100', ...(g.seen ? { fill: rgba(mix(TEAL, INK, .35), .92) } : { fill: null, stroke: 'rgba(90,76,60,.4)', width: .9 * px }) });
    const tx = two ? c.x + inner : sx + sh * 2 / A + inner, tw = c.x + c.w - inner - tx;
    let ty = two ? sy + sh + 6 * px : c.y + 5 * px;
    if (g.seen) {
      const count = g.seen <= 10 ? em(9) * 74 / 16 / A : p.widthOf(t('{n}번', { n: g.seen }), 9), room = tw - count - 8 * px / A;
      const size = Math.max(11, Math.min(15, 15 * room / p.handWidth(g.name, 15))), name = p.fit(g.name, size * HAND_SIZE, room, HAND);
      p.hand(`${id}-name`, name, tx, ty + em(15 - size) * HAND_SIZE * .7, size);
      const cx = tx + p.handWidth(name, size) + 8 * px / A, cy = ty + em(15 * HAND_SIZE) * .62 - em(9) / 2;
      if (g.seen <= 10) p.h.path(`${id}-tally`, tally(g.seen), { x: cx, y: cy, w: em(9) * 74 / 16, h: em(9), viewBox: '0 0 74 16', fill: null, stroke: p.stamp, width: 1.2 * px });
      else p.write(`${id}-count`, t('{n}번', { n: g.seen }), cx, cy - px, 9, p.stamp);
      ty += em(15 * HAND_SIZE) * (two ? 1.2 : 1.04);
      const most = Math.floor((c.y + c.h - 6 * px - ty) / (em(9.5) * 1.25));
      if (most > 0) p.write(`${id}-about`, p.wrap(g.about, 9.5, tw, undefined, most).join('\n'), tx, ty, 9.5, p.soft);
    } else {
      p.box(`${id}-blank`, tx, ty + em(15 * HAND_SIZE) * .9, Math.min(tw, 60 * px / A), .9 * px, 'rgba(90,76,60,.35)');
    }
  });
}

// ── touch buttons: paper tokens with ink glyphs ──

const ARROWS = { left: 'M24 50 L70 22 V78 Z', right: 'M76 50 L30 22 V78 Z', fast: 'M50 22 L80 72 H20 Z', slow: 'M50 78 L20 28 H80 Z' };

function drawTouch(p, state) {
  const { A } = p, buttons = state.touch?.buttons ?? [];
  const rows = buttons.filter(b => b.w);
  if (rows.length) drawLetterRows(p, rows, Math.max(0, ...buttons.filter(b => !b.w && b.y < .3).map(b => b.y + b.r)));
  const small = buttons.filter(b => !b.w && !b.caption && b.id !== 'sound');
  const label = Math.min(12, ...small.map(b => 12 * 1.5 * b.r / A / p.widthOf(b.label, 12)));
  for (const b of buttons) {
    if (b.w || (b.id === 'sound' && !state.sound)) continue;
    const id = `touch-${b.id}`, x = b.x - b.r / A, y = b.y - b.r;
    p.sheet(id, x, y, 2 * b.r / A, 2 * b.r, { radius: b.r, lift: !b.pressed, press: b.pressed ? .16 : 0 });
    if (ARROWS[b.id]) {
      p.icon(`${id}-glyph`, ARROWS[b.id], b.x, b.y - b.r * (b.caption ? .2 : 0), b.r * .78, { fill: rgba(INK, .88) });
      if (b.caption) p.write(`${id}-caption`, b.caption, b.x, b.y + b.r * .34, Math.min(9, 9 * 1.3 * b.r / A / p.widthOf(b.caption, 9)), p.soft, 'center');
    } else if (b.id === 'sound') {
      speaker(p, id, b.x, b.y, b.r * .9, state.sound.muted);
    } else {
      const size = label, [inkTop, inkBottom] = p.inkOf(lang === 'ko' ? '가' : 'H', size);
      p.write(`${id}-label`, b.label, b.x, b.y - (inkTop + inkBottom) / 2, size, INK, 'center');
    }
  }
}

/** The bottle phrases as touch rows: lines of a letter, numbered in the margin. */
function drawLetterRows(p, rows, under) {
  const { A, px, em, lh } = p, [title] = t('병에 담을 말 고르기 · 숫자 키 · B 닫기').split(' · ');
  const x0 = Math.min(...rows.map(b => b.x - b.w / 2)), x1 = Math.max(...rows.map(b => b.x + b.w / 2));
  const y0 = Math.min(...rows.map(b => b.y - b.h / 2)), y1 = Math.max(...rows.map(b => b.y + b.h / 2));
  const head = lh(18 * HAND_SIZE) + lh(10), top = Math.max(y0 - head - 12 * px, under + 4 * px);
  p.sheet('picker-panel', x0 - 10 * px / A, top, x1 - x0 + 20 * px / A, y1 - top + 10 * px, { radius: px });
  p.hand('picker-title', title, x0 + 8 * px / A, top + 10 * px, 18);
  p.write('picker-help', t('편지 버튼으로 닫기'), x0 + 8 * px / A, top + 10 * px + lh(18 * HAND_SIZE) - 6 * px, 10, p.soft);
  const margin = x0 + 30 * px / A;
  p.box('picker-margin', margin - 6 * px / A, y0, .9 * px / A, y1 - y0, rgba(STAMP, .32));
  rows.forEach((b, i) => {
    const rowTop = b.y - b.h / 2, [number, ...words] = b.label.split('  '), phrase = words.join('  ');
    if (b.pressed) p.box(`picker-press-${i}`, x0, rowTop, x1 - x0, b.h, rgba(STAMP, .12));
    p.box(`picker-rule-${i}`, x0, rowTop + b.h - px, x1 - x0, .8 * px, rgba(TEAL, .25));
    const size = Math.min(16, .55 * b.h / (HAND_SIZE * px)); // as large as the row allows
    p.write(`picker-n-${i}`, number, margin - 12 * px / A, b.y - em(12) * .6, 12, p.stamp, 'right');
    p.hand(`picker-${i}`, p.fit(phrase, size * HAND_SIZE, x1 - margin - 8 * px / A, HAND), margin + 4 * px / A, b.y - em(size * HAND_SIZE) * .62, size);
  });
}
