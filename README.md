# WardYou — React Native rebuild

Monorepo (npm workspaces) for the rebuilt WardYou family-safety client.

- `apps/mobile` — Expo (SDK 56) app: Expo Router, TypeScript (strict), NativeWind v4,
  Reanimated 4, i18next, Zustand, TanStack Query, react-native-maps (Google).
- `apps/api` — Node/TypeScript API over the existing Azure PostgreSQL (added in Phase 4).

The legacy .NET MAUI client is discarded; the existing Azure DB is kept.
Domain audit: [SCAN_MAUI.md](./SCAN_MAUI.md). Plan: [PROMPT_Migracao_Wityu_MAUI_para_ReactNative.md](./PROMPT_Migracao_Wityu_MAUI_para_ReactNative.md).

## Run the web preview

```bash
npm install                 # at repo root (installs all workspaces)
npm run mobile:web          # → opens http://localhost:8081 (press w / opens browser)
```

Other commands:

```bash
npm run mobile              # Expo dev server (choose platform)
npm run mobile:android      # Android device/emulator
npm run mobile:typecheck    # tsc --noEmit
```

Copy `apps/mobile/.env.example` → `apps/mobile/.env` and fill secrets (Maps keys, OAuth, API URL).

## Phase status

- [x] Phase -1 — MAUI scan (`SCAN_MAUI.md`)
- [x] Phase 0 — Setup (Expo + Router + NativeWind + RQ + Zustand + i18n stack; web build validated)
- [x] Phase 1 — Design system + tokens ("Guardião Sereno": tokens, Sora/Inter/JetBrains fonts, UI kit, kitchen sink)
- [x] Phase 2 — Navigation (Expo Router Tabs + custom BottomNav) + 5 screen shells + runtime i18n pt/en/es/fr
- [x] Phase 3 — Screens: Splash (boot gate + logo reuse), Home, Family, Trips, SOS, Settings (mock data)
- [~] Phase 4 — Integration layer done (typed HTTP client + auth/refresh, Zustand session, React Query hooks w/ mock fallback). Node API skeleton in `apps/api` — needs DB credentials + `prisma db pull` to go live.
- [~] Phase 5 — Cross-platform native services with web stubs (geolocation, MapPreview web/native split, push stub). On-device wiring (real GPS/maps keys/FCM) pending device + secrets.

## What's needed to go live (from you)

- **Google Maps API keys** (Android, iOS, and Maps JS for web) → fill `apps/mobile/.env`.
- **Azure PostgreSQL connection string** + the **.NET JWT secret/issuer/audience** → `apps/api/.env`, then `npm run db:pull`.
- **Social login** Google/Facebook client IDs + `wityu://` redirect (if keeping social login).
- Confirm reuse of the original WardYou logo (already reused on Splash).
