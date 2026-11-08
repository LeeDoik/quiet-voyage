# 함께 흐르는 바다 (Quiet Voyage)

끝없는 바다를 항해하며 섬과 고래를 만나는 웹 게임입니다. 여러 사람이 같은 바다에 접속할 수 있습니다. 게임은 빌드 과정이 없는 정적 파일(`public/`)이고, 서버는 Cloudflare Worker와 Durable Objects(`server/worker.js`)입니다. 둘을 한 번에 배포합니다.

게임의 모든 정보(디자인 원칙, 세계, 생물, 함께하기, 그래픽, 변경 기록, 할 일)는 [docs/GAME.md](docs/GAME.md)에 모아 두었습니다.

## 실행과 배포

Finder에서 `start.command`를 더블클릭하면 개발 서버를 띄우고 브라우저에서 게임을 엽니다(처음이면 `npm install`도 합니다). 끄려면 그 터미널 창에서 Ctrl+C를 누릅니다.

```bash
npm install          # wrangler (처음 한 번)
npm run dev          # http://localhost:8787 — 게임 + 멀티플레이 서버
npm test             # 결정론적 항해·바람·동행 테스트
npx wrangler login   # 처음 한 번
npm run deploy:staging  # 테스트용 Worker(quiet-voyage-staging)에 배포
npm run bots         # staging에 디버그 배(내 배를 찾아 따라다님, 기본 48척·10분)
npm run deploy       # Cloudflare에 배포(프로덕션)
```

배포한 뒤 Cloudflare 대시보드 → Workers & Pages → `quiet-voyage` → Settings → Domains에서 내 도메인을 연결합니다.

직접 쓴 병 편지는 서버가 TypeSafe AI의 Jev로 욕설·비방·연락처를 검사한 뒤에만 띄웁니다(`server/moderate.js`). 키는 브라우저에 보내지 않고 Worker 비밀 값으로만 둡니다. 키가 없으면 직접 쓴 편지는 띄우지 않고(정해진 문구는 그대로), 검사에 실패해도 띄우지 않습니다.

```bash
# 로컬: .dev.vars (git에 올라가지 않음)에 한 줄
TYPESAFE_API_KEY=...
# 배포: 환경마다 한 번 등록
npx wrangler secret put TYPESAFE_API_KEY
npx wrangler secret put TYPESAFE_API_KEY --env staging
```

- 서버를 다른 주소에 둘 때는 `public/index.html`의 `<meta name="sea-server">`에 `wss://.../ws`를 넣습니다. 비워 두면 같은 주소의 `/ws`를 쓰고, `off`로 두면 멀티플레이가 꺼집니다.
- 개발자 화면(G 그래픽, P 성능, `window.__sea`)은 localhost에서, 또는 `?dev=<키>`로 연 브라우저에서만 보입니다. 키는 `.dev-key` 파일에 있고 git에서 제외됩니다. `?dev=off`로 끕니다. 키를 바꾸려면 새 키의 해시를 `sea-dev-hash`에 넣습니다:

```bash
node -e "const k=require('crypto').randomBytes(12).toString('hex');require('fs').writeFileSync('.dev-key',k);console.log(k, require('crypto').createHash('sha256').update(k).digest('hex'))"
```

## 조작

W/↑ 빠르게, S/↓ 천천히, A·D/←·→ 방향, J 항해 노트, K 바다 도감, B 병 편지(숫자로 문구 선택, 9 직접 쓰기), C 사진 모드(Space로 저장), E 빛물결, T 자동 항해(방향·속도 키를 누르면 해제), F 전체화면(오른쪽 위 버튼도 같음), 마우스 휠 카메라 줌, H 동행 연습(오프라인), M 소리 끄기·켜기, O 환경설정(소리 종류별 음량). 처음 들어오면 상황에 맞춰 한 줄씩 안내가 나옵니다(튜토리얼). 휴대폰은 화면 버튼으로 조작합니다(`public/src/touch.js`).

## 구조

