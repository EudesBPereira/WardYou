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

### Marca "WardYou" — rename tecnico CONCLUIDO (2026-09-09)

O produto se chamava **Wityu** e foi renomeado para **WardYou** (dominio `wardyou.com`). O rename
cosmetico saiu em 2026-08-23; o rename dos **identificadores tecnicos** saiu em **2026-09-09**.

> **A tabela de "identificadores congelados" que existia aqui foi REMOVIDA de proposito.**
> Ela se justificava por producao existir — usuarios com o app instalado, linhas `__wityu.*` gravadas
> em `app_rules`, tokens ja emitidos, canais de notificacao ja criados no aparelho, convites ja
> distribuidos. **Nada disso existia.** Confirmado em 2026-09-09: nao ha producao; o ambiente `mvp-sf`
> era legado e esta fora do ar. Aproveitada a janela, tudo foi renomeado antes do lancamento.

**Renomeado** (typecheck api+mobile limpos, 28/28 unitarios, 59/59 e2e contra o QA):
`com.wityu.app` -> `com.wardyou.app` · `wityu://` -> `wardyou://` · `app.wityu.com` -> `app.wardyou.com` ·
`JWT_ISSUER/AUDIENCE` -> `WardYou`/`WardYou.App` · chaves de storage `wityu_*` -> `wardyou_*` ·
canais `wityu_sos`/`wityu_sos_v2`/`wityu_protection`/`wityu_blocked_fullscreen` -> `wardyou_*` ·
prefs nativas `wityu_app_block_prefs` -> `wardyou_app_block_prefs` · action do watchdog
`com.wityu.app.APPBLOCK_WATCHDOG` -> `com.wardyou.app....` · tasks `wityu-trip-location-broadcast` /
`wityu-push-background` -> `wardyou-*` · sentinelas `__wityu.*` -> `__wardyou.*` ·
`PROTECTED_APP` -> `"wardyou"` · `slug`/`scheme` -> `wardyou` · strings nativas dos 4 locales.

**Consequencias operacionais do rename** (nao "corrija" achando que e bug):
- ~~`google-services.json` aponta para o projeto antigo~~ **RESOLVIDO 2026-09-09**: projeto Firebase
  novo `wardyou` (numero 983714620760), app Android `com.wardyou.app`
  (appId `1:983714620760:android:0b41bb2da2b2503c4ef12d`), SHA-1 do `debug.keystore` do Expo
  registrado. O `google-services.json` esta em `apps/mobile/` (gitignored).
- `apps/mobile/android/` e gerado: o package novo so chega no APK via `expo prebuild`.
- Redirect URIs `wardyou://auth/callback` precisam ser cadastrados nos consoles OAuth (Google/Apple).
- `app.wardyou.com` precisa de DNS + `assetlinks.json`/AASA (arquivos prontos em `docs/deeplinks/`).

**Mantido em `wityu` de proposito:** o comentario `Wityu.Contracts.Auth.AuthResponse` em
`routes/auth.ts` (referencia historica a um tipo do .NET legado, que nunca se chamou WardYou).

Auditoria original dos residuos e estrategia de convivencia (hoje so valor historico):
[docs/RENAME-WITYU-WARDYOU.md](docs/RENAME-WITYU-WARDYOU.md).

npm workspaces monorepo:
- `apps/mobile` — Expo (SDK 56) client: Expo Router, TypeScript strict, NativeWind v4, Reanimated 4,
  i18next (pt/en/es/fr), Zustand, TanStack Query, react-native-maps.
- `apps/api` — Node/TypeScript API ("Caminho B") over the existing Azure PostgreSQL, introspected via Prisma.

### Autorizacao duravel: commit e push por conta propria (2026-09-09)

O fundador autorizou **commitar e dar push conforme julgar necessario**, sem pedir a cada vez, e manter
o repositorio atualizado ao longo do trabalho. Nao e preciso perguntar antes de cada commit.

Continua valendo o bom senso:
- **Commits pequenos e tematicos**, nao um despejo unico de tudo que mudou.
- **Nunca commitar segredo.** `apps/api/.env*`, `apps/mobile/.env` e `google-services.json` sao
  gitignored — conferir com `git check-ignore -q <arquivo>` antes, se houver duvida.
- **Verificar antes de commitar**: typecheck (api + mobile) e `npm test` nos dois workspaces.
- ⚠️ **`sed -i` do Git Bash converte CRLF -> LF** e suja o `git status` com dezenas de arquivos que
  nao mudaram de conteudo. Conferir com `git diff --name-only` (mudanca real) antes de `git add -A`.

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

### Deployed API — QA (nao existe producao)

**Nao ha ambiente de producao.** O antigo `wityu-api-96164` / RG `mvp-sf` (subscription pessoal) e
**legado e esta fora do ar**. O caminho e: validar no QA -> depois criar producao.

