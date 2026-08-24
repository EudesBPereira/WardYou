import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as locationService from "../services/locationService.js";

const recordSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  accuracyMeters: z.number().optional(),
  batteryLevel: z.number().int().optional(),
  isCharging: z.boolean().optional(),
  deviceId: z.string().uuid().optional(),
  familyId: z.string().uuid().optional(),
  /** Human-readable place ("Rua X, Bairro"), reverse-geocoded on the device —
   *  the family screens' "Último lugar" column, which had no writer until now. */
  locationLabel: z.string().max(120).optional(),
});

export async function registerLocationRoutes(app: FastifyInstance) {
  // POST /api/v1/locations — report the caller's current position.
  app.post("/locations", { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = recordSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Payload de localização inválido." });
    return reply.code(201).send(await locationService.recordLocation(request.user.sub, parsed.data));
  });
}
