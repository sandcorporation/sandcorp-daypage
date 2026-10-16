#!/bin/sh
# 새 프론트 빌드(/dist)를 Caddy가 보여 주는 /srv(web_static 볼륨)에 끊김 없이 넣는다.
# - assets/의 파일 이름에는 내용 해시가 붙어 있어 새 파일을 더해도 옛 페이지는 옛 파일을 계속 받는다.
# - index.html은 맨 마지막에 임시 이름으로 복사한 뒤 rename으로 한 번에 바꾼다.
#   그 순간부터 새로 여는 사람이 새 빌드를 받는다.
# - 일주일 넘게 쓰이지 않은 옛 assets는 지운다(열어 둔 옛 탭이 있을 수 있어 바로 지우지 않는다).
set -eu

mkdir -p /srv/assets
cp -R /dist/assets/. /srv/assets/
for f in /dist/*; do
  name=$(basename "$f")
  [ "$name" = "assets" ] || [ "$name" = "index.html" ] && continue
  cp -R "$f" "/srv/$name"
done
cp /dist/index.html /srv/.index.html.new
mv -f /srv/.index.html.new /srv/index.html
# 이번 빌드의 assets는 시각을 새로 찍어 정리 대상에서 빠지게 한다.
for f in /dist/assets/*; do touch "/srv/assets/$(basename "$f")"; done
find /srv/assets -type f -mtime +7 -delete
# Caddy 설정도 볼륨으로 넘긴다(호스트 경로를 연결하지 않는다: Jenkins가 컨테이너 안에서 돌면 그 경로가 호스트에 없다).
if [ -d /caddy-etc ]; then
  cp /Caddyfile /caddy-etc/.Caddyfile.new
  mv -f /caddy-etc/.Caddyfile.new /caddy-etc/Caddyfile
fi
echo "정적 파일 반영: $(ls /dist/assets | wc -l)개 assets, index.html 교체"