| 파일 | 역할 |
|---|---|
| `public/src/main.js` | 수명 주기와 연결 |
| `public/src/studio.js`, `hud.js` | 게임 루프, 입력, 캔버스 HUD 엔진(`window.__studio`) |
| `public/src/world.js` | 하늘, 낮밤, 날씨, 바다, 발견 |
| `public/src/world-gen.js` | 청크 단위 결정론적 섬·생물·병 생성 |
| `public/src/islands.js`, `marine-life.js`, `bottles.js` | 스트리밍 섬, 해양 생물, 병 편지 |
| `public/src/sailing.js`, `sea.js` | 배, 바람, 파도, 항적, 충돌 |
| `public/src/boat-float.js`, `wake.js`, `wind-rig.js` | 물에 뜨는 방식(스프링 부력, 바람에 기울기), 항적 리본, 마스트·포스테이에 걸려 바람에 부푸는 돛과 붐·메인시트. 내 배와 다른 배가 함께 쓴다 |
| `tools/blender/boat.py` → `public/assets/blender/boat/boat.glb` | 배 모델(선체, 조종석, 리깅, 러더, 돛, 텍스처). 고친 뒤 `npm run boat` |
| `public/src/ocean-material.js`, `wave-field.js` | 바다 셰이더(너울, 잔물결, 반사, 선체 주변 물결), CPU와 같은 너울 식 |
| `public/src/sky.js`, `motes.js` | 하늘 돔과 바다 반사가 함께 쓰는 하늘(노을, 구름, 은하수, 별똥별, 오로라), 밤 수면 위의 빛 입자 |
| `public/src/lantern.js` | 배마다 선미 등불(밤에 켜짐, 내 배만 실제 조명 1개) |
| `public/src/audio.js` | 합성한 소리 전부(마스터·리미터, 바다·배·생물·행동 소리, M으로 끄기) |
| `public/src/dolphin-ride.js` | 돌고래가 뱃머리 물결을 타고 놓아주는 규칙 |
| `public/src/interface.js`, `touch.js`, `logbook.js` | HUD, 터치 조작, 항해 기록 |
| `public/assets/fonts/`, `tools/fonts.mjs` | HUD 글꼴 서브셋(OFL)과 그것을 다시 만드는 도구. 게임 글자가 바뀌면 `node tools/fonts.mjs` |
| `public/src/social.js`, `net/sea-net.js` | 멀티플레이 클라이언트(배가 서서히 나타나고 사라짐, 늦은 스냅샷 이어 그리기) |
| `public/src/far-sails.js` | 800 m 밖 다른 배를 수평선의 먼 등불로 |
| `public/src/quality.js` | 품질 단계(high/medium/low, `?quality=`) |
| `public/src/terrain-material.js`, `assets/textures/terrain/` | 섬과 만의 사진 텍스처 지형(CC0, Poly Haven) |
| `public/src/reflection.js` | 섬과 배가 비치는 물 반사(high) |
| `server/worker.js` | 정적 파일 + `/ws` → 셀 Durable Object |
| `tools/sea-bots.mjs` | 디버그 배: 내 배를 찾아 주변을 따라다님(`npm run bots`, staging 전용) |
| `public/vendor/` | three.js 0.185.1 (MIT) |

## 세계

- 지도는 반지름 30 km의 바다다. 가장자리에서는 안개가 짙어지고 배가 안쪽으로 미끄러진다.
- 홈 바다(반지름 약 950 m)는 손으로 만든 섬 3개와 만을 그대로 유지한다. 그 바깥은 800 m 청크마다 고정 시드로 섬과 해양 생물 무리를 생성한다(`public/src/world-gen.js`). 모든 플레이어가 같은 좌표에서 같은 섬을 본다.
- 섬 종류는 숲섬, 바위섬, 산호 모래섬, 화산섬, 모래톱이다. 섬마다 컨셉이 하나씩 있다(풍차, 어촌, 정자, 등대, 동백, 귤밭, 옛터, 천문대, 새, 바위 아치, 돌탑, 야자, 난파선, 화산; `island-concepts.js`, `island-decor.js`). 다가가면 이름과 컨셉이 뜨고, 근처에서 빛물결(E)을 보내면(다른 배가 보내도) 섬이 컨셉에 맞게 대답한다(불빛, 꽃잎, 새떼, 빛줄기, 불티 등). 지형 메시의 해안선은 충돌 모양과 같다(`public/src/islands.js`). 배 주변 1.9 km 안의 섬만 한 프레임에 하나씩 짓고, 2.4 km 밖으로 멀어지면 해제한다.
- 해양 생물(`public/src/marine-life.js`): 돌고래, 혹등고래, 범고래, 바다거북, 쥐가오리, 날치, 바닷새가 있다. 대부분 물속에 있어서 숨 물보라, 맴도는 새, 지느러미, 물튀김으로 찾게 된다. 돌고래는 움직이는 뱃머리 물결을 타러 다가온다. 혹등고래는 숨쉬기, 꼬리 들고 잠수하기, 가끔 솟구치기를 한다. 모델과 헤엄·날갯짓 애니메이션은 Blender 스크립트(`tools/blender/marine_life.py`)로 만든 `public/assets/blender/marine-life/marine-life.glb`이고(애니메이션은 정점별 푸리에 계수로 구워 셰이더가 재생), 못 불러오면 코드로 만든 모양을 쓴다. 고친 뒤 `npm run models`로 다시 만든다(미리보기 렌더는 `tools/blender/renders/`에 생긴다).
- 시간: 온라인에서는 서버 시계를 공유해서 낮과 노을, 고래가 숨 쉬는 순간이 모두에게 같다. 오프라인에서는 기기 시계를 쓴다.

