// The voyage log: distance and time under way, the islands and creatures met, and the short
// notices the screen shows when something is found. This voyage resets with the game; the
// lifetime totals are kept in this browser on the web build only.
import { platform } from './platform.js';
import { t } from './i18n.js';

const KEY = 'sea.log.v1';
// Field guide entries, in the order the guide lists them.
export const GUIDE = ([
  ['dolphin', '돌고래', '무리 지어 숨을 쉬며 물 위로 솟고, 움직이는 배의 뱃머리 물결을 즐겨 탄다.'],
  ['humpback', '혹등고래', '멀리서 높은 숨 물보라로 먼저 보인다. 깊이 잠수할 때 꼬리를 들어 올리고, 가끔 통째로 솟구친다.'],
  ['orca', '범고래', '키 큰 등지느러미와 흰 눈무늬. 가족끼리 나란히 헤엄친다.'],
  ['turtle', '바다거북', '섬 가까운 얕은 바다에서 숨을 쉬러 잠깐 머리를 내민다.'],
  ['manta', '쥐가오리', '넓은 날개로 날 듯 헤엄치다 갑자기 물 위로 뛰어올라 뒤집힌다.'],
  ['flyingfish', '날치', '긴 가슴지느러미를 펴고 수면 위를 수십 미터씩 미끄러진다.'],
  ['gull', '바닷새', '먹이가 있는 물 위를 맴돈다. 새가 모인 곳 아래를 살펴보자.'],
]).map(([key, name, about]) => [key, t(name), t(about)]);

function loadTotals() {
  if (!platform.persist) return { distance: 0, time: 0, voyages: 0, islands: [], species: {} };
  try {
    const t = JSON.parse(platform.read(KEY) || '{}');
    return { distance: +t.distance || 0, time: +t.time || 0, voyages: +t.voyages || 0, islands: Array.isArray(t.islands) ? t.islands.slice(-400) : [], species: t.species && typeof t.species === 'object' ? t.species : {} };
  } catch { return { distance: 0, time: 0, voyages: 0, islands: [], species: {} }; }
}

export function createLogbook() {
  const totals = loadTotals();
  let voyage, notice = null, noticeTime = 0, saveClock = 0, started = false;
  function reset() {
    voyage = { distance: 0, time: 0, top: 0, last: null, entries: [], islands: new Set(), species: {} };
    notice = null; noticeTime = 0; started = false;
  }
  function save() { if (platform.persist) platform.write(KEY, JSON.stringify(totals)); }
  function say(text, seconds = 5) { notice = text; noticeTime = seconds; }
  function record(entry) { voyage.entries.push({ ...entry, at: voyage.time }); if (voyage.entries.length > 60) voyage.entries.shift(); }
  reset();
  return {
    reset,
    /** Called every playing frame with the boat state. */
    update(dt, boat, playing) {
      if (notice) { noticeTime -= dt; if (noticeTime <= 0) notice = null; }
      if (!playing) return;
      if (!started) { started = true; totals.voyages++; }
      voyage.time += dt; totals.time += dt;
      if (voyage.last) {
        const step = Math.hypot(boat.x - voyage.last.x, boat.z - voyage.last.z);
        if (step < 60) { voyage.distance += step; totals.distance += step; }
      }
      voyage.last = { x: boat.x, z: boat.z };
      voyage.top = Math.max(voyage.top, boat.speed);
      saveClock += dt; if (saveClock > 10) { saveClock = 0; save(); }
    },
    island(s) {
      if (voyage.islands.has(s.id)) return;
      voyage.islands.add(s.id);
      const first = !totals.islands.includes(s.id);
      if (first) { totals.islands.push(s.id); save(); }
      record({ kind: 'island', title: s.name, description: t(first ? '처음 닿은 섬' : '다시 지나간 섬') });
      say(first ? t('{name} · 처음 보는 섬', { name: s.name }) : s.name, 4.5);
    },
    creature(n) {
      const count = (voyage.species[n.species] || 0) + 1;
      voyage.species[n.species] = count;
      const ever = totals.species[n.species] || 0;
      totals.species[n.species] = ever + 1;
      if (count === 1) record({ kind: 'creature', title: n.name, description: ever ? n.text : t('{text} · 처음 만난 생물', { text: n.text }) });
      say(n.text, 5);
      save();
    },
    moment(title, description = '') { record({ kind: 'moment', title, description }); say(title, 4); },
    say,
    save,
    state() {
      return {
        notice,
        voyage: { distance: voyage.distance, time: voyage.time, top: voyage.top, islands: voyage.islands.size, species: Object.keys(voyage.species).length, entries: voyage.entries.slice(-6) },
        guide: GUIDE.map(([key, name, about]) => ({ key, name, about, seen: (platform.persist ? totals.species[key] : voyage.species[key]) || 0 })),
        totals: platform.persist ? { distance: totals.distance, time: totals.time, voyages: totals.voyages, islands: totals.islands.length, species: Object.keys(totals.species).length } : null,
      };
    },
  };
}
