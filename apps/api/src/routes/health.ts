import type { FastifyInstance } from "fastify";
import { isPushConfigured } from "../lib/fcm.js";

export async function registerHealthRoutes(app: FastifyInstance) {
  // `push` responde a pergunta que nao dava para responder de fora: a API tem
  // credencial de FCM valida? Sem ela, `sendPush` vira no-op SILENCIOSO — SOS,
  // alertas de zona e pedidos de liberacao simplesmente nao chegam, sem erro
  // em lugar nenhum. Num app de seguranca, "push desligado" precisa ser um
  // estado observavel, nao uma descoberta em campo.
  app.get("/health", async () => ({
    status: "ok",
    service: "wardyou-api",
    push: isPushConfigured() ? "configured" : "disabled",
  }));
  app.get("/api/v1/health", async () => ({ status: "ok" }));
}
