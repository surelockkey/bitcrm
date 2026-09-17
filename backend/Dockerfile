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
# puppeteer-core never downloads a browser, but be explicit so no transitive
# install script tries to.
ENV PUPPETEER_SKIP_DOWNLOAD=1
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

# @bitcrm/document-renderer (billing PDFs) is also a root package and imports
# @bitcrm/types, so it builds right after it.
WORKDIR /repo/packages/document-renderer
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

# billing-service renders PDFs with headless Chromium (puppeteer-core); no
# other service pays for the ~250 MB of browser + fonts.
RUN if [ "$SERVICE" = "billing" ]; then \
      apk add --no-cache chromium nss freetype harfbuzz ttf-freefont font-noto; \
    fi
ENV PUPPETEER_SKIP_DOWNLOAD=1
# Only billing reads this; harmless elsewhere (the path simply doesn't exist).
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Copy entire built monorepo so workspace symlinks resolve at runtime
COPY --from=builder --chown=app:app /repo/ ./

# npm workspaces hoist deps to multiple levels (/app/node_modules and
# /app/backend/node_modules). Merge them so dynamic require()s issued from
# packages at the root level (e.g. @nestjs/core requiring @nestjs/platform-express)
# can resolve deps that landed under backend/.
RUN apk add --no-cache --virtual .cp-deps coreutils \
    && cp -rn /app/backend/node_modules/. /app/node_modules/ \
    && apk del .cp-deps \
    && chown -R app:app /app/node_modules

USER app
WORKDIR /app/backend/services/${SERVICE}

# Services listen on 4001-4008; the ECS task def picks the right port via PORT env
EXPOSE 4001 4002 4003 4004 4005 4006 4007 4008

CMD ["node", "dist/main.js"]
