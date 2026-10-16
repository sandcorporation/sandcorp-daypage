# 프론트엔드 빌드 결과(dist)를 담은 이미지. 빌드 컨텍스트는 저장소 루트.
# Caddy(web)는 이 이미지가 아니라 공식 caddy 이미지로 계속 떠 있고, 배포 때 이 이미지로
# 정적 파일은 web_static, Caddy 설정은 caddy_etc 볼륨에 넣는다(deploy/publish-static.sh). 그래서 프론트가 바뀌어도
# Caddy를 내리지 않는다(무중단).
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /src
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm build

FROM alpine:3.22
COPY --from=build /src/dist /dist
COPY deploy/publish-static.sh /publish-static.sh
COPY deploy/Caddyfile /Caddyfile
CMD ["sh", "/publish-static.sh"]
