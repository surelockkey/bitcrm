# BitCRM Field (mobile)

Technician mobile app for the BitCRM / SLK field-service platform. It lives in
the `bitcrm` monorepo at `apps/mobile`, and shares the backend's entity types
through `@bitcrm/types`.

It is **not** one of the root npm workspaces, and must not become one. AWS
Amplify builds `apps/web` by running an install at the repository root; a
workspace entry here would put the whole Expo SDK 57 / React Native 0.86
toolchain into that install, where any peer conflict with Next.js breaks a web
deploy that has nothing to do with the phone. The app therefore keeps its own
`package.json`, its own `package-lock.json` and its own `node_modules`, and
reaches the shared package over a `file:` link.

**Current scope: authentication only.** This is the foundation for the GPS
location-tracking feature (PRD story 4.03), which lands next.

## Stack

- Expo SDK 57 · React Native 0.86 · React 19 · TypeScript
- Auth against the live backend (AWS Cognito via the `user` service)
- Secure token storage via `expo-secure-store`
- Jest (`jest-expo`) for the logic layer, built test-first (TDD)

## Getting started

Two installs, in this order. The root one is not optional: `@bitcrm/types`
declares the TypeScript it is compiled with, and that compiler is hoisted to the
root `node_modules`.

```bash
npm install --prefix ../..          # repo root: web, services, shared types
cd apps/mobile && npm install       # this app: Expo, React Native, jest
npm run ios                         # or: npm run android / npm run start
```

Every `npm run` here that reads the shared package — `start`, `ios`, `android`,
`web`, `typecheck` — rebuilds it first (`npm run types:build`, which delegates to
`packages/types`' own `build`). The jest suite does the same from a `globalSetup`
hook, so `npx jest` gets the guarantee too. Nothing is committed: `packages/types`
ships `dist/`, and `dist/` is gitignored.

Point the app at a backend by copying `.env.example` to `.env`:

```bash
cp .env.example .env
# EXPO_PUBLIC_API_BASE_URL defaults to the production gateway when unset.
```

Sign in with any BitCRM user's email + password. First-login accounts (Cognito
`NEW_PASSWORD_REQUIRED`) must set their password on the web app first — the app
surfaces a clear message in that case.

## How auth works

- `POST /users/auth/login` → `{ accessToken, refreshToken, idToken, expiresIn }`
- The backend authenticates with the Cognito **id token** as a `Bearer` header
  (services verify `tokenUse: "id"`) — not the access token.
- Tokens are persisted in the device keychain; the id token is mirrored in
  memory so the HTTP layer can attach it synchronously.
- On launch the app restores a saved session and validates it via
  `GET /users/me`; a 401 anywhere signs the user out.

## Testing

```bash
npm test
```

The logic layer — HTTP client, token store, auth API, and auth reducer — is
covered by unit tests and was written red→green. Native/GPS integration is
validated on-device (it can't run under Jest).

```bash
npm run typecheck   # or: npx tsc --noEmit
```

`.github/workflows/mobile.yml` runs both on every push and pull request that
touches `apps/mobile/**` or `packages/types/**`. It builds nothing on Expo/EAS
and touches no AWS.

## Shared types

`src/features/jobs/types.ts` imports `Deal`, `Address`, `Contact`,
`TimelineEntry`, `DealAttachmentMeta` and `JobSuperStatus` from `@bitcrm/types` —
the same package the services and the web app compile against. It used to keep a
hand-written copy of them, and the copy had drifted.

Only two shapes are still declared locally, at the bottom of that file:
`AttachmentUploadTicket` and `StartedBridge`, which are controller response
envelopes rather than entities and so have nothing to import.

`Deal` is narrowed rather than re-exported: the phone treats several fields the
server always sends as optional, because a job can reach a screen out of the
persisted react-query cache that an older build wrote. The narrowing is a named
set in that file, derived from the server's own `Deal`, so a renamed field is a
compile error instead of a silent `undefined`.

`metro.config.js` is what makes this work at runtime — it adds the repo root to
`watchFolders`, without which Metro never sees an edit to `packages/types`, and
lists both `node_modules` trees in `resolver.nodeModulesPaths` as a fallback.

It deliberately leaves `disableHierarchicalLookup` **off**. The app's own
dependencies are never at risk from the root tree — the walk-up from any file
under `apps/mobile` reaches `apps/mobile/node_modules` first — while turning the
flag on hides the 73 packages npm could not hoist, the ones nested under
`node_modules/<pkg>/node_modules` exactly because their version conflicts with
the top level. Measured on a dev bundle, with the flag on Metro silently takes
`pretty-format` 30.5.1 where React Native asked for 29.7.0, `react-is` 19.3.0
for 18.3.1, and `ansi-styles` 4.3.0 where `pretty-format` requires `^5.2.0`.

## Project structure

```
App.tsx                       # AuthProvider + loading / login / home switch
src/
  lib/
    env.ts                    # EXPO_PUBLIC_API_BASE_URL config
    api/
      http.ts                 # fetch wrapper: {success,data} unwrap + Bearer idToken
      errors.ts               # ApiError
  features/auth/
    types.ts                  # LoginRequest / AuthTokens / AuthUser ...
    token-store.ts            # expo-secure-store persistence + in-memory id token
    api.ts                    # login / getMe / refresh
    auth-reducer.ts           # pure loading→signedIn/signedOut state machine
    auth-context.tsx          # provider: bootstrap, signIn, signOut
  screens/
    LoginScreen.tsx
    HomeScreen.tsx            # shows the session + a placeholder for GPS
```

## Next: GPS tracking

The backend is already in place (`user` service):

- `POST /technicians/:id/location` — report live location
- `DELETE /technicians/:id/location` — go offline
- `GET  /technicians/locations` — dispatch view of all online techs

Planned: `expo-location` foreground + background updates (Android foreground
service, iOS `Always` permission), posting on movement with a stationary
heartbeat. See PRD story 4.03 for the full spec.
