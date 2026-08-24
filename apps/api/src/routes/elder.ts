import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as elder from "../services/elderService.js";

const upsertSchema = z.object({
  medications: z.array(
    z.object({
      name: z.string().min(1),
      dosage: z.string().optional(),
      times: z.array(z.string()),
      daysOfWeek: z.number().int(),
    }),
  ),
});

export async function registerElderRoutes(app: FastifyInstance) {
  const auth = { preHandler: app.authenticate };

  // GET /api/v1/elder/elders — elder members the caller manages.
  app.get("/elders", auth, async (req) => elder.getElders(req.user.sub));

  // GET /api/v1/elder/medications/my — the caller's own medication schedule.
  app.get("/medications/my", auth, async (req) => elder.getMyMedications(req.user.sub));

  // GET /api/v1/elder/:elderUserId/medications — an elder's schedule (self or tutor).
  app.get<{ Params: { elderUserId: string } }>("/:elderUserId/medications", auth, async (req) =>
    elder.getMedications(req.user.sub, req.params.elderUserId),
  );

  // PUT /api/v1/elder/:elderUserId/medications — replace an elder's schedule (tutor).
  app.put<{ Params: { elderUserId: string } }>("/:elderUserId/medications", auth, async (req, reply) => {
    const p = upsertSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ message: "Payload de medicação inválido." });
    return elder.upsertMedications(req.user.sub, req.params.elderUserId, p.data.medications);
  });

  // POST /api/v1/elder/check-in — the elder confirms they're okay today.
  app.post("/check-in", auth, async (req) => {
    const p = z.object({ note: z.string().max(280).optional() }).safeParse(req.body ?? {});
    return elder.checkIn(req.user.sub, p.success ? p.data.note : undefined);
  });

  // GET /api/v1/elder/check-in/my — the caller's own check-in status.
  app.get("/check-in/my", auth, async (req) => elder.getMyCheckInStatus(req.user.sub));

  // GET /api/v1/elder/:elderUserId/check-in — an elder's check-in status (self or tutor).
  app.get<{ Params: { elderUserId: string } }>("/:elderUserId/check-in", auth, async (req) =>
    elder.getCheckInStatus(req.user.sub, req.params.elderUserId),
  );

  // GET /api/v1/elder/:elderUserId/check-in/history?days=7 — check-in history (self or tutor).
  app.get<{ Params: { elderUserId: string }; Querystring: { days?: string } }>(
    "/:elderUserId/check-in/history",
    auth,
    async (req) => {
      const days = Math.min(30, Math.max(1, parseInt(req.query.days ?? "7", 10) || 7));
      return elder.getCheckInHistory(req.user.sub, req.params.elderUserId, days);
    },
  );

  // POST /api/v1/elder/medications/:medicationId/taken — the elder confirms a dose.
  app.post<{ Params: { medicationId: string } }>("/medications/:medicationId/taken", auth, async (req, reply) => {
    const p = z.object({ time: z.string().regex(/^\d{2}:\d{2}$/) }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ message: "Horário inválido (HH:mm)." });
    return elder.markMedicationTaken(req.user.sub, req.params.medicationId, p.data.time);
  });

  // GET /api/v1/elder/adherence/my — today's confirmed doses (the elder's own).
  app.get("/adherence/my", auth, async (req) => elder.getTodayAdherence(req.user.sub, req.user.sub));

  // GET /api/v1/elder/:elderUserId/adherence — today's confirmed doses (self or tutor).
  app.get<{ Params: { elderUserId: string } }>("/:elderUserId/adherence", auth, async (req) =>
    elder.getTodayAdherence(req.user.sub, req.params.elderUserId),
  );
}
