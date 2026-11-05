// Player-facing text. The Korean source string is the key; each other language is one table of
// whole sentences or templates with {name} placeholders. A key missing from a table shows the Korean.
// Locale: ?lang=ko|en, else the browser language (ko* → Korean, anything else → English).
const param = typeof location === 'object' ? new URLSearchParams(location.search).get('lang') : null;
const browser = typeof navigator === 'object' ? String(navigator.language ?? '') : '';
export const lang = param === 'ko' || param === 'en' ? param : /^ko/i.test(browser) ? 'ko' : 'en';

const en = {
  // Page and title screen
  '함께 항해': 'Quiet Voyage',
  '함께-흐르는-바다': 'quiet-voyage',
  '함께 흐르는 바다': 'The Shared Sea',
  '바람이 이끄는 곳으로, 천천히': 'Slowly, wherever the wind leads',
  '화면을 눌러 출항하기': 'Tap to set sail',
  '아무 키나 눌러 출항하기': 'Press any key to set sail',
  '끝없는 바다, 섬과 고래와 다른 배들': 'An endless sea of islands, whales and boats',

  // Compass and weather
  '북': 'N', '북동': 'NE', '동': 'E', '남동': 'SE', '남': 'S', '남서': 'SW', '서': 'W', '북서': 'NW',
  '비': 'Rain', '돌풍': 'Gusts', '해무': 'Sea fog', '산들바람': 'Breeze', '무지개': 'Rainbow',
  '{v}노트': '{v} kn',
  '바람 {dir}에서': 'wind from {dir}',
  '{h}시간 {m}분': '{h}h {m}m',
  '{m}분 {s}초': '{m}m {s}s',

  // Photo mode
  '사진 모드 · ◀▶ 돌기 · ▲▼ 거리 · 저장 · 닫기': 'Photo · ◀▶ orbit · ▲▼ zoom · Save · Close',
  '사진 모드 · ← → 돌기 · ↑ ↓ 거리 · Space 저장 · C 나가기': 'Photo mode · ← → orbit · ↑ ↓ zoom · Space save · C exit',
  '사진을 저장했어요': 'Photo saved',

  // Field guide
  '바다 도감  {seen} / {total}': 'Sea Life  {seen} / {total}',
  '◆ {name}  ·  {n}번': '◆ {name}  ·  seen {n}×',
  '돌고래': 'Dolphin', '혹등고래': 'Humpback whale', '범고래': 'Orca', '바다거북': 'Sea turtle',
  '쥐가오리': 'Manta ray', '날치': 'Flying fish', '바닷새': 'Seabirds',
  '무리 지어 숨을 쉬며 물 위로 솟고, 움직이는 배의 뱃머리 물결을 즐겨 탄다.': 'Surfaces in pods and loves to ride a moving bow wave.',
  '멀리서 높은 숨 물보라로 먼저 보인다. 깊이 잠수할 때 꼬리를 들어 올리고, 가끔 통째로 솟구친다.': 'Its tall blow shows from afar. Tail up to dive; may breach.',
  '키 큰 등지느러미와 흰 눈무늬. 가족끼리 나란히 헤엄친다.': 'Tall dorsal fin, white eye patch. Families swim side by side.',
  '섬 가까운 얕은 바다에서 숨을 쉬러 잠깐 머리를 내민다.': 'Pokes its head up to breathe in the shallows near islands.',
  '넓은 날개로 날 듯 헤엄치다 갑자기 물 위로 뛰어올라 뒤집힌다.': 'Flies through the water on wide wings, then leaps and flips.',
  '긴 가슴지느러미를 펴고 수면 위를 수십 미터씩 미끄러진다.': 'Spreads long fins and glides for tens of metres over the sea.',
  '먹이가 있는 물 위를 맴돈다. 새가 모인 곳 아래를 살펴보자.': 'Circles over water with food. Look below where birds gather.',

  // Sightings
  '돌고래가 뱃머리 물결을 타고 있어요': 'Dolphins are riding your bow wave',
  '멀리서 혹등고래가 숨을 내뿜었어요': 'A humpback blew in the distance',
  '범고래가 짧게 숨을 쉬었어요': 'An orca took a quick breath',
  '혹등고래가 물 위로 솟구쳤어요': 'A humpback breached',
  '혹등고래가 물 위로 솟구쳤어요!': 'A humpback breached!',
  '꼬리지느러미를 들어 올리며 깊이 잠수해요': 'Flukes up — diving deep',
  '돌고래 무리가 물살을 가르며 지나가요': 'Dolphins slice through the water',
  '범고래 무리의 높은 등지느러미가 보여요': 'Tall orca fins break the surface',
  '혹등고래의 등이 물 위로 드러났어요': "A humpback's back rises from the water",
  '바다거북이 숨을 쉬러 올라왔어요': 'A sea turtle comes up for air',
  '쥐가오리가 물 위로 뛰어올랐어요': 'A manta ray leapt from the water',
  '날치 떼가 수면 위를 날아가요': 'Flying fish glide over the surface',
  '바닷새들이 맴돌고 있어요 — 아래에 무언가 있을지도': 'Seabirds circling — something lies below',

  // Logbook
  '항해 노트': 'Logbook',
  '노트 버튼으로 닫기': 'Tap Log to close',
  'J / ESC 닫기': 'J / Esc to close',
  '이번 항해': 'This voyage',
  '최고 {top}노트  ·  섬 {islands}곳  ·  생물 {species}종': 'Top {top} kn  ·  Islands {islands}  ·  Species {species}',
  '지금까지': 'All time',
  '{distance}  ·  {time}  ·  {n}번째 항해': '{distance}  ·  {time}  ·  voyage {n}',
  '만난 섬 {islands}곳  ·  만난 생물 {species}종': 'Islands {islands}  ·  Species {species}',
  '아직 기록된 순간이 없어요': 'Nothing logged yet',
  '지나온 섬과 만난 생물이 여기에 남아요.': 'Islands and creatures you meet appear here.',
  '처음 닿은 섬': 'New island',
  '다시 지나간 섬': 'Passed again',
  '{name} · 처음 보는 섬': '{name} · new island',
  '{text} · 처음 만난 생물': '{text} · first sighting',

  // Discoveries and weather notices
  '고요한 만': 'Quiet Cove',
  '두 곶이 감싼 얕은 물': 'Shallow water between two headlands',
  '바다 위의 노을': 'Sunset at Sea',
  '수평선이 붉게 물들었어요': 'The horizon has turned red',
  '별이 뜬 밤바다': 'A Starlit Sea',
  '물결이 푸르게 빛나요': 'The waves are glowing blue',
  '비가 그친 뒤 하늘에 걸렸어요': 'Hanging in the sky after the rain',
  '빗방울이 떨어지기 시작해요': 'Rain is starting to fall',
  '바람이 거세져요 — 돛이 팽팽해요': 'The wind is rising — sails taut',
  '옅은 해무가 내려앉아요': 'A light sea fog settles in',
  '안개의 끝': 'Edge of the Fog',
  '이 너머는 아직 지도에 없는 바다예요': 'Beyond here, the sea is uncharted',

  // Home islands
  '첫 바람섬': 'First Wind Isle',
  '긴 등섬': 'Longback Isle',
  '높은 숲섬': 'Highwood Isle',

  // Hints, company and keys
  '▲  바람을 타고 나아가기': '▲  Sail with the wind',
  'W / ↑  바람을 타고 나아가기': 'W / ↑  Sail with the wind',
  '◀ ▶  천천히 방향 바꾸기': '◀ ▶  Turn gently',
  'A D / ← →  천천히 방향 바꾸기': 'A D / ← →  Turn gently',
  '빛  버튼으로 인사하기': 'Tap Glow to say hello',
  'E  빛으로 인사하기': 'E  Say hello with light',
  '동행 연습 · 로컬 배 1척': 'Practice · 1 local boat',
  '같은 바다 · 근처 배 {n}척': 'Shared sea · boats nearby: {n}',
  '혼자 흐르는 바다': 'Sailing alone',
  'E  빛물결    R  빛의 흔적': 'E  Light ripple    R  Light trail',
  '동행 연습 마치기': 'End practice',
  '동행 연습': 'Practice together',
  '근처 배 {n}척': 'Boats nearby: {n}',
  '같은 바람을 타고 있어요': 'Sailing the same wind',
  '나란히 흐르는 중': 'Drifting side by side',
  'J 노트   K 도감   B 편지   C 사진': 'J Log   K Guide   B Bottle   C Photo',
  '   P 성능   G 그래픽': '   P Perf   G Graphics',

  // Touch buttons (labels sit inside a ~44 px circle: keep them short)
  '돌기': 'orbit', '왼쪽': 'left', '오른쪽': 'right', '가까이': 'closer', '빠르게': 'faster', '멀리': 'farther', '천천히': 'slower',
  '저장': 'Save', '닫기': 'Close', '노트': 'Log', '도감': 'Guide', '빛': 'Glow', '흔적': 'Trail', '편지': 'Bottle', '사진': 'Photo', '동행': 'Duo',

  // Light ripples and trails
  '빛이 다시 모일 때까지 잠시 기다려요': 'Wait a moment for the light to gather',
  '지나온 물길에 빛을 남겼어요': 'You left light in your wake',
  '물결에 작은 빛을 실었어요': 'You sent a little light across the water',
  '누군가 남긴 빛이 피어났어요': 'Light someone left has bloomed',
  '남겨 둔 빛에 다른 물결이 닿았어요': 'Another boat reached the light you left',
  '잠시 같은 바람을 타고 있어요': 'Sharing the same wind for a while',

  // Bottles: PHRASES travel as indices 0–7, only their display is translated
  '병에 담을 말 고르기 · 숫자 키 · B 닫기': 'Choose a message · number keys · B close',
  '좋은 바람이 함께하길': 'Fair winds to you',
  '여기 노을이 정말 아름다워요': 'The sunset here is lovely',
  '고래를 봤어요! 근처에 있어요': "Saw a whale! It's close by",
  '잠깐 쉬어 가도 괜찮아요': "It's okay to rest a while",
  '오늘도 무사히 항해하길': 'Safe sailing today',
  '밤바다의 별을 꼭 보세요': "Don't miss the stars at night",
  '이 섬 근처 물이 맑아요': "The water's clear by this island",
  '언젠가 바다에서 만나요': 'See you out at sea someday',
  '돌고래는 배를 따라올 때 가장 즐거워 보인다.': 'Dolphins look happiest following a boat.',
  '바닷새가 모이면 그 아래를 보라.': 'Where seabirds gather, look beneath.',
  '등대 불빛은 길 잃은 배를 위해 돈다.': 'The lighthouse turns for lost boats.',
  '고래의 숨은 멀리서 먼저 보인다.': "A whale's breath shows before the whale.",
  '비가 그치면 해를 등지고 하늘을 보라.': 'After rain, turn from the sun and look up.',
  '안개 너머엔 아직 아무도 가 보지 않았다.': 'No one has been past the fog yet.',
  '밤의 물결은 푸르게 빛난다.': 'At night the waves glow blue.',
  '거북은 섬 가까이에서 숨을 쉰다.': 'Turtles breathe close to the islands.',
  '바람을 등지면 가장 빠르다.': "You're fastest with the wind behind you.",
  '쥐가오리는 이유 없이 뛰어오른다.': 'Mantas leap for no reason at all.',
  '천천히 가도 바다는 기다려 준다.': 'Go slowly. The sea will wait.',
  '모래톱 위엔 새들이 쉰다.': 'Birds rest on the sandbars.',
  '화산섬 꼭대기는 늘 구름을 쓴다.': 'Volcanic peaks always wear a cloud.',
  '같은 바람을 타는 배는 외롭지 않다.': 'No boat on the same wind is alone.',
  '날치는 배가 다가오면 날아오른다.': 'Flying fish take off as a boat draws near.',
  '이 병을 찾은 당신에게, 좋은 항해를.': 'To whoever finds this: fair sailing.',
  '병을 띄웠어요 — 누군가 찾게 될 거예요': 'Bottle set adrift — someone will find it',
  '온라인일 때 띄운 병만 다른 항해자에게 닿아요': 'Only bottles sent online reach other sailors',
  '오래된 병': 'Old bottle',
  '이름 없는 배': 'Unnamed boat',
  '병 편지 · {from}': 'Bottle · {from}',

  // Developer panels
  '성능 시험 · 로컬 봇 (서버 부하 제외)': 'Performance test · local bots (no server load)',
  '1: 0척   2: 16척   3: 64척   4: 128척   L: 최적화 전환': '1: 0 boats   2: 16   3: 64   4: 128   L: toggle optimizations',
  'B: 시험 항로에서 비교 측정   O: 결과 저장   P: 닫기': 'B: benchmark on test route   O: save results   P: close',
  '컬링 + LOD': 'culling + LOD', '기준 모드': 'baseline',
  '{mode} · 봇 {count} · 시야 후보 {candidates} · 저상세 {low}': '{mode} · bots {count} · in view {candidates} · low detail {low}',
  '그리기 {calls}회 · 삼각형 {triangles}개': 'draw calls {calls} · triangles {triangles}',
  '동기식 처리 중앙값(ms) · 기준 → 최적화 · FPS 아님': 'Median sync frame time (ms) · baseline → optimized · not FPS',
  '{bots}척: {a} → {b} ms   /   그리기 {c} → {d}회': '{bots} boats: {a} → {b} ms   /   draw calls {c} → {d}',
  '그래픽 현황  ·  G 닫기': 'Graphics  ·  G close',
  '렌더 FPS {fps} · 해상도 배율 {dpr}': 'Render FPS {fps} · pixel ratio {dpr}',
  '프레임 측정 대기 / 일시정지': 'Waiting for frames / paused',
  '간격 {mean} ms / P95 {p95}': 'Interval {mean} ms / P95 {p95}',
  '그리기 {calls} · 삼각형 {triangles}': 'Draw calls {calls} · triangles {triangles}',
  '지오메트리 {g} · 텍스처 {t} · 셰이더 {p}': 'Geometries {g} · textures {t} · shaders {p}',
  '섬 {loaded} (대기 {queued}) · 생물 그룹 {groups} / 보임 {visible}': 'Islands {loaded} (queued {queued}) · life {groups} / visible {visible}',
  '시야 제외: 나무 {trees} · 바다 {water}': 'Culled: trees {trees} · water {water}',
  '위치 {x}, {z} · 시계 {clock}s': 'Position {x}, {z} · clock {clock}s',
  '네트워크: {net} · 근처 배 {peers}': 'Network: {net} · boats nearby {peers}',
  '배 모델 로딩 중이거나 온라인 접속 중입니다. 로컬에서 실행해 주세요.': 'The boat model is still loading, or you are online. Run it locally.',
  '측정 완료': 'Done',
  '최적화': 'optimized', '기준': 'baseline',
  '{i}/{n} · 봇 {bots} · {mode} · 반복 {repeat}': '{i}/{n} · bots {bots} · {mode} · run {repeat}',
  '로컬 봇 성능 측정 중 · 완료 후 항해로 돌아갑니다': 'Benchmarking local bots · the voyage resumes when done',
  '측정용 시계를 시작하지 못했습니다.': 'Could not start the benchmark clock.',
  'WebGL 컨텍스트가 중단되었습니다.': 'The WebGL context was lost.',
};

const TABLES = { en };

/** The text for Korean source `ko` in the current language, with {name} filled from `vars`. */
export function t(ko, vars) {
  const text = TABLES[lang]?.[ko] ?? ko;
  return vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : text;
}
