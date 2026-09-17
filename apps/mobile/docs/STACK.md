# Technical stack verification — BitCRM Field (technician mobile app)

**Date of research:** 2026-09-16
**Verdict:** **Stay on Expo SDK 57 / React Native 0.86 / React 19.2.** Do **not** downgrade,
and do **not** move to SDK 58 when it ships until Stripe merges the AGP 9 fix
([stripe-terminal-react-native#1134](https://github.com/stripe/stripe-terminal-react-native/issues/1134)).

Everything below was verified against live package metadata (`npm view`, unpacked tarballs of
`@stripe/stripe-terminal-react-native@0.0.1-beta.33`, `expo@57.0.8` and `expo@57.0.23`,
`react-native@0.86.0` and `react-native@0.86.3`) and the current Stripe / Expo documentation.
Versions are as published on 2026-09-16.

---

## 1. Stripe Terminal React Native SDK

### 1.1 Current version and release status

| Fact | Value | Source |
| --- | --- | --- |
| Package | `@stripe/stripe-terminal-react-native` | npm |
| Latest version | **`0.0.1-beta.33`**, published **2026-09-11** | `npm view … time` |
| Release phase | **Public preview** — permanently on a `0.0.1-beta.x` line | [SUPPORT.md](https://github.com/stripe/stripe-terminal-react-native/blob/main/SUPPORT.md) |
| Bundled native SDKs | Terminal iOS **5.8.0**, Terminal Android **5.8.0** | [CHANGELOG](https://github.com/stripe/stripe-terminal-react-native/blob/main/CHANGELOG.md) |
| Peer dependencies | `react: "*"`, `react-native: "*"` — **no version gate at install time** | package metadata |

> "The SDK is currently in public preview and released as beta versions, such as `0.0.1-beta.x`.
> During public preview, Stripe supports the SDK, but users should expect to update regularly
> because some breaking changes can occur as we keep pace with the underlying native SDKs."

**Operational consequence (important):** Stripe enforces **end-of-life blocking**. When the native
major version bundled in your SDK build reaches the end of its Deprecated phase, that build is
**blocked from discovering readers, connecting to readers, or processing payments**. Falling behind
on upgrades is a payments-outage risk, not just a tech-debt risk. Subscribe to
`terminal-announce@lists.stripe.com` and budget an upgrade every release (~5–9 weeks based on the
2026 npm publish dates: beta.29 Mar 6, .30 Apr 22, .31 May 28, .32 Jul 30, .33 Sep 11 — gaps of
36–63 days).

### 1.2 Supported React Native versions

There is **no declared peer-dependency range** (`react-native: "*"`). What Stripe actually tests is
stated in the beta.33 changelog:

> "The SDK is now built and tested against **React Native 0.85**, and the example app now uses
> **Expo SDK 56**. … `react-native` remains a `*` peer dependency, so the range of React Native
> versions your app can use is unchanged."

Corroborated by the package's own `devDependencies`: `react-native: "^0.85.0"`,
`react: "19.2.3"`, `@react-native/babel-preset: "^0.85.0"`.
The example app (`example-app/package.json` on GitHub `main` — the npm tarball ships only the
library) pins `expo: "^56.0.0"`, `react-native: "^0.85.0"`, `react: "19.2.3"`.

New Architecture (Fabric/TurboModules) has been officially supported since **beta.24** (RN 0.76).

### 1.3 Does it support Expo?

**Yes — via a config plugin, with a custom development build. Expo Go will never work.**

- The published tarball ships `app.plugin.js` (which requires `lib/commonjs/plugin/withStripeTerminal`;
  the TypeScript source is shipped alongside it at `src/plugin/withStripeTerminal.ts`). Verified
  present in beta.33.
- Stripe's own docs say: *"This package can't be used in the 'Expo Go' app because it requires custom
  native code. You must use `npx expo prebuild` to generate native projects and run your app using
  `npx expo run:ios` or `npx expo run:android`."*
- **Bare workflow is NOT required.** Continuous Native Generation (CNG) is fine — keep `ios/` and
  `android/` out of git, keep all native config in `app.json`. (Note: in SDK 57 `expo prebuild` now
  clears native directories by default, which reinforces the CNG-only approach.)

What the plugin does, read from source:

| Platform | Effect |
| --- | --- |
| iOS | Adds `NSLocationWhenInUseUsageDescription`, `NSBluetoothPeripheralUsageDescription`, `NSBluetoothAlwaysUsageDescription`, `NSLocalNetworkUsageDescription`; optionally `UIBackgroundModes: ["bluetooth-central"]`; injects a no-op Swift file for Swift interop. |
| Android | Adds `BLUETOOTH_CONNECT`, `BLUETOOTH_SCAN` (with `neverForLocation`), `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION` (`maxSdkVersion="30"`); sets `android.jetifier.ignorelist=jackson-core`. |
| Android, `appDelegate: true` | Injects `TerminalApplicationDelegate.onCreate(this)` into `MainApplication.kt`. **Required for Tap to Pay on Android.** |
| Android, `tapToPayCheck: true` | Injects `if (TapToPay.isInTapToPayProcess()) { return }` immediately after `super.onCreate()` (Tap to Pay runs your app in a second process; without the guard, your init code runs twice). |

Plugin config to add to `app.json`:

```json
["@stripe/stripe-terminal-react-native", {
  "bluetoothBackgroundMode": true,
  "locationWhenInUsePermission": "Location access is required to accept payments.",
  "bluetoothAlwaysUsagePermission": "This app uses Bluetooth to connect to supported card readers.",
  "appDelegate": true,
  "tapToPayCheck": true
}]
```

### 1.4 Tap to Pay on iPhone

| Requirement | Value |
| --- | --- |
| Device | **iPhone XS or later** |
| iOS | "a one-year or later iOS version" per [Apple's Business Register list](https://register-docs.apple.com/tap-to-pay-on-iphone/docs/sdk-and-api-guide#ios-versions-and-deprecation-management). **iOS beta releases do not work.** |
| PIN entry | requires **iOS 16.4+** |
| US | **Generally available** (also AT AU BE CA CH CZ DE DK ES FI FR GB IE IT LU NL NZ PL PT SE SG) |
| SDK floor | SDK compatible with apps targeting iOS 15.1+; Expo SDK 57's default deployment target is **16.4**, so we are comfortably above both |

**Apple entitlement — Stripe does not obtain it for you.** The process is:

1. Request the **development** entitlement from your **Apple Developer account**
   ([Apple docs](https://developer.apple.com/documentation/proximityreader/setting-up-the-entitlement-for-tap-to-pay-on-iphone)).
2. Add `com.apple.developer.proximity-reader.payment.acceptance` = `true` to the app's entitlements
   (in Expo: `ios.entitlements` in `app.json`, so EAS bakes it into the provisioning profile).
3. After internal testing, request the **distribution** entitlement separately.
4. **Submit the app to Apple for approval.** Stripe publishes a
   [Tap to Pay Guide (PDF)](https://docs.stripecdn.com/fd6123a72c0ea6d22019c125f9a35d855fe859b4e327faeb89a2934091830744.pdf)
   for this.

**Apple also mandates a "How to Tap" merchant-education overlay before app review.** It must be
shown via Apple's `ProximityReaderDiscovery` API (`content(for: .payment(.howToTap))` then
`presentContent(_:from:)`), guarded by `#available(iOS 18.0, *)` with your own fallback UI for
earlier versions. **The Stripe RN SDK does not expose this** — it is a small Expo native module we
will have to write ourselves (no extra dependency: `ProximityReader` is a system framework already
linked by the Terminal SDK). **Budget this; it is a hard gate on App Store approval.**

Entitlement and provisioning are tied to the **bundle ID and Apple Developer account**, not to the
Expo SDK version — so changing the Expo SDK later never costs us a re-request.

### 1.5 Tap to Pay on Android

No entitlement process, but the **device requirements are strict and enforced at runtime, including
in the simulated reader**:

- Not a certified (PCI PTS) payment device
- Working integrated NFC sensor and an ARM processor
- Not rooted; bootloader locked and unchanged; unmodified manufacturer OS
- **Android 13 or later**
- **A security patch from the past 12 months**
- Google Mobile Services + Play Store installed (non-GMS builds fail with `ATTESTATION_FAILURE`)
- Hardware keystore with ECDH: `FEATURE_HARDWARE_KEYSTORE` version ≥ 100
- **Developer options disabled**
- Stable internet
- **Emulators are not supported at all**

US is **generally available**. Supported phones include Pixel 5+, Samsung Galaxy A/S/Z lines,
Motorola, Xiaomi, OnePlus, Oppo, Honor, Asus, Infinix (Stripe's list is non-exhaustive).

PIN collection additionally fails (`TAP_TO_PAY_INSECURE_ENVIRONMENT`) if accessibility services are
running, screen recording is active, a screen-overlay window is present, or a screenshot is
attempted. Our UI must handle this error with actionable retry guidance for the technician.

**Practical consequence for BitCRM:** the "can this technician take a card payment on this phone?"
question must be answered in-app at onboarding (`supportsReadersOfType` + `expo-device`), not
assumed. Many BYOD Android phones in the field will fail — mostly on the 12-month security-patch
rule and on Android 13. Plan a fallback (Stripe M2 Bluetooth reader, or a payment link by SMS).

### 1.6 Is Expo SDK 57 / RN 0.86 supported TODAY?

**Yes, in practice — and SDK 57 is the safest target available right now.** Stripe's tested baseline
is RN 0.85 / Expo SDK 56, but the gap is nil in substance:

1. **Expo SDK 57 is an explicitly non-breaking bump of SDK 56.** Per Expo's changelog: RN 0.85 → 0.86,
   **React unchanged at 19.2**, "React Native 0.86 is intended to have no breaking changes from 0.85".
   React 19.2 is exactly the React that Stripe dev-deps against (`react: "19.2.3"` — identical to our
   `package.json`).
2. **The Android toolchain is unchanged in the way that matters.** `react-native@0.86.0` and
   `@0.86.3` both pin, in `gradle/libs.versions.toml`, **AGP 8.12.0, Kotlin 2.1.20, compileSdk 36,
   targetSdk 36**. Stripe's README states `compileSdkVersion = 35` / `targetSdkVersion = 35`;
   the Stripe module takes both from `rootProject.ext`, so it compiles at RN's 36 — the normal
   forward direction, not a violation. Kotlin 2.1.20 is within Expo's supported range (< 2.3.0).
3. **The one known future breakage does not affect us.** Stripe PR/issue #1134 fixes
   `Cannot add extension with name 'kotlin'` under **AGP 9**, which the author states affects
   **React Native 0.87+ and Expo SDK 58+**. We are on AGP 8.12 → unaffected. This is the strongest
   argument *for* SDK 57 and *against* jumping to SDK 58 on release.
4. `react-native: "*"` peer dep means no install-time friction either way.
5. No open issue on the Stripe repo reports RN 0.86 or Expo SDK 57 breakage
   (checked all 18 open issues — 27 open items including the 9 open PRs — as of 2026-09-16).

**Residual risk:** "built and tested against 0.85" is a statement about Stripe's CI, not a guarantee.
The mitigation is cheap and must happen early: **build a Tap to Pay smoke test on a physical iPhone
and a physical Android device in the first sprint**, before any UI work depends on it. If it breaks,
`expo install expo@^56` is a one-command downgrade (see §3).

---

## 2. Other native capabilities

Versions below are the ones Expo SDK 57 bundles (read from `expo@57.0.23/bundledNativeModules.json`).
Install with `npx expo install <pkg>` so these are resolved automatically — never `npm install` a
raw `latest`.

| Need | Package | SDK 57 version | Expo Go? | Notes |
| --- | --- | --- | --- | --- |
| Camera capture | `expo-camera` | `~57.0.5` | yes | Config plugin sets `cameraPermission` / `microphonePermission` (iOS) and `recordAudioAndroid`. Set `barcodeScannerEnabled: false` if we don't scan, to cut app size — but note that on Android this only takes effect when `expo-camera` is listed in `expo.autolinking.buildFromSource`; the prebuilt module always includes the barcode libraries. |
| Pick existing photos | `expo-image-picker` | `~57.0.18` | yes | |
| Save to gallery | `expo-media-library` | `~57.0.5` | yes | Only if techs need photos in their camera roll. |
| Photo upload, background | `expo-file-system` | `~57.0.7` | yes | New API: `File.upload(url, options)` and `File.createUploadTask(url, options)`; `uploadType: BINARY_CONTENT \| MULTIPART`, `onProgress`, `AbortSignal`. **`sessionType: 'background'` is iOS-only** — native transfer survives app suspension. See §2.1. |
| Background location | `expo-location` + `expo-task-manager` | `~57.0.18` / `~57.0.18` | **NO** | **Forces a dev client.** See §2.2. |
| Deferred background work | `expo-background-task` | `~57.0.18` | yes | WorkManager (Android, **15-min minimum interval**) / BGTaskScheduler (iOS, OS decides timing). CNG adds `UIBackgroundModes: ["processing"]` + `BGTaskSchedulerPermittedIdentifiers`. |
| Push notifications | `expo-notifications` | `~57.0.19` | **partial** | Local notifications work in Expo Go. **Remote push is unavailable in Expo Go on Android since SDK 53**, and needs a dev build on iOS. See §2.3. |
| Offline storage | `expo-sqlite` | `~57.0.3` | yes | Sync + async API, WAL, prepared statements, `SQLiteProvider`/`useSQLiteContext`, a built-in key-value store, session/changeset support for sync, and a DevTools DB inspector. Plugin options: `enableFTS`, **`useSQLCipher`** (encryption at rest — **not available in Expo Go**, needs a native build), `useLibSQL`. |
| Fast key-value | (see §2.4) | — | — | **Recommendation: skip MMKV, use `expo-sqlite`'s key-value store.** |
| Secure token storage | `expo-secure-store` | `~57.0.4` | yes | Already in use — bump from `~57.0.1`. |
| Biometric unlock | `expo-local-authentication` | `~57.0.3` | yes | Face ID / Touch ID / Android BiometricPrompt. iOS needs `NSFaceIDUsageDescription` via the plugin. Pair with `expo-secure-store` (`requireAuthentication`). |
| Maps / navigation deep links | `expo-linking` | `~57.0.10` | yes | Pure JS — `maps://`, `comgooglemaps://`, `https://maps.google.com/…`, `waze://`. **No native code, no workflow impact.** iOS needs `LSApplicationQueriesSchemes` if we call `canOpenURL`. |
| In-app map view | `react-native-maps` | `1.27.2` | no | Only if we render a map ourselves. Needs a Google Maps API key via config plugin on Android. |
| Connectivity detection | `@react-native-community/netinfo` | `12.0.1` | yes | Needed to drive the offline queue. |
| Device capability gating | `expo-device` | `~57.0.2` | yes | Use for Tap to Pay pre-checks / telemetry. |
| Custom dev build | `expo-dev-client` | `~57.0.19` | — | **Required.** |
| Native build knobs | `expo-build-properties` | `~57.0.18` | — | **Required — see §2.5.** |
| OTA JS updates | `expo-updates` | `~57.0.22` | — | Optional. Ships JS/asset updates only; any native change (new module, plugin, entitlement) still needs a store release. |

### 2.1 Photo upload in the background — read this carefully

This is the capability with the biggest gap between expectation and reality.

- **iOS:** `File.createUploadTask(url, { sessionType: 'background', … })` hands the transfer to
  `NSURLSession` background mode. The bytes keep moving after the app is suspended. But — per the
  docs — the **JavaScript task instance requires an active runtime**, so completion handling has to
  be re-established when the app is next foregrounded.
- **Android:** Expo's docs **do not document an equivalent background upload session.** There is no
  `sessionType: 'background'` guarantee on Android.
- **Therefore:** design for a **durable local queue**, not for "fire the upload and forget it".
  Concretely: write the job to `expo-sqlite` (file URI + job id + status), upload while the app is
  foreground/active, and use `expo-background-task` (15-min floor) plus an on-launch drain to retry.
  Do **not** promise "photos upload while the phone is in the technician's pocket" on Android.
- The legacy `FileSystem.uploadAsync()` still exists at `expo-file-system/legacy`, but importing it
  from the main package **throws at runtime**. Don't mix the two.

Resumability in the HTTP sense (byte-range resume of a half-sent file) is **not** provided by
`expo-file-system` on either platform. If we need true resumable uploads for large job videos, the
answer is a chunked/multipart protocol on the BitCRM backend (S3 multipart, or tus) with chunk state
in SQLite — an app + backend design decision, not a library choice.

### 2.2 Background location — forces a dev client

> "You must use a development build to use background location since it is not supported in the Expo
> Go app."

Required config:

- **iOS:** `UIBackgroundModes: ["location"]`, `NSLocationAlwaysAndWhenInUseUsageDescription`,
  `NSLocationWhenInUseUsageDescription`; plugin property `isIosBackgroundLocationEnabled: true`.
- **Android:** `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`,
  plus `ACCESS_FINE_LOCATION`; plugin properties `isAndroidBackgroundLocationEnabled: true` and
  `isAndroidForegroundServiceEnabled: true`.
- The task must be registered with `TaskManager.defineTask()` **at top-level module scope**, not
  inside a component.

Store-review notes: iOS "Always" location requires a clear in-app justification and Apple scrutinises
it; Android background location requires a Play Console declaration and a demo video. This is the
existing PRD story 4.03 — plan review lead time.

**Interaction with Stripe Terminal:** the Terminal SDK also needs location ("If the SDK can't
determine the location of the iOS device, payments are disabled"). Both plugins write location
permission strings into `Info.plist` / `AndroidManifest.xml`. Set the user-facing strings once, in
one place, and make sure the two plugins' strings don't fight — `expo-location`'s "Always" string
must be the one the user sees, since it is the broader grant.

### 2.3 Push notifications — Expo push service vs direct FCM/APNs

Both work. `expo-notifications` is **push-service agnostic**:

- **Expo Push Service:** `getExpoPushTokenAsync()`, send to `exp.host`. Expo manages credentials.
  Fastest path; one send API for both platforms.
- **Direct FCM v1 / APNs:** `getDevicePushTokenAsync()` returns the native token; the BitCRM backend
  talks to FCM and APNs itself. We own the FCM service account JSON and the APNs `.p8` key + Team ID.

**Recommendation: direct FCM + APNs**, because BitCRM's backend is NestJS on AWS and already owns job
dispatch — adding a third-party relay in the path of "new job assigned" notifications adds a
dependency and a deliverability blind spot for no gain. Expo's own docs call the direct path "a
little more complicated," and that cost is one-time.

Either way: **remote push requires a custom dev build on Android (Expo Go dropped it in SDK 53)**,
Android 8+ requires a notification channel before a token can be obtained, and iOS needs the
`aps-environment` entitlement (the `expo-notifications` plugin adds it).

### 2.4 MMKV vs expo-sqlite — do not add MMKV

`react-native-mmkv` is at **4.3.2**, and since v4 it is built on **Nitro Modules**
(`react-native-nitro-modules`, currently **0.37.1**) — a second native codegen stack that must be
kept in lockstep with the RN version, and a recurring source of "NitroModules cannot be found" build
failures on Expo upgrades. It is not in Expo's bundled-modules list, so `expo install` will not pick
a version for us and `expo-doctor` will not validate it.

We already need `expo-sqlite` for the offline job cache. Its built-in key-value store covers the
MMKV use case, it is version-managed by Expo, and it keeps our native dependency surface one library
smaller. **Add MMKV only if a measured performance problem justifies it.**

### 2.5 Mandatory `expo-build-properties` setting

**Expo/RN default `minSdkVersion` is 24. Stripe Terminal requires 26** and explicitly warns that
overriding it downward fails at runtime — from the SDK's own
[README, "Requirements → Android"](https://github.com/stripe/stripe-terminal-react-native/blob/main/README.md#android):

> "Note that attempting to override minSdkVersion to decrease the minimum supported API level will
> not work due to internal runtime API level validation."

So this is not optional:

```json
["expo-build-properties", {
  "android": { "minSdkVersion": 26 },
  "ios": { "deploymentTarget": "16.4" }
}]
```

(`compileSdk 36` / `targetSdk 36` come from RN 0.86 and already exceed Stripe's ≥ 35 requirement —
no override needed there.)

### 2.6 What forces a custom dev client — summary

| Forces a dev client | Fine in Expo Go |
| --- | --- |
| `@stripe/stripe-terminal-react-native` (all of it) | `expo-camera`, `expo-image-picker` |
| `expo-location` **background** updates | `expo-location` foreground |
| `expo-notifications` **remote push** (Android since SDK 53; iOS too) | `expo-notifications` local |
| `expo-sqlite` with `useSQLCipher` | `expo-sqlite` plain |
| `react-native-maps` | `expo-linking` deep links |
| any `expo-build-properties` change | `expo-local-authentication`, `expo-secure-store` |

**Nothing on our list forces the bare workflow.** Every requirement is met by CNG (`app.json`
plugins) + `expo prebuild` + EAS Build. Keep `ios/` and `android/` untracked.

---

## 3. Firm recommendation

### Stay on Expo SDK 57 / React Native 0.86 / React 19.2.

Rationale, in order of weight:

1. **SDK 57 is SDK 56 with a non-breaking RN bump and the identical React.** The "untested" delta
   against Stripe's baseline is RN 0.85 → 0.86, which React Native itself shipped as a no-breaking-
   changes release. There is no meaningful risk to buy back by downgrading.
2. **SDK 57 is the last SDK before the known Stripe breakage.** AGP 9 (RN 0.87+/Expo SDK 58+) breaks
   the Stripe Android build until #1134 lands. Pinning to 57 buys us a stable floor *and* tells us
   exactly what to watch before upgrading.
3. **Downgrading has a real cost and no benefit.** SDK 56 would put us one RN behind with the same
   unverified-by-Stripe status the moment they ship a beta.34 tested on 0.86 — which, on their
   cadence, is likely within two months.
4. **We are already on 57** with working auth. Downgrading burns days for a hypothetical.

### Exact versions to use

`package.json` core (unchanged except patch bumps):

```
expo                ~57.0.23    (currently ~57.0.8 — run `npx expo install --check`)
react-native        0.86.3      (currently 0.86.0 — see note)
react               19.2.3
typescript          ~6.0.3
```

**Note on the React Native patch.** `react-native` is pinned by the `expo` patch you are on:
`expo@57.0.8`'s `bundledNativeModules.json` names `0.86.0`, `expo@57.0.23`'s names `0.86.3`.
Moving to `expo@~57.0.23` therefore moves React Native to `0.86.3` — `npx expo install --check`
will say so. Both patches carry the identical Android toolchain (AGP 8.12.0 / Kotlin 2.1.20 /
compileSdk 36), so nothing in §1.6 changes; just don't hand-pin `0.86.0` next to `expo@57.0.23`.

Add, all via `npx expo install`:

```
@stripe/stripe-terminal-react-native   0.0.1-beta.33   ← PIN EXACTLY, no ^ or ~
expo-dev-client                        ~57.0.19
expo-build-properties                  ~57.0.18
expo-location                          ~57.0.18
expo-task-manager                      ~57.0.18
expo-background-task                   ~57.0.18
expo-notifications                     ~57.0.19
expo-camera                            ~57.0.5
expo-image-picker                      ~57.0.18
expo-file-system                       ~57.0.7
expo-sqlite                            ~57.0.3
expo-local-authentication              ~57.0.3
expo-device                            ~57.0.2
expo-linking                           ~57.0.10
expo-secure-store                      ~57.0.4   (bump from ~57.0.1)
@react-native-community/netinfo        12.0.1
```

**Pin `@stripe/stripe-terminal-react-native` to an exact version.** It is a beta line with documented
breaking changes between betas (beta.33 alone broke the reader-settings accessibility error shape).
A `^` or `~` range on a `0.0.1-beta.x` version is a trap: npm's semver treats prerelease ranges
unpredictably, and an unreviewed beta bump can break a payment flow in production. Upgrade it
deliberately, read the changelog, and re-run the on-device Tap to Pay smoke test each time.

**Do not add:** `react-native-mmkv` (§2.4), `expo-av` (last bundled in SDK 54 at `~16.0.8`; absent
from SDK 55, 56 and 57 — use `expo-audio` / `expo-video`).

### Cost of changing later

| Change | Cost |
| --- | --- |
| **SDK 57 → 56** (if Stripe breaks on 0.86) | Low, today. `npx expo install expo@^56 --fix`, rebuild, re-run `prebuild`. React is unchanged, so no application code moves. ~half a day plus a rebuild and a TestFlight/internal-track round. **This cost rises steeply once we add more native modules and ship to stores** — do the smoke test in sprint 1 while it's cheap. |
| **SDK 57 → 58** | Blocked until Stripe #1134 merges (AGP 9). After that, a normal Expo upgrade. |
| **Adding a native module later** | Cheap under CNG: add to `app.json`, `prebuild`, rebuild, ship a store release (no OTA). |
| **Expo → bare React Native** | Moderate and one-way in spirit: we take permanent ownership of `ios/` and `android/`, lose `expo install` version management and `expo-doctor`. Avoidable — nothing we need requires it. |
| **React Native → Flutter / native / Capacitor** | Full rewrite. 100% of the mobile codebase, plus re-doing the Apple Tap to Pay entitlement/approval against a new build. Months. |
| **Tap to Pay entitlement** | Tied to the Apple Developer account and bundle ID, **not** to the framework or SDK version. Never needs re-requesting due to a version change. Do it once, early — Apple approval is the long pole. |

### Sequencing advice

The Apple entitlement request and the "How to Tap" overlay module (§1.4) are the two items with
external lead time and no engineering shortcut. Start the entitlement request **now**, in parallel
with feature work — not when the payment screen is ready.

---

## 4. Alternative stacks — sanity check

**Flutter.** Stripe has **no official Terminal Flutter SDK** — the supported client SDKs are iOS,
Android, React Native, and JavaScript (smart readers only). Tap to Pay in Flutter means a
community wrapper such as `mek_stripe_terminal`, so our ability to take card payments depends on a
volunteer maintainer keeping pace with Stripe's ~6-week native releases — under a regime where
falling behind gets you **hard-blocked from processing payments**. That is an unacceptable single
point of failure for the revenue path. Add: the team writes TypeScript/React, so Dart is a from-zero
hire-or-learn cost; zero code sharing with the BitCRM web app; and time to first release is longest
of all the options because the payments integration would be exploratory rather than documented.
**Reject.**

**Native Swift + Kotlin.** Technically the strongest Tap to Pay story — the first-party Terminal iOS
and Android SDKs are exactly what the React Native SDK wraps, so we'd shed a layer of beta-quality
abstraction and gain direct access to `ProximityReaderDiscovery` (which we currently have to bridge
ourselves) and to Apple/Google APIs generally. But it is two codebases, two build pipelines, and two
skill sets the team does not have; zero shared code with the BitCRM web app; and roughly 2–3× the
time to first release for the same feature set, sustained forever after. The only scenario that
justifies it is Tap to Pay proving unworkable on React Native — which the evidence in §1 does not
support. **Reject now; keep as the documented escape hatch.**

**Capacitor / Ionic.** Highest theoretical code sharing with the BitCRM web app (it *is* the web app
in a WebView), and the team's TypeScript/React skills transfer directly. But there is **no official
Stripe Terminal Capacitor plugin**, and Tap to Pay on iPhone fundamentally requires the native
`ProximityReader` + Terminal iOS SDK — meaning we would write and maintain our own Capacitor bridge
over two native SDKs that ship breaking changes every six weeks, again under EOL hard-block
enforcement. Beyond payments, the things this app is actually made of — reliable background GPS on a
technician's phone all day, camera capture, a durable offline queue — are precisely where a WebView
shell is weakest, and Capacitor's background execution story on Android is materially worse than
React Native's. Time to first release looks shortest on paper and is longest in practice once the
native bridges are counted. **Reject.**

**Conclusion.** React Native + Expo is the only option where Stripe ships and supports the Terminal
SDK first-party, the team's existing TypeScript/React skills apply directly, business logic and types
can be shared with the BitCRM web codebase, and a custom dev build + EAS gets us to a testable
on-device release in days rather than weeks.

---

## Sources

- npm registry metadata, 2026-09-16: `@stripe/stripe-terminal-react-native@0.0.1-beta.33` (published 2026-09-11; `latest`), `expo@57.0.23` (`latest`, `sdk-57`), `react-native@0.86.3` (`0.86-stable`), `react-native-mmkv@4.3.2`, `react-native-nitro-modules@0.37.1`
- Unpacked package contents: `app.plugin.js` / `src/plugin/withStripeTerminal.ts`, `stripe-terminal-react-native.podspec` (iOS 15.1, `StripeTerminal ~> 5.8.0`), `android/build.gradle` (minSdk 26, JVM 17), `README.md` (API level 26, compileSdk/targetSdk 35), `CHANGELOG.md`, `SUPPORT.md`; `expo@57.0.8` and `expo@57.0.23` `bundledNativeModules.json` (react-native `0.86.0` → `0.86.3`); `react-native@0.86.0` and `@0.86.3` `gradle/libs.versions.toml` (minSdk 24, compileSdk/targetSdk 36, AGP 8.12.0, Kotlin 2.1.20); `expo-template-bare-minimum@sdk-57` `android/gradle.properties` (`newArchEnabled=true`) and `ios/Podfile` (`platform :ios, … || '16.4'`)
- [`example-app/package.json` on GitHub `main`](https://github.com/stripe/stripe-terminal-react-native/blob/main/example-app/package.json) · [beta.24 release notes](https://github.com/stripe/stripe-terminal-react-native/releases/tag/v0.0.1-beta.24) (New Architecture / RN 0.76)
- [Stripe Terminal React Native SDK — GitHub](https://github.com/stripe/stripe-terminal-react-native) · [README](https://raw.githubusercontent.com/stripe/stripe-terminal-react-native/main/README.md) · [releases](https://github.com/stripe/stripe-terminal-react-native/releases) · [issue/PR #1134 (AGP 9 / RN 0.87+ / Expo SDK 58+)](https://github.com/stripe/stripe-terminal-react-native/issues/1134)
- [Stripe — Set up your integration (React Native)](https://docs.stripe.com/terminal/payments/setup-integration?terminal-sdk-platform=react-native)
- [Stripe — Tap to Pay on iPhone](https://docs.stripe.com/terminal/payments/setup-reader/tap-to-pay?platform=ios) · [Tap to Pay on Android](https://docs.stripe.com/terminal/payments/setup-reader/tap-to-pay?platform=android) · [Tap to Pay Guide (PDF)](https://docs.stripecdn.com/fd6123a72c0ea6d22019c125f9a35d855fe859b4e327faeb89a2934091830744.pdf)
- [Stripe — Designing an integration (supported SDK platforms)](https://docs.stripe.com/terminal/designing-integration) · [SDK versioning & support policy](https://docs.stripe.com/terminal/references/sdk-versioning)
- [Apple — Setting up the entitlement for Tap to Pay on iPhone](https://developer.apple.com/documentation/proximityreader/setting-up-the-entitlement-for-tap-to-pay-on-iphone) · [ProximityReaderDiscovery](https://developer.apple.com/documentation/proximityreader/proximityreaderdiscovery)
- [Expo SDK 57 changelog](https://expo.dev/changelog/sdk-57)
- Expo SDK 57 docs: [Notifications](https://docs.expo.dev/versions/v57.0.0/sdk/notifications/) · [Location](https://docs.expo.dev/versions/v57.0.0/sdk/location/) · [FileSystem](https://docs.expo.dev/versions/v57.0.0/sdk/filesystem/) · [SQLite](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/) · [Camera](https://docs.expo.dev/versions/v57.0.0/sdk/camera/) · [BackgroundTask](https://docs.expo.dev/versions/v57.0.0/sdk/background-task/) · [BuildProperties](https://docs.expo.dev/versions/v57.0.0/sdk/build-properties/)
- [Expo — Send notifications with FCM and APNs directly](https://docs.expo.dev/push-notifications/sending-notifications-custom/)
- [mek_stripe_terminal (community Flutter package)](https://pub.dev/packages/mek_stripe_terminal)
