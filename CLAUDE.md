# quiet-voyage

배포용 웹 게임입니다. Genex 스튜디오에서 분리했습니다. 구조, 실행, 배포, 서버 프로토콜은 README.md에 있습니다.

- 빌드 단계는 없습니다. `public/`이 그대로 배포됩니다. three.js는 `public/vendor/`에 있고 import map으로 불러옵니다.
- UI는 모두 캔버스 HUD(`window.__studio.hud`, `public/src/hud.js`)로 그립니다. 입력은 `update()`의 `ctx.keys`로만 받고, 터치는 키 이벤트로 바꿉니다(`touch.js`).
- 섬, 생물, 날씨는 고정 시드와 공유 시계로 정해집니다. 그래서 모든 플레이어가 같은 바다를 봅니다. 시뮬레이션에서 `Math.random`을 쓰지 마세요.
- 변경 후에는 `npm test`를 실행하고, `npm run dev`에서 확인합니다.

## 작업 방식

- 대답과 진행 알림은 한국어로 합니다. 코드, 주석, 커밋 메시지는 영어로 씁니다.
- 브라우저 확인과 녹화는 ego lite(`ego-browser` CLI)로 합니다. 사용자가 보는 브라우저이므로 게임 소리를 반드시 끕니다. 페이지가 열리기 전에 `Page.addScriptToEvaluateOnNewDocument`로 AudioContext를 멈춘 상태로 고정합니다. 직접 띄우는 크롬에는 `--mute-audio`를 붙입니다.
- 커밋과 푸시는 사용자가 요청할 때만 합니다.

## Orca 작업트리

- Orca가 새 작업트리를 만들면 `orca.yaml`의 setup이 `tools/worktree-setup.sh`를 실행합니다. 이 스크립트는 `npm install`을 하고, gitignore된 `.dev.vars`(Jev 키)와 `.dev-key`를 메인 체크아웃에서 심볼릭 링크로 연결합니다. 손으로 다시 실행해도 됩니다.
- 새 작업트리는 로컬 `master`에서 갈라집니다. 커밋하지 않은 변경은 새 작업트리에 들어가지 않습니다.
- 개발 서버 기본 포트(8787)는 작업트리 하나만 쓸 수 있습니다. 다른 작업트리에서는 `npm run dev -- --port 8790`처럼 포트를 바꾸고, `orca ports --json`으로 확인합니다.
