# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**WardYou** is a family-safety platform (device tracking, SOS, safe travel, geofencing, Android-style
parental controls, elder care). This repo is a **from-scratch React Native rebuild** of a legacy .NET
MAUI client — the MAUI app is discarded, but the **existing Azure PostgreSQL database is kept as-is**
(schema owned by old EF Core migrations; never recreated or migrated from this repo).

- Domain audit of the legacy app: [SCAN_MAUI.md](SCAN_MAUI.md) (entities, enums, rules, endpoints, auth, i18n).
- Original migration plan: [PROMPT_Migracao_Wityu_MAUI_para_ReactNative.md](PROMPT_Migracao_Wityu_MAUI_para_ReactNative.md).
- **Live status/roadmap, ground truth for "what's done"**: [SUMMARY.md](SUMMARY.md) — update it whenever
  finishing a unit of work; it tracks phase status, what's wired end-to-end, and what's still open
  (deploy, Maps keys, push FCM, payments, legal review).

### Marca "WardYou" vs. identificadores tecnicos congelados (rename 2026-08-23)

O produto se chamava **Wityu** e foi renomeado para **WardYou** (dominio `wardyou.com`). O rename foi
aplicado apenas ao que e **visivel ou cosmetico**: nome de exibicao do app, strings dos 4 locales,
templates de e-mail, docs, comentarios e nomes de pacote npm (`@wardyou/mobile`, `@wardyou/api`).

**Os identificadores abaixo continuam `wityu` DE PROPOSITO — nao "corrija" nenhum deles:**

| Identificador | Onde | Por que esta congelado |
|---|---|---|
| `com.wityu.app` | `app.config.ts` (package/bundleId), `enforcementLogic.ts` | Trocar cria um app NOVO na Play Store: usuarios existentes nao recebem update, a assinatura muda e o vinculo com o Firebase quebra |
| `google-services.json` (`wityu-499413`) | `apps/mobile/` | Arquivo gerado pelo Firebase, amarrado ao package acima. Editar a mao quebra o FCM |
| `PROTECTED_APP = "wityu"` | `parentalService.ts` | Casa com `com.wityu.app` via `.includes()` para impedir que o app bloqueie a si mesmo. Trocar **desliga a autoprotecao do modo crianca** |
| `__wityu.` / `__wityu.pause` | `parentalService.ts` (sentinelas) | Valores **gravados na tabela `app_rules`** em producao. Trocar orfana as regras existentes |
| `JWT_ISSUER=Wityu` / `JWT_AUDIENCE=Wityu.App` | `env.ts`, `.env` | Trocar invalida todo token emitido (logout forcado da base) e quebra a compat com o legado .NET |
| `wityu://` (scheme) | `app.config.ts`, `auth.ts`, deep links | Registrado nos consoles OAuth (Google/Apple). Trocar sem atualizar la quebra o login externo |
| `wityu_*` (storage keys) | `stores/*.ts`, `pushService.ts`, etc. | Trocar faz todo usuario instalado perder sessao e configuracoes. So com codigo de migracao |
| `wityu_sos` / `wityu_sos_v2` | `pushService.ts`, `fcm.ts` | Canais de notificacao Android sao **imutaveis** apos criados |
| `wityu-api-96164`, `wityuacr96164`, `wityu-kv-mvpsf` | Azure | Azure nao renomeia Web App/ACR/Key Vault in-place; exige recriar infra + novo DNS |
| `app.wityu.com` | deep links / `INVITE_BASE_URL` | Migrar exige hospedar `assetlinks.json` + AASA no dominio novo e manter o antigo pelos links ja distribuidos |

Ao migrar qualquer um deles, faca como projeto proprio, com plano de migracao de dados/usuarios.

npm workspaces monorepo:
- `apps/mobile` — Expo (SDK 56) client: Expo Router, TypeScript strict, NativeWind v4, Reanimated 4,
  i18next (pt/en/es/fr), Zustand, TanStack Query, react-native-maps.
- `apps/api` — Node/TypeScript API ("Caminho B") over the existing Azure PostgreSQL, introspected via Prisma.

## Build / Run Commands

Run from repo root (workspaces):

```bash
npm install                   # installs all workspaces
npm run mobile:web            # Expo web preview → http://localhost:8081
npm run mobile                # Expo dev server, choose platform
npm run mobile:android        # Android device/emulator
npm run mobile:typecheck      # tsc --noEmit (mobile)
```

API (`apps/api`):

