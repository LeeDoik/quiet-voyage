import { platform } from './platform.js';

const CARDINAL = { 0: '북', 45: '북동', 90: '동', 135: '남동', 180: '남', 225: '남서', 270: '서', 315: '북서' };
const WEATHER = { rain: '비', gust: '돌풍', haze: '해무', breeze: '산들바람', rainbow: '무지개' };
const pad2 = n => String(Math.floor(n)).padStart(2, '0');
function duration(seconds) {
  const s = Math.max(0, Math.floor(seconds)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
  return h ? `${h}시간 ${pad2(m)}분` : `${m}분 ${pad2(s % 60)}초`;
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

  const has = (keys, ...names) => names.some(name => keys.has(name));
  const pressed = (keys, ...names) => names.some(name => keys.has(name) && !previousKeys.has(name));

  return {
    reset() {
      elapsed = 0; journalOpen = false; guideOpen = false; previousKeys = new Set();
      moved = false; turned = false; greeted = false; wasPlaying = false;
    },
    update(dt, input, state) {
      const keys = input.keys;
      if (state.phase === 'playing') {
        elapsed += dt;
        if (wasPlaying) {
          if (pressed(keys, 'KeyJ', 'j')) { journalOpen = !journalOpen; guideOpen = false; }
          if (pressed(keys, 'KeyK', 'k')) { guideOpen = !guideOpen; journalOpen = false; }
          if (pressed(keys, 'Escape') || state.photo) { journalOpen = false; guideOpen = false; }
          if (has(keys, 'KeyW', 'w', 'ArrowUp')) moved = true;
          if (has(keys, 'KeyA', 'a', 'KeyD', 'd', 'ArrowLeft', 'ArrowRight')) turned = true;
          if (has(keys, 'KeyE', 'e')) greeted = true;
        }
        wasPlaying = true;
      } else {
        wasPlaying = false;
      }
      previousKeys = new Set(keys);
    },
    hud(state) {
      const h = window.__studio.hud;
      h.clear();
      const view = state.view ?? { aspect: 16 / 9, k: 1 };
      const A = view.aspect, K = view.k;               // frame width/height; text boost on small screens
      const touch = state.touch?.active;
      const text = (id, value, x, y, size, color = '#f7f8ef', align = 'left') =>
        h.text(id, String(value), { x, y, size: size * K, color, align, shadow: true });
      // Panels and lines take widths as a fraction of the frame's width.
      const panel = (id, x, y, w, hh, opts = {}) => h.panel(id, { x, y, w: w * A, h: hh, ...opts });
      const line = (id, x, y, w, color = 'rgba(239,246,229,0.6)') => panel(id, x, y, w, 0.0015, { fill: color });

      const U = view.unit ?? 1 / 720, lh = size => size * K * U * 1.5;   // line height as a frame fraction
      if (state.phase === 'menu') {
        let y = .2;
        text('eyebrow', 'A  Q U I E T  V O Y A G E', .5, y, 12, '#e7f0e6', 'center'); y += lh(12) + .012;
        line('title-rule', .45, y, .1); y += .02;
        text('title', '함께 흐르는 바다', .5, y, 39, '#fffbed', 'center'); y += lh(39) + .01;
        text('subtitle', '바람이 이끄는 곳으로, 천천히', .5, y, 16, '#f2f5e9', 'center');
        text('start', touch ? '화면을 눌러 출항하기' : '아무 키나 눌러 출항하기', .5, .81, 16, '#fffdf3', 'center');
        text('start-detail', '끝없는 바다, 섬과 고래와 다른 배들', .5, .853, 12, '#e5eee7', 'center');
        return;
      }

      const boat = state.boat, log = state.log;
      if (state.photo) {
        const a = Math.max(0, Math.min(1, 4 - state.photo.time));
        if (a > 0) text('photo-hint', touch ? '사진 모드 · ◀▶ 돌기 · ▲▼ 거리 · 저장 · 닫기' : '사진 모드 · ← → 돌기 · ↑ ↓ 거리 · Space 저장 · C 나가기', .5, touch ? .62 : .9, 13, `rgba(255,253,239,${a})`, 'center');
        if (state.photo.saved > 0) text('photo-saved', '사진을 저장했어요', .5, .5, 16, `rgba(255,244,207,${Math.min(1, state.photo.saved)})`, 'center');
        drawTouch(h, state, text, A);
        return;
      }
      if (guideOpen && log?.guide) {
        const w = A < 1 ? .9 : Math.min(.62, .95 / A + .1), x = A < 1 ? .05 : .055, L = x + .03;
        panel('guide-panel', x, .1, w, .78, { radius: .016, fill: 'rgba(16, 43, 47, 0.9)', stroke: 'rgba(226, 239, 225, 0.32)', width: .001 });
        const seen = log.guide.filter(g => g.seen).length;
        let y = .135;
        text('guide-kicker', 'FIELD GUIDE', L, y, 11, '#c7ded4'); y += lh(11);
        text('guide-title', `바다 도감  ${seen} / ${log.guide.length}`, L, y, 24, '#fff9e9'); y += lh(24) + .012;
        const row = (.84 - y) / log.guide.length;
        log.guide.forEach((g, i) => {
          const ry = y + i * row;
          text(`guide-name-${i}`, g.seen ? `◆ ${g.name}  ·  ${g.seen}번` : '◇ ???', L, ry, 15, g.seen ? '#fff9e9' : 'rgba(240,248,237,0.45)');
          if (g.seen) text(`guide-about-${i}`, g.about, L + .02, ry + lh(15), 10, '#c9ddd5');
        });
        drawTouch(h, state, text, A);
        return;
      }
      if (state.bottles?.picker && !touch) {
        const w = .5, x = .25;
        panel('picker-panel', x, .16, w, .1 + state.bottles.phrases.length * lh(14), { radius: .014, fill: 'rgba(16, 43, 47, 0.9)' });
        text('picker-title', '병에 담을 말 고르기 · 숫자 키 · B 닫기', x + .025, .18, 12, '#e7d8aa');
        state.bottles.phrases.forEach((p, i) => text(`picker-${i}`, `${i + 1}   ${p}`, x + .025, .22 + i * lh(14), 14, '#fff9e9'));
      }
      if (journalOpen) {
        const w = A < 1 ? .9 : Math.min(.62, .95 / A + .1), x = A < 1 ? .05 : .055;
        panel('journal-panel', x, .1, w, .78, { radius: .016, fill: 'rgba(16, 43, 47, 0.9)', stroke: 'rgba(226, 239, 225, 0.32)', width: .001 });
        const L = x + .03, R = x + w - .03;
        let y = .135;
        text('journal-kicker', 'VOYAGE NOTES', L, y, 11, '#c7ded4'); y += lh(11);
        text('journal-title', '항해 노트', L, y, 27, '#fff9e9');
        text('journal-close', touch ? '노트 버튼으로 닫기' : 'J / ESC 닫기', R, y + lh(27) * .3, 12, '#d6e8df', 'right'); y += lh(27) + .008;
        line('journal-rule', L, y, w - .06, 'rgba(220,237,224,0.3)'); y += .02;
        const v = log?.voyage;
        if (v) {
          text('voyage-label', '이번 항해', L, y, 12, '#e7d8aa'); y += lh(12);
          text('voyage-distance', `${km(v.distance)}  ·  ${duration(v.time)}`, L, y, 20, '#fff9e9'); y += lh(20);
          text('voyage-detail', `최고 ${knots(v.top)}노트  ·  섬 ${v.islands}곳  ·  생물 ${v.species}종`, L, y, 13, '#c9ddd5'); y += lh(13) + .012;
        }
        const t = log?.totals;
        if (t) {
          text('total-label', '지금까지', L, y, 12, '#e7d8aa'); y += lh(12);
          text('total-distance', `${km(t.distance)}  ·  ${duration(t.time)}  ·  ${t.voyages}번째 항해`, L, y, 15, '#f1f5e9'); y += lh(15);
          text('total-detail', `만난 섬 ${t.islands}곳  ·  만난 생물 ${t.species}종`, L, y, 12, '#c9ddd5'); y += lh(12) + .012;
        }
        line('journal-rule-2', L, y, w - .06, 'rgba(220,237,224,0.18)'); y += .02;
        const entries = log?.voyage?.entries ?? [];
        if (!entries.length) {
          text('journal-empty', '아직 기록된 순간이 없어요', L, y, 16, '#f1f5e9'); y += lh(16);
          text('journal-empty-detail', '지나온 섬과 만난 생물이 여기에 남아요.', L, y, 12, '#c9ddd5');
        } else {
          const row = lh(15) + lh(11) + .006, fit = Math.max(1, Math.floor((.86 - y) / row));
          entries.slice(-fit).reverse().forEach((entry, i) => {
            const ry = y + i * row;
            text(`record-mark-${i}`, entry.kind === 'creature' ? '◆' : entry.kind === 'island' ? '▲' : '·', L, ry + lh(15) * .12, 12, '#e7d8aa');
            text(`record-title-${i}`, entry.title, L + .025 * Math.max(1, 1 / A), ry, 15, '#fff9e9');
            if (entry.description) text(`record-detail-${i}`, entry.description, L + .025 * Math.max(1, 1 / A), ry + lh(15), 11, '#c9ddd5');
          });
        }
        drawTouch(h, state, text, A);
        return;
      }

      // Developer panels: the owner only (studio, localhost, or the site with ?dev=<key>).
      if (platform.dev && state.performance?.panel) {
        const perf = state.performance, bots = state.bots;
        const results = perf.completedCases === 24 ? perf.summary : [];
        h.panel('perf-panel', { x: .02, y: .02, w: .64, h: results.length ? .49 : .26, fill: 'rgba(10,30,34,.88)' });
        text('perf-title', '성능 시험 · 로컬 봇 (서버 부하 제외)', .035, .045, 15);
        text('perf-controls', '1: 0척   2: 16척   3: 64척   4: 128척   L: 최적화 전환', .035, .09, 12);
        text('perf-run', 'B: 시험 항로에서 비교 측정   O: 결과 저장   P: 닫기', .035, .13, 12);
        text('perf-count', `${perf.optimized ? '컬링 + LOD' : '기준 모드'} · 봇 ${bots.count} · 시야 후보 ${bots.high + bots.low} · 저상세 ${bots.low}`, .035, .17, 12);
        text('perf-draw', `그리기 ${perf.draw.calls}회 · 삼각형 ${perf.draw.triangles.toLocaleString()}개`, .035, .21, 12);
        if (perf.error || perf.progress) text('perf-progress', perf.error || perf.progress, .035, .255, 12, '#ead8a7');
        if (results.length) {
          text('perf-result-title', '동기식 처리 중앙값(ms) · 기준 → 최적화 · FPS 아님', .035, .305, 12, '#ead8a7');
          results.forEach((row, i) => text(`perf-result-${i}`, `${row.bots}척: ${row.baseline.medianMs} → ${row.optimized.medianMs} ms   /   그리기 ${row.baseline.calls} → ${row.optimized.calls}회`, .035, .35 + i * .04, 12));
        }
      }
      const g = state.graphics;
      if (platform.dev && g?.shown) {
        h.panel('graphics-panel', { x: .70, y: .12, w: .46, h: .5, fill: 'rgba(10,30,34,.88)' });
        text('graphics-title', '그래픽 현황  ·  G 닫기', .715, .145, 14);
        text('graphics-fps', g.status === 'live' ? `렌더 FPS ${g.fps} · 해상도 배율 ${g.dpr?.toFixed?.(2) ?? g.dpr}` : '프레임 측정 대기 / 일시정지', .715, .19, 12);
        text('graphics-time', `간격 ${g.meanMs ?? '—'} ms / P95 ${g.p95Ms ?? '—'}`, .715, .23, 12);
        text('graphics-draw', `그리기 ${g.calls} · 삼각형 ${g.triangles.toLocaleString()}`, .715, .27, 12);
        text('graphics-assets', `지오메트리 ${g.geometries} · 텍스처 ${g.textures} · 셰이더 ${g.programs}`, .715, .31, 12);
        const w = state.world;
        text('graphics-world', `섬 ${w?.islands?.loaded ?? 0} (대기 ${w?.islands?.queued ?? 0}) · 생물 그룹 ${w?.life?.groups ?? 0} / 보임 ${w?.life?.visible ?? 0}`, .715, .35, 11);
        text('graphics-culling', `시야 제외: 나무 ${state.visibility.culledTrees} · 바다 ${state.water.culled}`, .715, .39, 11);
        text('graphics-pos', `위치 ${Math.round(boat?.x ?? 0)}, ${Math.round(boat?.z ?? 0)} · 시계 ${Math.round(w?.clock ?? 0)}s`, .715, .43, 11);
        text('graphics-net', `네트워크: ${state.social?.availability ?? '—'} · 근처 배 ${state.social?.peers ?? 0}`, .715, .47, 11);
      }

      if (boat?.helm) drawCompass(h, boat, text, panel, A, K, touch && view.portrait ? .2 : .022, U, WEATHER[state.world?.rainbow ? 'rainbow' : state.world?.weather] ?? '');

      // One prompt at a time, dismissed by the action it teaches or by time.
      let hint = '';
      if (elapsed < 15 && !moved) hint = touch ? '▲  바람을 타고 나아가기' : 'W / ↑  바람을 타고 나아가기';
      else if (elapsed < 28 && !turned) hint = touch ? '◀ ▶  천천히 방향 바꾸기' : 'A D / ← →  천천히 방향 바꾸기';
      else if (elapsed > 32 && elapsed < 42 && !greeted && state.social?.connected) hint = touch ? '빛  버튼으로 인사하기' : 'E  빛으로 인사하기';
      if (hint) {
        const fade = Math.min(1, elapsed / 1.5, (hint.includes('나아가기') ? 15 - elapsed : hint.includes('방향') ? 28 - elapsed : 42 - elapsed) / 2);
        text('hint', hint, .5, touch ? .62 : .88, 15, `rgba(255, 253, 239, ${Math.max(0, fade)})`, 'center');
      }
      const social = state.social;
      const notice = log?.notice || social?.notice;
      if (notice) text('notice', notice, .5, touch ? (view.portrait ? .34 : .24) : .78, 15, '#fff4cf', 'center');
      if (social && !touch) {
        const mode = social.practice ? '동행 연습 · 로컬 배 1척' : social.connected ? `같은 바다 · 근처 배 ${social.peers}척` : '혼자 흐르는 바다';
        text('quiet-mode', social.name && social.connected ? `${mode}  ·  ${social.name}` : mode, .035, .69, 12, '#e0eeeb');
        text('quiet-controls', 'E  빛물결    R  빛의 흔적', .035, .73, 13, '#fff4cf');
        if (social.canPractice) text('quiet-practice', `H  ${social.practice ? '동행 연습 마치기' : '동행 연습'}`, .035, .77, 12, '#e0eeeb');
      } else if (social?.connected) {
        text('quiet-mode', `근처 배 ${social.peers}척`, .5, (view.portrait ? .2 : .022) + Math.max(.05, 30 * K * U) + lh(12) + .012, 11, '#e0eeeb', 'center');
      }
      if (social?.resonance > .1) {
        h.bar('quiet-resonance', social.resonance, { x: touch ? .39 : .035, y: touch ? .245 : .815, w: .22, h: .006, color: '#9af1df', back: 'rgba(255,255,255,.15)' });
        text('quiet-together', social.companions ? '같은 바람을 타고 있어요' : '나란히 흐르는 중', touch ? .5 : .035, touch ? .26 : .835, 11, '#b8f5e2', touch ? 'center' : 'left');
      }
      if (!touch) text('journal-key', `J 노트   K 도감   B 편지   C 사진${platform.dev ? '   P 성능   G 그래픽' : ''}`, .035, .945, 12, 'rgba(240, 248, 237, 0.8)');
      drawTouch(h, state, text, A);
    }
  };
}

// A heading tape across the top: cardinal points slide past a fixed lubber mark, the wind's
// source is a small blue diamond, and the heading and speed read underneath.
function drawCompass(h, boat, text, panel, A, K, top, U, sky) {
  const heading = boat.helm.heading, span = 70;
  const w = Math.min(.92, .42 * Math.max(1, 1.6 / A)), left = .5 - w / 2, height = Math.max(.05, 30 * K * U);
  panel('compass-back', left, top, w, height, { radius: .012, fill: 'rgba(12, 36, 40, 0.42)', stroke: 'rgba(226,239,225,0.22)', width: .001 });
  const at = deg => { let d = ((deg - heading + 540) % 360) - 180; return Math.abs(d) <= span ? .5 + d / span * (w / 2) * .92 : null; };
  for (let deg = 0; deg < 360; deg += 15) {
    const x = at(deg);
    if (x === null) continue;
    const label = CARDINAL[deg];
    if (label) text(`compass-${deg}`, label, x, top + height * (label.length === 1 ? .2 : .3), label.length === 1 ? 14 : 10, deg === 0 ? '#ffb39a' : label.length === 1 ? '#fff8e6' : '#cfe3dc', 'center');
    else panel(`compass-tick-${deg}`, x - .0008, top + height * .62, .0016, height * .25, { fill: 'rgba(240,248,237,0.55)', radius: 0 });
  }
  const from = (((-boat.wind.direction * 180 / Math.PI) % 360) + 360 + 180) % 360;
  const wx = at(from);
  if (wx !== null) text('compass-wind', '◆', wx, top + height * .02, 9, '#9fe3f5', 'center');
  text('compass-mark', '▼', .5, top - .012, 10, '#ffe7a8', 'center');
  text('compass-heading', `${String(Math.round(heading) % 360).padStart(3, '0')}°  ·  ${knots(boat.speed)}노트${wx === null ? `  ·  바람 ${CARDINAL[Math.round(from / 45) * 45 % 360]}에서` : ''}${sky ? `  ·  ${sky}` : ''}`, .5, top + height + .008, 12, '#f4f1df', 'center');
}

function drawTouch(h, state, text, A) {
  for (const b of state.touch?.buttons ?? []) {
    if (b.w) {
      h.panel(`touch-${b.id}`, { x: b.x - b.w / 2, y: b.y - b.h / 2, w: b.w * A, h: b.h, radius: .012, fill: b.pressed ? 'rgba(255,244,207,0.35)' : 'rgba(16,43,47,0.85)', stroke: 'rgba(240,248,237,0.4)', width: .0015 });
      text(`touch-${b.id}-label`, b.label, b.x - b.w / 2 + .03, b.y - .018, 13, '#fff8e6');
      continue;
    }
    h.panel(`touch-${b.id}`, { x: b.x - b.r / A, y: b.y - b.r, w: b.r * 2, h: b.r * 2, radius: b.r, fill: b.pressed ? 'rgba(255,244,207,0.32)' : 'rgba(12,36,40,0.32)', stroke: 'rgba(240,248,237,0.55)', width: .002 });
    const big = b.label.length === 1;
    text(`touch-${b.id}-label`, b.label, b.x, b.y - (big ? .03 : .018), big ? 22 : 12, '#fff8e6', 'center');
    if (b.caption) text(`touch-${b.id}-caption`, b.caption, b.x, b.y + b.r + .008, 10, 'rgba(240,248,237,0.75)', 'center');
  }
}
