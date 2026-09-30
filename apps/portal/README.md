# BitCRM client portal

What a client sees when they open the link in a text: their business's name and contact
details, what they owe, and their **sent** estimates and invoices. Each document opens as a
readable web page (the same template as the PDF, reflowed for phones); the PDF is a download.

It is a separate app from `apps/web` on purpose: no sign-in, no staff bundle, no staff session
anywhere near a page that is reachable by a bearer link — and its own domain.

```
https://portal.bitcrm.tech-slk.com/<token>
```

The token is the whole authorisation. The app only calls billing's public, rate-limited routes:

| Call | |
| --- | --- |
| `GET  ${API}/billing/public/portal/:token` | the portal view |
| `GET  ${API}/billing/public/portal/:token/:kind/:id/html` | a document as a page |
| `GET  ${API}/billing/public/portal/:token/:kind/:id/pdf[?download=1]` | a short-lived signed PDF URL |

## Run

```bash
npm install                          # from the REPO ROOT
cp apps/portal/.env.example apps/portal/.env.local   # API base (local: http://localhost:4000/api)
npm run dev -w @bitcrm/portal        # http://localhost:3002
```

Backend side: `PORTAL_BASE_URL=http://localhost:3002` in `backend/.env` so generated links point here.
Open a link from *Client → Client portal → Copy link* in the staff app.

## Deploy

1. **Hosting.** A second project next to the staff app (Vercel: root directory `apps/portal`, install
   from the repo root). Environment: `NEXT_PUBLIC_API_BASE_URL=https://api.bitcrm.tech-slk.com/api`.
2. **Domain.** Point `portal.bitcrm.tech-slk.com` at that project. (Any domain works — it is
   `var.portal_domain` in `backend/infra/dev`, published to SSM as `/bitcrm/dev/app/portal-domain`.)
3. **Backend.** `terraform apply` in `backend/infra/dev` (the SSM parameter and an ALB rule that
   sends old `api…/portal/<token>` links to billing, which redirects them here), then redeploy
   billing so its task definition picks up `PORTAL_BASE_URL`.
4. **Staff app.** Optional `NEXT_PUBLIC_PORTAL_URL` (same origin) — `apps/web` redirects
   `/portal/<token>` links sent from its own origin before the split.

## Layout

- `app/[token]` — the page; `components/portal-app.tsx` loads it and opens documents.
- `lib/api.ts` — the three public calls (no credentials, no cookies, no session handling).
- The UI itself is `packages/portal-ui`, shared with the staff preview (`/portal/preview/:contactId`
  in `apps/web`) so what staff preview is what the client sees.

## Test

```bash
npm test -w @bitcrm/portal && npm test -w @bitcrm/portal-ui
```
