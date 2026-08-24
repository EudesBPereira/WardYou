import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as consentService from "../services/consentService.js";

const acceptSchema = z.object({
  version: z.string().min(1),
  allowedFromHour: z.number().int().min(0).max(23).optional(),
  allowedToHour: z.number().int().min(0).max(23).optional(),
});
const grantSchema = acceptSchema.extend({ type: z.string().min(1) });

export async function registerConsentRoutes(app: FastifyInstance) {
  // GET /api/v1/consents — the caller's own consents.
  app.get("/consents", { preHandler: app.authenticate }, async (request) =>
    consentService.getMyConsents(request.user.sub),
  );

  // POST /api/v1/consents/:type/accept — grant a user-level consent.
  app.post<{ Params: { type: string } }>(
    "/consents/:type/accept",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const parsed = acceptSchema.safeParse(request.body ?? {});
      if (!parsed.success) return reply.code(400).send({ message: "Payload de consentimento inválido." });
      return consentService.accept(request.user.sub, request.params.type, parsed.data, request.ip);
    },
  );

  // POST /api/v1/consents/:type/revoke — revoke a user-level consent.
  app.post<{ Params: { type: string } }>(
    "/consents/:type/revoke",
    { preHandler: app.authenticate },
    async (request) => consentService.revoke(request.user.sub, request.params.type),
  );

  // GET /api/v1/families/:id/consents — consents granted within a family.
  app.get<{ Params: { id: string } }>(
    "/families/:id/consents",
    { preHandler: app.authenticate },
    async (request) => consentService.getFamilyConsents(request.user.sub, request.params.id),
  );

  // POST /api/v1/families/:id/members/:userId/consent — grant a family consent (admin/guardian).
  app.post<{ Params: { id: string; userId: string } }>(
    "/families/:id/members/:userId/consent",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const parsed = grantSchema.safeParse(request.body ?? {});
      if (!parsed.success) return reply.code(400).send({ message: "Payload de consentimento inválido." });
      return consentService.grantFamilyConsent(
        request.user.sub,
        request.params.id,
        request.params.userId,
        parsed.data,
        request.ip,
      );
    },
  );
}
