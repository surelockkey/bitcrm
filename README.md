# BitCRM Field (mobile)

Technician mobile app for the BitCRM / SLK field-service platform. Built as a
**standalone Expo project**, separate from the `bitcrm` web monorepo.

**Current scope: authentication only.** This is the foundation for the GPS
location-tracking feature (PRD story 4.03), which lands next.

## Stack

- Expo SDK 57 · React Native 0.86 · React 19 · TypeScript
- Auth against the live backend (AWS Cognito via the `user` service)
- Secure token storage via `expo-secure-store`
- Jest (`jest-expo`) for the logic layer, built test-first (TDD)

## Getting started

```bash
npm install
npm run ios       # or: npm run android  /  npm run start
```

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
npx tsc --noEmit   # type-check
```

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
