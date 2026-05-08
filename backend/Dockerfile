# syntax=docker/dockerfile:1.7
# Multi-stage build for any service in backend/services/*.
# Pass SERVICE as a build-arg, e.g.:
#   docker build --build-arg SERVICE=user -f backend/Dockerfile .
# Build context must be the REPO ROOT (one level above backend/) so root-level
# packages/ resolves alongside backend/packages/ and backend/services/.

ARG NODE_VERSION=20

# ---------- Stage 1: install deps + build ----------
FROM node:${NODE_VERSION}-alpine AS builder
ARG SERVICE
WORKDIR /repo
RUN apk add --no-cache libc6-compat \
    && npm install -g npm@10.9.3

# Copy entire repo (.dockerignore trims node_modules / dist / .git / etc)
COPY package.json package-lock.json ./
COPY packages/ ./packages/
COPY backend/package.json backend/turbo.json backend/tsconfig.base.json ./backend/
COPY backend/packages/ ./backend/packages/
COPY backend/services/ ./backend/services/

RUN npm ci --no-audit --no-fund

# @bitcrm/types lives at the repo root (outside backend's turbo workspace), so build it first
WORKDIR /repo/packages/types
RUN npm run build

# Now turbo can resolve @bitcrm/types and build shared -> service in order
WORKDIR /repo/backend
RUN npx turbo run build --filter=${SERVICE}-service

# ---------- Stage 2: minimal runtime ----------
FROM node:${NODE_VERSION}-alpine AS runner
ARG SERVICE
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app

# Copy entire built monorepo so workspace symlinks resolve at runtime
COPY --from=builder --chown=app:app /repo/ ./

USER app
WORKDIR /app/backend/services/${SERVICE}

# All 4 services listen on 4001-4004; ECS task def picks the right port via PORT env
EXPOSE 4001 4002 4003 4004

CMD ["node", "dist/main.js"]