- 공유 시계의 1시간이 하루다(매시 정각 해돋이, 15분 한낮, 30분 노을, 45분 한밤). 모든 플레이어가 같은 하늘을 본다. 노을에는 구름이 금빛으로 물들고, 밤에는 은하수와 별똥별, 가끔 오로라가 뜨며, 등대 불빛이 돌고 파도와 항적이 푸르게 빛난다.
- 날씨는 200초 단위로 바뀐다(맑음, 산들바람, 돌풍, 비, 해무). 돌풍과 비는 실제 바람 세기를 바꾸고(`sea.js`의 `env.gust`), 비가 그친 뒤에는 해를 등진 쪽에 무지개가 뜬다. 날씨도 서버 시계를 따른다.
- 항적은 배가 실제로 지나간 길을 따라 깔리는 리본 메시다(`sailing.js`). 켈빈 각(19.5°)으로 벌어지며 메시 하나로 그린다. 바다 셰이더는 잔물결 방향을 황금각으로 흩어 줄무늬를 없앴고, 픽셀보다 가는 옥타브와 먼 섬의 계산은 건너뛴다.
- 소리(`public/src/audio.js`)는 파일 없이 합성하고, 화면에 보이는 것에서만 난다. 음악은 없다. 낮은 너울, 겉보기 바람, 속도에 따라 커지는 뱃전 물소리, 배의 실제 흔들림을 따르는 찰랑임과 삐걱임, 맞바람에 떠는 돛, 비와 갑판의 빗방울, 해안 200 m 안의 파도 소리가 깔린다. 고래·갈매기·돌고래 소리는 카메라 기준으로 좌우가 나뉘고 멀수록 작고 어두워진다. M으로 끄고 켠다(이 브라우저에 기억).
- 병 편지(`public/src/bottles.js`): 바다 곳곳에 오래된 병이 떠 있다. 온라인에서는 정해진 문구 8개 중 하나를 고르거나 60자까지 직접 써서 병을 띄우면 서버가 셀마다 최대 100개를 30일 동안 보관한다. 직접 쓴 편지는 Jev 검사(`server/moderate.js`)를 통과해야 뜬다.

## 항해 노트

이번 항해의 거리, 시간, 최고 속도, 만난 섬과 생물이 기록된다. 웹 빌드에서는 '지금까지' 누적 기록이 이 브라우저(localStorage)에 남는다.


# 멀티플레이 서버

## 확장 구조

```
world (반경 30 km)
 └─ 2 km 셀 격자  (cx, cz ∈ −16…16)
     └─ 채널 1…64  →  Durable Object  "채널:cx:cz"
```

