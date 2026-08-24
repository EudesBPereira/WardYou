# @wardyou/api — Node/TypeScript backend (Caminho B)

Fastify + Prisma API that serves the React Native app over the **existing Azure
PostgreSQL** database (kept from the legacy .NET stack — never recreated).

## Status

Skeleton. Routes are stubbed (`501 Not implemented`) with TODOs pointing at the
.NET service they mirror. The domain reference is in
[`../../SCAN_MAUI.md`](../../SCAN_MAUI.md) (§2 entities, §3 enums, §5 endpoints).

## Bring it up (when DB credentials are available)

```bash
cd apps/api
cp .env.example .env          # fill DATABASE_URL + reuse the .NET JWT secret/issuer/audience
npm install                   # from repo root (workspaces)
npm run db:pull               # introspect the existing tables into prisma/schema.prisma
npm run db:generate           # generate the Prisma client
npm run dev                   # http://localhost:3000  (health: /health)
```

## Why introspect instead of migrate

The schema is owned by the production database (EF Core migrations created it).
`prisma db pull` matches Prisma models to the real table/column names so this API
never drifts from production. Do not run `prisma migrate` against it.

## Auth compatibility

To keep existing accounts working, reuse the **same** JWT signing key, issuer and
audience as the .NET API, and verify passwords with the same PBKDF2 scheme
(`Pbkdf2PasswordHasher`). See `src/routes/auth.ts`.

## Porting order (suggested)

1. `auth` (login/register/refresh) — unblocks everything.
2. `families/members`, `travels`, `sos` — the screens already call these.
3. `location`, `consents`, `parental`, `zones`, `elder` — later phases.
