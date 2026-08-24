# WardYou API — production container.
# Build context must be the monorepo root (workspaces hoist node_modules):
#   docker build -f apps/api/Dockerfile -t wityu-api .
FROM node:22-alpine AS build
WORKDIR /app

# Install deps (root + api workspace). Copy manifests first for layer caching.
COPY package.json package-lock.json* .npmrc ./
COPY apps/api/package.json ./apps/api/package.json
RUN npm install --workspace apps/api --include-workspace-root --no-audit --no-fund

# Copy sources and build (prisma generate + tsc).
COPY apps/api ./apps/api
RUN npm run build --workspace apps/api

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
# Bring the built app + node_modules (incl. generated Prisma client).
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/prisma ./apps/api/prisma

EXPOSE 3000
WORKDIR /app/apps/api
# Env (DATABASE_URL, JWT_SECRET, …) injected by the platform.
CMD ["node", "dist/server.js"]
