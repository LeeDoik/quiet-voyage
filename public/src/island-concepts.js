// What each island is about. Every island carries one concept, chosen from the kinds that suit its
// shape (a windmill wants a green hill, a wreck a beach) by a hash of its own seed, so every player
// sees the same island the same way and the world layout (world-gen.js's random sequence) is not
// disturbed. The concept names the island, decides what is built on it (island-decor.js) and gives
// the line a sailor reads on coming close, and how the island answers a light pulse (E) sent near it
// (`reply`; island-decor.js draws the answer). Pure data: node tests import it without three.js.
import { lang, t } from './i18n.js';

export const CONCEPTS = {
  lighthouse: { kinds: ['green', 'rock'], name: ['등대섬', 'Beacon Isle'], text: '붉은 띠 등대와 등대지기의 작은 집', reply: '등대가 불빛을 돌려 대답해요' },
  windmill: { kinds: ['green'], name: ['풍차섬', 'Windmill Isle'], text: '언덕 위 풍차들이 바람 따라 돌아요', reply: '풍차들이 힘차게 돌기 시작했어요' },
  village: { kinds: ['green'], name: ['마을섬', 'Harbour Isle'], text: '나무 부두와 굴뚝 연기가 있는 작은 어촌', reply: '마을에 불이 켜지고 굴뚝 연기가 피어올라요' },
  camellia: { kinds: ['green'], name: ['동백섬', 'Camellia Isle'], text: '붉은 동백꽃이 섬을 덮었어요', reply: '동백 꽃잎이 바람에 흩날려요' },
  pavilion: { kinds: ['green', 'volcano'], name: ['정자섬', 'Pavilion Isle'], text: '소나무 사이 언덕 위의 정자', reply: '정자에 등불이 켜지고 꽃잎이 날려요' },
  orchard: { kinds: ['green'], name: ['귤섬', 'Orchard Isle'], text: '검은 돌담 안에 귤이 익어 가요', reply: '귤밭 위로 주황빛이 반짝여요' },
  ruins: { kinds: ['green', 'rock'], name: ['옛터섬', 'Ruin Isle'], text: '무너진 돌기둥과 아치가 남은 옛터', reply: '돌기둥에 오래된 무늬가 빛나요' },
  observatory: { kinds: ['green'], name: ['별섬', 'Star Isle'], text: '꼭대기에 작은 천문대가 있어요', reply: '천문대에서 하늘로 빛줄기가 올라가요' },
  birds: { kinds: ['rock', 'sandbar'], name: ['새섬', 'Bird Rock'], text: '바닷새들이 둥지를 튼 하얀 바위', reply: '바닷새들이 한꺼번에 날아올라요' },
  arch: { kinds: ['rock'], name: ['구멍바위', 'Arch Rock'], text: '파도가 뚫어 놓은 바위 아치', reply: '바위 아치 사이로 빛이 고여요' },
  cairns: { kinds: ['rock', 'sandbar'], name: ['돌탑섬', 'Cairn Isle'], text: '누군가 하나씩 쌓아 올린 돌탑들', reply: '돌탑 꼭대기에 작은 불이 켜져요' },
  lagoon: { kinds: ['atoll'], name: ['야자섬', 'Palm Cay'], text: '야자수 그늘의 해먹과 하얀 모래', reply: '야자수 사이로 반딧불이 떠올라요' },
  wreck: { kinds: ['atoll', 'sandbar'], name: ['난파섬', 'Wreck Cay'], text: '모래에 얹힌 오래된 난파선', reply: '난파선에 등불이 켜지고 무언가 반짝여요' },
  volcano: { kinds: ['volcano'], name: ['불섬', 'Fire Isle'], text: '봉우리에서 연기가 피어오르는 화산', reply: '화산이 낮게 울리며 불티를 뿜어요' },
};

const BY_KIND = {};
for (const [id, c] of Object.entries(CONCEPTS)) for (const k of c.kinds) (BY_KIND[k] ??= []).push(id);
// Weights within a kind: the volcano is almost always a smoking volcano, the rest share evenly.
const WEIGHT = { volcano: { volcano: 5, pavilion: 1 }, atoll: { lagoon: 2, wreck: 1 } };

function hash(n) {
  let h = (Math.imul(n | 0, 0x9e3779b1) ^ 0x5bd1e995) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The concept of a generated island (from its kind and seed). */
export function conceptFor(s) {
  const list = BY_KIND[s.kind] ?? [];
  if (!list.length) return null;
  const weights = list.map(id => WEIGHT[s.kind]?.[id] ?? 1);
  let r = hash(s.seed) * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < list.length; i++) { r -= weights[i]; if (r <= 0) return list[i]; }
  return list[list.length - 1];
}

/** The island's name word for its concept, in the player's language. */
export const conceptName = id => (CONCEPTS[id] ? CONCEPTS[id].name[lang === 'ko' ? 0 : 1] : null);
/** The line shown and logged when a sailor comes close. */
export const conceptText = id => (CONCEPTS[id] ? t(CONCEPTS[id].text) : null);
/** What a sailor reads when the island answers their light pulse. */
export const conceptReply = id => (CONCEPTS[id]?.reply ? t(CONCEPTS[id].reply) : null);
