import type { FastifyInstance } from "fastify";

export async function registerHealthRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({ status: "ok", service: "wardyou-api" }));
  app.get("/api/v1/health", async () => ({ status: "ok" }));
}
