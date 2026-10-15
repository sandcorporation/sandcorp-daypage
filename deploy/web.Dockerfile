# 프론트엔드를 빌드해 Caddy 이미지에 담는다. 빌드 컨텍스트는 저장소 루트.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /src
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm build

FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/dist /srv
