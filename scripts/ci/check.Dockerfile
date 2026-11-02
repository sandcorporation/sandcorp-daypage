# syntax=docker/dockerfile:1
# 배포 전·PR 검사 이미지(scripts/ci/check.sh가 굽고 지운다). 운영 이미지가 아니다.
# 빌드 노드(macos·home)의 네이티브 아키텍처로 굽는다 — QEMU를 쓰지 않는다. 의존성 층은 노드의 로컬 캐시에 남는다.
FROM node:22-bookworm-slim AS node

FROM python:3.14-slim
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
# pnpm 버전은 package.json의 packageManager(pnpm@10.33.0)와 맞춘다.
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && npm install -g pnpm@10.33.0
COPY --from=ghcr.io/astral-sh/uv:0.9 /uv /usr/local/bin/uv
ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock backend/.python-version ./
RUN uv sync --frozen --no-install-project

WORKDIR /app/frontend
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

WORKDIR /app/admin
COPY admin/package.json admin/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

WORKDIR /app
COPY . .
RUN cd backend && uv sync --frozen
