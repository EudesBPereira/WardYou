import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { AppError } from "../lib/errors.js";
import { emitToFamily, emitToUser, emitToUsers } from "../realtime.js";
import { writeAudit } from "../services/auditService.js";
import { pushToUsers } from "../services/pushService.js";

const MEMBER_ACTIVE = 1; // FamilyMemberStatus.Active

const SOS_ACTIVE = 1; // SosStatus.Active
const SOS_ACKNOWLEDGED = 2;
const SOS_CLOSED = 3;
const LOCATION_SOURCE_SOS = 3; // LocationSourceType.Sos

const SOS_STATUS_NAMES: Record<number, "active" | "acknowledged" | "closed"> = {
  1: "active",
  2: "acknowledged",
  3: "closed",
};

const triggerSchema = z.object({
  familyId: z.string().uuid().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  sendLocation: z.boolean().default(false),
});

export async function registerSosRoutes(app: FastifyInstance) {
  // POST /api/v1/sos — trigger an SOS (optionally with location + family).
  app.post("/", { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = triggerSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ message: "Payload de SOS inválido." });
    const { familyId, latitude, longitude, sendLocation } = parsed.data;
    const userId = request.user.sub;
    const now = new Date();

    let locationEventId: string | null = null;
    if (sendLocation && latitude !== undefined && longitude !== undefined) {
      const loc = await prisma.location_events.create({
        data: {
          Id: randomUUID(),
          UserId: userId,
          Latitude: latitude,
          Longitude: longitude,
          SourceType: LOCATION_SOURCE_SOS,
          FamilyId: familyId ?? null,
          CapturedAt: now,
          ReceivedAt: now,
        },
      });
      locationEventId = loc.Id;
    }

    const sos = await prisma.sos_events.create({
      data: {
        Id: randomUUID(),
        TriggeredByUserId: userId,
        FamilyId: familyId ?? null,
        LocationEventId: locationEventId,
        Status: SOS_ACTIVE,
        TriggeredAt: now,
      },
    });

    await writeAudit({ actorUserId: userId, action: "SosTriggered", sourceType: "Sos", familyId: familyId ?? null, metadata: { sosId: sos.Id } });
    if (familyId) {
      emitToFamily(familyId, "SosTriggered", {
        id: sos.Id,
        userId,
        latitude: latitude ?? null,
        longitude: longitude ?? null,
        triggeredAt: sos.TriggeredAt.toISOString(),
      });
      // High-priority OS push to every family member except the triggerer —
      // an SOS must reach them even with the app closed.
      const [triggerer, members] = await Promise.all([
        prisma.users.findFirst({ where: { Id: userId }, select: { FullName: true } }),
        prisma.family_members.findMany({
          where: { FamilyId: familyId, Status: MEMBER_ACTIVE, UserId: { not: null } },
          select: { UserId: true },
        }),
      ]);
      const recipientIds = members.map((m) => m.UserId!).filter((id) => id && id !== userId);
      pushToUsers(recipientIds, {
        title: "🆘 SOS acionado",
        body: `${triggerer?.FullName ?? "Um familiar"} precisa de ajuda.`,
        data: { type: "sos", sosId: sos.Id, familyId },
        highPriority: true,
      });
    }

    // Travel companions: an SOS must also reach the active trips' members who
    // opted into ReceiveSosAlerts — they may not share a family with the
    // triggerer at all (traveler mode). Additive: family flow above unchanged.
    try {
      const memberships = await prisma.travel_group_members.findMany({
        where: { UserId: userId, IsActive: true, LeftAt: null },
        select: { TravelGroupId: true },
      });
      const tripIds = memberships.map((m) => m.TravelGroupId);
      if (tripIds.length > 0) {
        const activeTrips = await prisma.travel_groups.findMany({
          where: { Id: { in: tripIds }, IsActive: true, EndsAt: { gt: now } },
          select: { Id: true, Name: true },
        });
        if (activeTrips.length > 0) {
          // UserId is non-nullable on travel_group_members (unlike family_members).
          const companions = await prisma.travel_group_members.findMany({
            where: {
              TravelGroupId: { in: activeTrips.map((t) => t.Id) },
              IsActive: true,
              LeftAt: null,
              ReceiveSosAlerts: true,
            },
            select: { UserId: true },
          });
          // Family recipients already got realtime+push above — don't double-alert.
          const familyMemberIds = familyId
            ? new Set(
                (
                  await prisma.family_members.findMany({
                    where: { FamilyId: familyId, Status: MEMBER_ACTIVE, UserId: { not: null } },
                    select: { UserId: true },
                  })
                ).map((m) => m.UserId!),
              )
            : new Set<string>();
          const companionIds = [
            ...new Set(
              companions
                .map((c) => c.UserId)
                .filter((id) => id !== userId && !familyMemberIds.has(id)),
            ),
          ];
          if (companionIds.length > 0) {
            const who = await prisma.users.findFirst({ where: { Id: userId }, select: { FullName: true } });
            const tripName = activeTrips[0].Name;
            emitToUsers(companionIds, "SosTriggered", {
              id: sos.Id,
              userId,
              latitude: latitude ?? null,
              longitude: longitude ?? null,
              triggeredAt: sos.TriggeredAt.toISOString(),
            });
            pushToUsers(companionIds, {
              title: "🆘 SOS no trajeto",
              body: `${who?.FullName ?? "Um viajante"} precisa de ajuda (${tripName}).`,
              data: { type: "sos", sosId: sos.Id },
              highPriority: true,
            });
          }
        }
      }
    } catch {
      /* trip alerting is best-effort — the SOS itself is already persisted */
    }

    return reply.code(201).send({
      id: sos.Id,
      status: "active",
      triggeredAt: sos.TriggeredAt.toISOString(),
      latitude: latitude ?? null,
      longitude: longitude ?? null,
    });
  });

  // GET /api/v1/sos/active — the user's currently active SOS events.
  app.get("/active", { preHandler: app.authenticate }, async (request) => {
    const sos = await prisma.sos_events.findMany({
      where: { TriggeredByUserId: request.user.sub, Status: SOS_ACTIVE },
      orderBy: { TriggeredAt: "desc" },
      include: { location_events: { select: { Latitude: true, Longitude: true } } },
    });
    return sos.map(mapSos);
  });

  // GET /api/v1/sos/:sosId — detail of a single SOS event the user triggered.
  app.get<{ Params: { sosId: string } }>("/:sosId", { preHandler: app.authenticate }, async (request) => {
    const sos = await prisma.sos_events.findFirst({
      where: { Id: request.params.sosId, TriggeredByUserId: request.user.sub },
      include: { location_events: { select: { Latitude: true, Longitude: true } } },
    });
    if (!sos) throw new AppError("SosNotFound", "Evento de SOS não encontrado.", 404);
    return mapSos(sos);
  });

  // PUT /api/v1/sos/:sosId/acknowledge — mark an active SOS as acknowledged.
  app.put<{ Params: { sosId: string } }>("/:sosId/acknowledge", { preHandler: app.authenticate }, async (request) => {
    const sos = await loadSos(request.params.sosId);
    const updated = await prisma.sos_events.update({
      where: { Id: sos.Id },
      data: { Status: SOS_ACKNOWLEDGED, AcknowledgedAt: new Date(), AcknowledgedByUserId: request.user.sub },
      include: { location_events: { select: { Latitude: true, Longitude: true } } },
    });
    emitToUser(updated.TriggeredByUserId, "SosUpdated", { id: updated.Id, status: "acknowledged" });
    if (updated.FamilyId) emitToFamily(updated.FamilyId, "SosUpdated", { id: updated.Id, status: "acknowledged" });
    await writeAudit({ actorUserId: request.user.sub, action: "SosAcknowledged", sourceType: "Sos", targetUserId: updated.TriggeredByUserId, familyId: updated.FamilyId, metadata: { sosId: updated.Id } });
    return mapSos(updated);
  });

  // PUT /api/v1/sos/:sosId/close — close an SOS event.
  app.put<{ Params: { sosId: string } }>("/:sosId/close", { preHandler: app.authenticate }, async (request) => {
    const sos = await loadSos(request.params.sosId);
    const updated = await prisma.sos_events.update({
      where: { Id: sos.Id },
      data: { Status: SOS_CLOSED, ClosedAt: new Date(), ClosedByUserId: request.user.sub },
      include: { location_events: { select: { Latitude: true, Longitude: true } } },
    });
    emitToUser(updated.TriggeredByUserId, "SosUpdated", { id: updated.Id, status: "closed" });
    if (updated.FamilyId) emitToFamily(updated.FamilyId, "SosUpdated", { id: updated.Id, status: "closed" });
    await writeAudit({ actorUserId: request.user.sub, action: "SosClosed", sourceType: "Sos", targetUserId: updated.TriggeredByUserId, familyId: updated.FamilyId, metadata: { sosId: updated.Id } });
    return mapSos(updated);
  });
}

interface SosRow {
  Id: string;
  Status: number;
  TriggeredAt: Date;
  location_events: { Latitude: number; Longitude: number } | null;
}

function mapSos(s: SosRow) {
  return {
    id: s.Id,
    status: SOS_STATUS_NAMES[s.Status] ?? "active",
    triggeredAt: s.TriggeredAt.toISOString(),
    latitude: s.location_events?.Latitude ?? null,
    longitude: s.location_events?.Longitude ?? null,
  };
}

async function loadSos(sosId: string) {
  const sos = await prisma.sos_events.findFirst({ where: { Id: sosId } });
  if (!sos) throw new AppError("SosNotFound", "Evento de SOS não encontrado.", 404);
  return sos;
}
