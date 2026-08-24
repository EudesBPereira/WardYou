import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as zoneService from "../services/zoneService.js";

const upsertSchema = z.object({
  familyId: z.string().uuid(),
  name: z.string().min(1),
  latitude: z.number(),
  longitude: z.number(),
  radiusMeters: z.number().int(),
  notifyOnEntry: z.boolean().default(true),
  notifyOnExit: z.boolean().default(true),
  memberUserIds: z.array(z.string().uuid()).optional(),
});

export async function registerZoneRoutes(app: FastifyInstance) {
  // GET /api/v1/zones?familyId=... — safety zones of a family.
  app.get<{ Querystring: { familyId?: string } }>(
    "/",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const familyId = request.query.familyId;
      if (!familyId) return reply.code(400).send({ message: "familyId é obrigatório." });
      return zoneService.getZones(request.user.sub, familyId);
    },
  );

  // POST /api/v1/zones — create a safety zone (admin/guardian).
  app.post("/", { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = upsertSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Payload de zona inválido." });
    return reply.code(201).send(await zoneService.createZone(request.user.sub, parsed.data));
  });

  // PUT /api/v1/zones/:zoneId — update a safety zone (admin/guardian).
  app.put<{ Params: { zoneId: string } }>(
    "/:zoneId",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const parsed = upsertSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ message: "Payload de zona inválido." });
      return zoneService.updateZone(request.user.sub, request.params.zoneId, parsed.data);
    },
  );

  // DELETE /api/v1/zones/:zoneId — soft-delete a safety zone (admin/guardian).
  app.delete<{ Params: { zoneId: string } }>(
    "/:zoneId",
    { preHandler: app.authenticate },
    async (request, reply) => {
      await zoneService.deleteZone(request.user.sub, request.params.zoneId);
      return reply.code(204).send();
    },
  );
}
