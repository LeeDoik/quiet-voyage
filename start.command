#!/bin/zsh -l
# 더블클릭: 개발 서버(게임 + 멀티플레이)를 띄우고 브라우저에서 게임을 연다.
# 끄려면 이 터미널 창에서 Ctrl+C 를 누르거나 창을 닫는다.
cd "${0:A:h}" || exit 1
URL=http://localhost:8787/

# 이미 떠 있으면 브라우저만 연다.
if curl -fs -o /dev/null "$URL"; then open "$URL"; exit 0; fi

[ -d node_modules ] || npm install || exit 1

# 서버가 응답하면 브라우저를 연다(최대 30초 대기).
( for i in {1..60}; do
    curl -fs -o /dev/null "$URL" && { open "$URL"; exit 0; }
    sleep 0.5
  done
  echo "서버가 30초 안에 뜨지 않았습니다. 위의 로그를 확인하세요." ) &

exec npm run dev
