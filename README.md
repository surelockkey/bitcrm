# BitCRM

Locksmith business management platform.

## Structure

```
.
├── backend/          NestJS microservices monorepo
├── apps/
│   ├── web/          The staff app (Next.js)
│   └── portal/       The client portal — its own Next app on its own domain (see apps/portal/README.md)
├── packages/
│   ├── types/        Shared TypeScript types (used by backend + frontend)
│   ├── document-renderer/  Invoice/estimate templates → HTML/PDF
│   └── portal-ui/    The portal's UI, shared by apps/portal and the staff preview in apps/web
└── package.json      Root npm workspaces config
```

## Getting Started

```bash
# Install all dependencies
npm install

# See backend/README.md for backend-specific instructions
```

## Backend

Four NestJS microservices: `user`, `crm`, `deal`, `inventory`.
See [backend/README.md](./backend/README.md) for details.

## Environment

Copy `backend/.env.example` to `backend/.env` and fill in values.
Never commit `.env` files — they contain secrets.
