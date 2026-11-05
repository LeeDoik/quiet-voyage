# quiet-voyage

배포용 웹 게임입니다. Genex 스튜디오에서 분리했습니다. 구조, 실행, 배포, 서버 프로토콜은 README.md에 있습니다.

- 빌드 단계는 없습니다. `public/`이 그대로 배포됩니다. three.js는 `public/vendor/`에 있고 import map으로 불러옵니다.
- UI는 모두 캔버스 HUD(`window.__studio.hud`, `public/src/hud.js`)로 그립니다. 입력은 `update()`의 `ctx.keys`로만 받고, 터치는 키 이벤트로 바꿉니다(`touch.js`).
- 섬, 생물, 날씨는 고정 시드와 공유 시계로 정해집니다. 그래서 모든 플레이어가 같은 바다를 봅니다. 시뮬레이션에서 `Math.random`을 쓰지 마세요.
- 변경 후에는 `npm test`를 실행하고, `npm run dev`에서 확인합니다.