- **셀**: 바다를 2 km 정사각형으로 나눕니다. 배는 자기가 있는 셀에 자신을 게시(`own`)하고, 경계에서 850 m 안쪽의 이웃 셀은 구독(`watch`)만 합니다(시야 800 m보다 넓어서 경계 너머 배도 같은 거리에서 보입니다). 1000 m 넘게 멀어지면 구독을 닫습니다(히스테리시스). 구독한 셀에는 위치를 초당 2번만 보냅니다. 경계를 넘을 때는 재접속 없이 두 소켓의 역할만 바꿉니다. 한 플레이어가 여는 소켓은 최대 4개입니다.
- **채널**: 한 셀에 게시된 배가 200척이 되면 서버가 `full`을 보내고, 클라이언트는 모든 소켓을 다음 채널로 옮깁니다. 같은 채널끼리만 서로 보입니다. 그래서 한 Durable Object가 맡는 부하에 상한이 생깁니다.
- **관심 영역(AOI)**: 10 Hz 틱마다 200 m 공간 해시로 각 시청자 주변 800 m 안의 가장 가까운 48척만 골라 보냅니다. 스냅샷은 바이너리로 한 척당 17바이트, 48척이면 약 0.8 KB/틱입니다.
- **보간**: 클라이언트는 서버 시각을 추정해 150 ms 뒤의 위치를 보간해 그립니다. 스냅샷이 늦으면 마지막 움직임을 따라 최대 0.4초 이어 그립니다. 2초 동안 스냅샷에 나오지 않은 배는 흘러가며 흐려지다 사라집니다.
- **먼 등불**: 1초마다 시청자 800 m 밖의 게시된 배(가까운 순 32척)를 위치만 보냅니다(`[u8 3][u16 n]` + n × `[u32 id][f32 x][f32 z]`). 화면에는 가장 가까운 64척만 그립니다. 다른 배 위에 이름표는 띄우지 않습니다.
- **공유 시계**: `welcome`과 스냅샷에 실린 서버 시각으로 `social.clock()`이 모든 플레이어에게 같은 초를 돌려줍니다. 낮밤과 해양 생물 동기화에 씁니다.
- **휴면**: Hibernation WebSocket API를 씁니다. 셀에 게시된 배가 없으면(구독만 걸려 있어도) 틱이 멈추고 객체가 잠듭니다. 10초 동안 아무 메시지도 보내지 않은 소켓은 4408로 끊습니다(사라진 클라이언트가 멈춘 배로 남지 않게). 클라이언트는 게임이 다시 위치를 보낼 때 다시 붙습니다.

## 프로토콜

| 방향 | 형식 | 내용 |
|---|---|---|
| C→S | 텍스트 | `{t:'hello',id,name,own}` 처음 한 번, `{t:'mode',own}`, `{t:'quiet',p}` (1 KB 이하, 바뀔 때만) |
| C→S | 바이너리 14 B | `[u8 1][f32 x][f32 z][i16 y·100][u16 yaw][u8 speed·4]`, 최대 15 Hz |
| S→C | 텍스트 | `welcome {time,channel,cell}`, `info {id,name,quiet}` (처음 보일 때), `quiet {id,p}`, `leave {id}`, `full` |
| S→C | 바이너리 | `[u8 2][f64 서버ms][u16 n]` + n × `[u32 id][f32 x][f32 z][i16 y][u16 yaw][u8 speed]` |
| S→C | 바이너리 | 먼 배 `[u8 3][u16 n]` + n × `[u32 id][f32 x][f32 z]`, 1 Hz |

## 제한

- 소켓당 초당 메시지 30개를 넘으면 1008로 끊습니다.
- 이름에서 제어 문자를 지우고 16자로 자릅니다.
- 세계 반경을 벗어난 위치는 무시하고, 셀 경계 밖으로 300 m 넘게 나간 배는 게시하지 않습니다.
- 같은 셀에 이미 살아 있는 id로 다시 `hello`하면 4409로 거절합니다(클라이언트는 잠시 뒤 다시 시도).
- id는 클라이언트가 정하므로 다른 사람인 척하는 것을 막지는 못합니다. 계정이 필요해지면 Worker에서 서명한 토큰으로 id를 발급하는 단계를 추가하면 됩니다.

## 검증한 내용 (로컬 `wrangler dev`)

- 셀 경계 양쪽의 두 배가 서로 보이고, 한쪽이 경계를 넘을 때 소켓 역할만 바뀌며 연결이 유지됨
- 빛물결(quiet) 변경이 상대에게 전달됨
- 한 셀에 210척: 200척은 채널 1, 10척은 채널 2로 이동, 한 배가 받는 목록은 최대 48척
- 헤드리스 Chrome 두 창에서 실제 게임으로 접속해 상대 배와 이름표 확인


## 병 편지

`{t:'bottle', p}`의 p는 문구 번호 0–7, `{t:'bottle', text}`는 직접 쓴 60자 이하 편지(Jev 검사 통과 시)다. 세션당 30초에 한 번까지 허용하고, 셀(Durable Object)의 storage에 최대 100개를 30일간 보관한다. 접속 시 `{t:'bottles', list}`를 보내고, 새 병이 생기면 셀의 모든 소켓에 다시 보낸다. 병은 채널마다 따로 보관된다(shortcut: 채널 간 공유가 필요하면 셀 단위 저장 DO를 따로 둘 것).