```bash
cd apps/api
npm run dev                   # tsx watch, http://localhost:3000 (health: /health)
npm run db:pull               # prisma db pull — re-introspect prod schema (rarely needed)
npm run db:generate           # regenerate Prisma client after a schema change
npm run typecheck             # tsc --noEmit
npm run build                 # prisma generate && tsc → dist/
```

CI (`.github/workflows/ci.yml`) runs on every push/PR: install → `prisma generate` → typecheck
(api + mobile) → test (api + mobile) → build API. Tests use Node's built-in test runner
(`node --test`, no Jest/Vitest) — `apps/api` compiles with `tsc` first and runs against `dist/`
(NodeNext `.js`-suffixed imports need real compiled output); `apps/mobile` has no build step, so
its one test file runs directly off `.ts` source via `--experimental-strip-types` (Node's native
TS type-stripping — works unflagged on Node ≥23.6, needs the flag on 22.6+, which is why CI's
pinned Node 22 passes it explicitly). Coverage today is intentionally narrow: the pure,
safety-critical logic added 2026-07-09 (`deriveAppProfile` in the API, `computeEnforcementState`/
`isWithinWindow` on the client) — not an app-wide suite. Mobile test files must be excluded from
`tsconfig.json` (`exclude: ["**/*.test.ts"]`) since `node:test`/`node:assert` types would otherwise
need `@types/node`, which clashes with RN/DOM global types elsewhere in the app.

### Deployed API (production)

The Node API is **live** on Azure: `https://wityu-api-96164.azurewebsites.net` (Web App for Containers
`wityu-api-96164`, image in ACR `wityuacr96164`, RG `mvp-sf`). `apps/mobile/.env`'s
`EXPO_PUBLIC_API_BASE_URL` points here. Redeploy = `az acr build -r wityuacr96164 -t wityu-api:latest -f
apps/api/Dockerfile .` (from repo root) then `az webapp restart`. Env/secrets live in the Web App's app
settings, not the repo. Full deploy runbook is in SUMMARY.md → "Deploy da API". Note: the API does **not**
run migrations (schema is owned by the introspected DB).

### Android APK build (local, no EAS)

Prereqs live in `C:\Android` (portable, no admin): JDK17, Android cmdline-tools, `platform-tools`,
`platforms;android-35`, `build-tools;35.0.0`, `ndk;27.1.12297006`, `cmake;3.30.5`. With `JAVA_HOME` and
`ANDROID_HOME=C:\Android` set:

```bash
cd apps/mobile
npx expo prebuild --platform android --no-install    # generates android/
cd android
./gradlew.bat :app:assembleRelease -PreactNativeArchitectures=arm64-v8a --no-daemon
# → app/build/outputs/apk/release/app-release.apk  (signed w/ debug keystore, installable for testing)
```

**Windows MAX_PATH gotcha (New Architecture is on):** the `:app:buildCMakeRelWithDebInfo` step fails with
`ninja: error: mkdir(...)` unless BOTH are in place: (1) `LongPathsEnabled=1` in
`HKLM\SYSTEM\CurrentControlSet\Control\FileSystem` (needs admin), and (2) CMake ≥3.30 pinned in
`apps/mobile/android/app/build.gradle` (`android { externalNativeBuild { cmake { version "3.30.5" } } }`) —
the default 3.22.1 isn't long-path-aware. `subst`/junctions don't help (Expo autolinking realpath-resolves).

### Environment

- `apps/mobile/.env` (copy from `.env.example`): `EXPO_PUBLIC_API_BASE_URL`, Maps/OAuth keys,
  `EXPO_PUBLIC_USE_MOCKS`. Currently points at the **deployed Azure API**
  (`https://wityu-api-96164.azurewebsites.net`); local Node (`http://localhost:3000`) is a commented
  fallback. When `apiBaseUrl` is empty or `USE_MOCKS=true`, the mobile app falls back to mock data
  (`src/lib/mockData.ts`) instead of calling the API — check `src/lib/env.ts` (`hasApi`/`useMocks`) before
  assuming a screen is hitting the real backend.
- `apps/api/.env` (copy from `.env.example`): `DATABASE_URL` (Azure Postgres `safefamily` @
  `mvp-sf-pg-96164`), `JWT_SECRET`/`JWT_ISSUER`/`JWT_AUDIENCE`, `CORS_ORIGIN`. The dev API currently talks
  directly to the **production** database — be careful with writes; see SUMMARY.md's security/infra section.

## Architecture

### `apps/api` (Fastify + Prisma)

