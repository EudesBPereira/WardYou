# Deploying the WardYou API (Node)

The API is a Fastify + Prisma + Socket.IO server that talks to the existing
Azure PostgreSQL (`safefamily` @ `mvp-sf-pg-96164`). It mints its own JWTs.

## 0. Prerequisites (one-time, decisions needed)

- [ ] **Production JWT key** — generate and keep secret:
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
  ```
- [ ] **DB networking** — instead of per-IP firewall rules, allow the App
  Service/container outbound IPs (or use a VNet/Private Endpoint). Remove the
  temporary `claude-introspect` rule once deployed.
- [ ] **CORS_ORIGIN** — set to the real web/app origins.

## Option A — Azure App Service (Node 22)

```bash
# Build artifact
npm run build --workspace apps/api    # → apps/api/dist + generated Prisma client

# App settings (secrets live here, not in the repo)
az webapp config appsettings set -g <rg> -n <app> --settings \
  DATABASE_URL="postgresql://USER:PASS@HOST:5432/safefamily?sslmode=require" \
  JWT_SECRET="<generated>" JWT_ISSUER=WardYou JWT_AUDIENCE=WardYou.App \
  ACCESS_TOKEN_MINUTES=15 REFRESH_TOKEN_DAYS=30 \
  CORS_ORIGIN="https://app.wityu.com" PORT=3000 \
  WEBSITES_PORT=3000

# Startup command
az webapp config set -g <rg> -n <app> --startup-file "node apps/api/dist/server.js"
```

Deploy the repo (or a zip of `apps/api` + root `node_modules`) via
`az webapp deploy` / GitHub Actions. WebSockets must be enabled for Socket.IO:
`az webapp config set -g <rg> -n <app> --web-sockets-enabled true`.

## Option B — Container

```bash
docker build -f apps/api/Dockerfile -t wityu-api .
docker run -p 3000:3000 --env-file apps/api/.env wityu-api
# Push to ACR and deploy to App Service for Containers / Container Apps.
```

## After deploy

- Health check: `GET /health` → 200.
- Realtime handshake: `GET /realtime/?EIO=4&transport=polling` → 200.
- Point the mobile app at the public URL: `apps/mobile/.env`
  `EXPO_PUBLIC_API_BASE_URL=https://<api-host>`.
- Migrations: the schema is owned by the existing DB; this API does **not** run
  migrations (introspected via `prisma db pull`). Do not `prisma migrate` here.
