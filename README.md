# BitCRM

Locksmith business management platform.

## Structure

```
.
├── apps/
│   ├── web/          Next.js dispatch console (a root workspace)
│   └── mobile/       Expo technician app — NOT a root workspace, see below
├── backend/          NestJS microservices monorepo
├── packages/
│   └── types/        Shared TypeScript types (used by backend + both frontends)
└── package.json      Root npm workspaces config
```

## Getting Started

```bash
# Install all dependencies
npm install

# See backend/README.md for backend-specific instructions
```

`npm install` at the root covers everything except `apps/mobile`, which installs
separately:

```bash
cd apps/mobile && npm install
```

That is deliberate. AWS Amplify builds `apps/web` by running an install at the
repository root, so anything in the root workspaces is installed on every web
deploy — and the Expo SDK 57 / React Native 0.86 toolchain has no business being
there. The app still uses `@bitcrm/types`, over a `file:` link.
See [apps/mobile/README.md](./apps/mobile/README.md).

## Backend

Four NestJS microservices: `user`, `crm`, `deal`, `inventory`.
See [backend/README.md](./backend/README.md) for details.

## Environment

Copy `backend/.env.example` to `backend/.env` and fill in values.
Never commit `.env` files — they contain secrets.