- `src/server.ts` — composition root: registers CORS, `@fastify/jwt`, an `app.authenticate` preHandler
  guard for protected routes, a global error handler that maps `AppError` → `{ message, code }`, then
  mounts one route module per feature under `/api/v1/*`, and finally starts Socket.IO
  (`src/realtime.ts`) on the same HTTP server at `/realtime`, authenticated via the same JWT.
- Each feature is a `routes/{feature}.ts` + `services/{feature}Service.ts` pair (e.g. `routes/parental.ts`
  + `services/parentalService.ts`). Routes parse/validate (Zod) and call the service; services hold the
  Prisma queries and business rules ported from the old .NET `WardYou.Application` layer.
- **Auth compatibility is load-bearing**: password hashing (`lib/password.ts`) and refresh-token hashing
  (`lib/tokens.ts`) are byte-compatible with the old .NET `Pbkdf2PasswordHasher` (PBKDF2-SHA512, 100k
  iterations, `iter.salt.hash` format) and SHA-256 upper-hex refresh tokens, so existing accounts keep
  working without a data migration. Don't change these formats without a plan for existing rows.
- `prisma/schema.prisma` is **introspected** (`prisma db pull`) from the live production DB — tables are
  snake_case, columns are PascalCase (legacy EF Core naming). Never run `prisma migrate` against it; the
  schema is owned by the database, not by this repo.
- Sensitive actions (auth, consents, SOS, parental policy changes, family/device changes) write to
  `audit_logs` via `services/auditService.ts` (`writeAudit` — best-effort, never throws).
- Location/consent/geofencing gating: a member's position is only exposed via `GET /families/map` or
  device location-history if it's the caller's own, or the caller has an active `LocationSharing` consent
  (user-level, self-granted, or family-level, granted by an admin/guardian per member) — see
  `services/consentService.ts` (`hasActiveUserConsent`/`hasActiveFamilyConsent`) and how `locationService.ts`
  / `deviceService.ts` both apply the same check.

### `apps/mobile` (Expo Router)

- Routing lives under `app/` (file-based, Expo Router): `(auth)` for login/register, `(tabs)` for the 5
  main tabs (Home/Family/Trips/SOS/Settings), and top-level routes for deeper flows (`consents`,
  `devices`, `privacy`, `zones/`, `parental/[childUserId]/`, `elder/`). Import alias `@/*` → `src/*`
  (`tsconfig.json`).
- `src/features/{feature}/queries.ts` holds TanStack Query hooks per feature (e.g.
  `src/features/parental/queries.ts`) — screens call these, not `apiClient` directly.
- `src/services/api/client.ts` — typed fetch wrapper (`apiClient.get/post/put/del`) that attaches the
  Zustand-persisted access token and **transparently refreshes on a 401** (single in-flight refresh shared
  across concurrent callers via `refreshPromise`, then retries once).
- `src/stores/session.ts` — Zustand store for the auth session (tokens, persisted via SecureStore);
  `AuthGate` in the root layout redirects between `(auth)` and `(tabs)` based on session state.
- `src/services/realtime/` — Socket.IO client; `useRealtimeSync()` (mounted in the root `AuthGate`)
  invalidates the relevant React Query caches when the server pushes parental/zone/SOS events, so lists
  and the map update live without polling.
- `src/services/location/` and `MapPreview` use a `.native.tsx`/web split (react-native-maps vs
  `@vis.gl/react-google-maps`) — platform-specific files, not runtime `Platform.OS` branching, for
  anything touching native modules that don't exist on web (maps, push, geolocation).
- i18n: `src/i18n/index.ts` + `src/locales/{pt,en,es,fr}.json`. **Every user-facing string must be
  translated in all 4 locale files** — no hardcoded strings in components.
- Design system: `src/components/ui/` ("Guardião Sereno" tokens — `src/theme/tokens.js`, Sora/Inter/
  JetBrains fonts). Reference/preview all components on the `kitchen-sink` route (`app/kitchen-sink.tsx`)
  before adding a new one.
- `apps/mobile/AGENTS.md` (pulled in via `apps/mobile/CLAUDE.md`) flags that **Expo SDK 56 is newer than
  training data** — check https://docs.expo.dev/versions/v56.0.0/ before writing Expo-specific code
  instead of relying on remembered APIs.

## Notable constraints (see SUMMARY.md "Notas técnicas" for the full list)

- `react` and `react-dom` must be the **exact same version** (web build breaks otherwise).
- NativeWind web requires Tailwind `darkMode: "class"`.
- Root `.npmrc` sets `legacy-peer-deps=true` — needed for the current dependency graph.
- Reanimated 4 requires the `react-native-worklets/plugin` Babel plugin.
- Don't run `expo export` while the dev server is running.
