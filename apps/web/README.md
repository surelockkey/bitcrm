# @bitcrm/web

Frontend for BitCRM — the internal field-service operations platform. Part of the
BitCRM monorepo (`apps/web`), consuming the shared **`@bitcrm/types`** contract.

> This is a **scaffold**: infrastructure and wiring only. Feature routes and
> components are built on top of it.

## Stack

- **Next.js 16 (App Router) + React 19 + TypeScript**
- **shadcn/ui + Tailwind v4** — Radix primitives, Nova preset (`neutral` base,
  Geist font, Lucide icons), light + dark
- **TanStack Query** — server state · **Zustand** — auth + UI client state
- **react-hook-form + Zod** — forms · **TanStack Table** — dense data tables

## Getting started

```bash
# from the repo root (installs the whole workspace)
npm install

# run the dev server
npm run dev -w @bitcrm/web
# → http://localhost:3000
```

### Environment

Copy `.env.example` → `.env.local` (already present for local dev):

| Var | Purpose |
|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | API gateway base. Requests go to `${base}/{users,crm,deals,inventory}/...`. Default `https://api.bitcrm.tech-slk.com/api`. |

API docs: <https://api.bitcrm.tech-slk.com/api/docs>

## Structure

```
app/            # routes (thin) — layout.tsx mounts providers
  providers.tsx # QueryClient + next-themes; wires auth token into the API client
components/
  ui/           # shadcn primitives (add via: npx shadcn@latest add <name>)
  shell/        # app-specific shell components (sidebar, topbar, …)
features/       # per-feature hooks/components/schemas (deals, contacts, …)
lib/
  api/          # http.ts (typed fetch, id-token bearer, {success,data} unwrap), errors.ts
  query-keys.ts # centralized React Query key factory
  env.ts        # typed public env access
  utils.ts      # cn()
stores/         # Zustand: auth-store.ts, ui-store.ts
hooks/          # cross-cutting client hooks
```

## Conventions

- **Server state → React Query**, never Zustand/Context. **Client/UI state → Zustand.**
  Forms → react-hook-form. See `lib/query-keys.ts` for the key convention.
- The API authenticates with the Cognito **id token** as the `Authorization: Bearer`
  (services verify `tokenUse: "id"`). The auth store feeds it to the API client in
  `app/providers.tsx`.
- Import entities/enums/DTOs/permission types from **`@bitcrm/types`** — do not
  redeclare API shapes here.

## Scripts

`dev` · `build` · `start` · `lint` · `typecheck`
