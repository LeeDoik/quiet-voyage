// Message bottles. Old ones drift where world-gen.js put them, carrying a line of sea lore; on
// the web build players also float their own, chosen from preset phrases (no free text, so
// there is nothing to moderate) and the server keeps them for others to find. Sail within a
// few metres to read one. One instanced mesh draws every bottle in range.
import * as THREE from 'three';
import { bakeTexture } from './materials.js';
import { bottlesNear } from './world-gen.js';
import { surface } from './sea.js';
import { platform } from './platform.js';
import { sfx } from './audio.js';
import { t } from './i18n.js';

// The server only accepts an index below PHRASES.length (server/src/worker.js BOTTLE_PHRASES).
export const PHRASES = [
  '좋은 바람이 함께하길', '여기 노을이 정말 아름다워요', '고래를 봤어요! 근처에 있어요', '잠깐 쉬어 가도 괜찮아요',
  '오늘도 무사히 항해하길', '밤바다의 별을 꼭 보세요', '이 섬 근처 물이 맑아요', '언젠가 바다에서 만나요',
];
const LORE = [
  '돌고래는 배를 따라올 때 가장 즐거워 보인다.', '바닷새가 모이면 그 아래를 보라.', '등대 불빛은 길 잃은 배를 위해 돈다.',
  '고래의 숨은 멀리서 먼저 보인다.', '비가 그치면 해를 등지고 하늘을 보라.', '안개 너머엔 아직 아무도 가 보지 않았다.',
  '밤의 물결은 푸르게 빛난다.', '거북은 섬 가까이에서 숨을 쉰다.', '바람을 등지면 가장 빠르다.',
  '쥐가오리는 이유 없이 뛰어오른다.', '천천히 가도 바다는 기다려 준다.', '모래톱 위엔 새들이 쉰다.',
  '화산섬 꼭대기는 늘 구름을 쓴다.', '같은 바람을 타는 배는 외롭지 않다.', '날치는 배가 다가오면 날아오른다.', '이 병을 찾은 당신에게, 좋은 항해를.',
];
const PICK_RANGE = 8, SHOW_RANGE = 900, CAP = 48;

function bottleGeometry() {
  const profile = [[0, -.32], [.11, -.32], [.12, -.28], [.12, .06], [.07, .16], [.04, .22], [.04, .3], [.045, .34], [0, .34]].map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(profile, 10).rotateZ(Math.PI / 2);
  const p = g.attributes.position, colors = [];
  for (let i = 0; i < p.count; i++) colors.push(...(p.getX(i) < -.29 ? [.55, .38, .22] : [.45, .68, .55]));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return g;
}

export function createBottles(scene, { drop }) {
  const mesh = new THREE.InstancedMesh(bottleGeometry(), new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: .15, metalness: .1, transparent: true, opacity: .85,
    map: bakeTexture({ kind: 'metal', seed: 5, palette: [0xf2f6f2, 0xe2ebe4, 0xffffff], size: 128 }).map,
  }), CAP);
  mesh.count = 0; mesh.frustumCulled = false; mesh.userData.tag = 'bottle'; scene.add(mesh);
  const found = new Set(JSON.parse(platform.read('sea.bottles') || '[]'));
  const near = [], events = [], m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  let picker = false, previous = new Set();
  const save = () => platform.persist && platform.write('sea.bottles', JSON.stringify([...found].slice(-500)));
  return {
    update(dt, input, boat, time, net, playing) {
      const pressed = code => input.keys.has(code) && !previous.has(code);
      if (playing && pressed('KeyB')) picker = !picker;
      if (picker && pressed('Escape')) picker = false;
      if (picker) for (let i = 0; i < PHRASES.length; i++) if (pressed(`Digit${i + 1}`)) {
        picker = false;
        const floated = drop(i);
        if (floated) sfx.cork();
        events.push({ kind: 'notice', text: t(floated ? '병을 띄웠어요 — 누군가 찾게 될 거예요' : '온라인일 때 띄운 병만 다른 항해자에게 닿아요') });
      }
      previous = new Set(input.keys);
      const list = bottlesNear(boat.x, boat.z, SHOW_RANGE, near).map(b => ({ id: b.id, x: b.x, z: b.z, text: t(LORE[b.line % LORE.length]), from: t('오래된 병') }));
      for (const b of net) if (Math.hypot(b.x - boat.x, b.z - boat.z) < SHOW_RANGE) list.push({ id: b.id, x: b.x, z: b.z, text: t(PHRASES[b.p] ?? ''), from: t(b.name || '이름 없는 배') });
      mesh.count = 0;
      for (const b of list) {
        if (found.has(b.id) || mesh.count >= CAP) continue;
        const d = Math.hypot(b.x - boat.x, b.z - boat.z);
        if (playing && d < PICK_RANGE) {
          found.add(b.id); save(); sfx.paper();
          events.push({ kind: 'bottle', title: t('병 편지 · {from}', { from: b.from }), text: `“${b.text}”` });
          continue;
        }
        const phase = (b.x * 13 + b.z * 7) % 6.283;
        e.set(Math.sin(time * 1.3 + phase) * .25, phase + time * .05, Math.sin(time * .9 + phase) * .2);
        p.set(b.x, surface(b.x, b.z, time) + .05, b.z);
        mesh.setMatrixAt(mesh.count++, m.compose(p, q.setFromEuler(e), one));
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
    drain: () => events.splice(0),
    reset() { picker = false; previous = new Set(); events.length = 0; },
    state: () => ({ picker, phrases: picker ? PHRASES : null, visible: mesh.count }),
  };
}