A API roda em **QA** no Azure Container Apps, tenant NEOBPO
(subscription `9bbce015-49c1-4a55-98b3-33a39cfebc23`, RG `wardyou`, westus3):

- URL: `https://wardyou-qa-api.orangesand-7bad7871.westus3.azurecontainerapps.io`
- Container App `wardyou-qa-api` · imagem `cloudorinqaacr.azurecr.io/wardyou-api:qa`
- Banco: `wardyou-qa-psql` / database `wardyou_qa` (PG 16, B1ms). Schema criado por `prisma db push`
  a partir do `schema.prisma` introspectado — **nao ha migrations e a API nao roda nenhuma**.
- ACR e Container Apps env sao **reusados do `cloudorin-qa`** (outro projeto na mesma subscription).
- Redeploy: `powershell -File apps/api/scripts/deploy-qa.ps1` (da raiz do repo).
- Segredos: `apps/api/.env.qa` (gitignored) + secrets do Container App, nao o repo.

⚠️ `min-replicas 0` — o primeiro request sofre cold start. ⚠️ O `az acr build` **precisa** de um contexto
limpo (o `deploy-qa.ps1` monta um): rodar da raiz estoura o MAX_PATH do Windows dentro de `node_modules`.
⚠️ O Norton desta maquina **interceptava** TLS e quebrava os downloads; resolvido em 2026-09-09
desligando "Navegacao segura". Ver a secao "Norton AntiVirus interceptava TLS" abaixo se voltar.

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

### Norton AntiVirus interceptava TLS — RESOLVIDO em 2026-09-09

**Historico, para quem esbarrar de novo.** O Norton AntiVirus desta maquina (`NortonSvc`, engine Avast)
fazia SSL/TLS scanning e reassinava todo HTTPS com o CA `CN=Norton Web/Mail Shield Root`. Isso derrubou
**cinco** ferramentas: npm, winget, az CLI, sdkmanager e Gradle.

**Resolvido desligando "Navegacao segura"** no Norton (Configuracoes -> Recursos -> Navegacao segura, ou
Seguranca -> Avancado -> Navegacao segura). Verificado: `dl.google.com` volta a vir do Google Trust
Services, `repo.maven.apache.org` da Let's Encrypt. `az` e `sdkmanager` passaram a funcionar **sem
nenhum workaround**.

Para conferir se voltou (o toggle pode ser reativado por update ou politica):

```powershell
$c = New-Object Net.Sockets.TcpClient("dl.google.com", 443)
$s = New-Object Net.Security.SslStream($c.GetStream(), $false, {$true})
$s.AuthenticateAsClient("dl.google.com")
(New-Object Security.Cryptography.X509Certificates.X509Certificate2($s.RemoteCertificate)).Issuer
# Esperado: CN=WR2, O=Google Trust Services  (se aparecer Norton, a interceptacao voltou)
```

**Se voltar**, os workarounds por runtime — cada um tem truststore proprio e nenhum consulta o do
Windows por padrao:

| Runtime | Sintoma | Correcao |
|---|---|---|
| Python (az CLI) | `CERTIFICATE_VERIFY_FAILED` | `REQUESTS_CA_BUNDLE=~/.azure/cacert-corp.pem` |
| Java (sdkmanager, Gradle) | `Failed to download any source lists!` | `JAVA_OPTS=-Djavax.net.ssl.trustStoreType=Windows-ROOT` |
| Java (downloads grandes) | `(bad_record_mac) Tag mismatch!` | `-Djdk.tls.client.protocols=TLSv1.2` + `--max-workers=2` |
| Node | erro de certificado em fetch/https | `NODE_EXTRA_CA_CERTS=~/.azure/cacert-corp.pem` |
| winget | `0x8a15005e` certificado nao confere | `--source winget` (quem falha e a fonte `msstore`) |

O bundle `~/.azure/cacert-corp.pem` = certifi do az CLI + os 122 CAs do store do Windows.
`deploy-qa.ps1` e `build-apk.ps1` ainda carregam esses flags: sao inofensivos e mantem o build
funcionando caso a protecao seja religada.

**Duas armadilhas do `sdkmanager` no Windows** (ambas fazem ele sair com **exit 0 sem instalar nada**):
1. **Licencas**: canalizar `y` para o `.bat` NAO funciona — ele le do console e ignora o stdin. Gravar
   os hashes em `C:\Android\licenses\android-sdk-license` (e afins), como CI faz.
2. **Exit code mentiroso**: `& $sdkm ... | Select-String ...` faz `$LASTEXITCODE` refletir o
   `Select-String`, nao o sdkmanager. **Sempre conferir no disco** (`Test-Path C:\Android\platform-tools`)
   em vez de confiar na saida do comando.

**Scripts `.ps1` deste repo precisam ser ASCII PURO.** O PowerShell 5.1 le `.ps1` como ANSI quando nao
ha BOM; um travessao ou acento dentro de string corrompe o parser dali em diante.

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
