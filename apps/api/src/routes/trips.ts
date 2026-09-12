import { randomInt, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { AppError } from "../lib/errors.js";
import { emitToUsers } from "../realtime.js";
import { pushToUsers } from "../services/pushService.js";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
// LocationSourceType.Travel (legacy domain enum) — a travel-group broadcast.
const LOCATION_SOURCE_TRAVEL = 2;
// A member is "online" on the trip map if their last fix is this recent. Kept
// generous (not just a couple of minutes) because aggressive Android OEMs
// (MIUI/EMUI…) throttle background location to one fix every few minutes even
// with a running foreground service — a tighter window made live travelers
// flicker "offline" between heartbeats. The exact "last seen" time is always
// shown alongside, so staleness stays visible.
const ONLINE_WINDOW_MS = 10 * 60_000;
// Trip-map viewers trigger a silent "resume tracking" data push to members
// whose device stopped transmitting (no fix, or last fix older than this).
// Throttled per user so the 10s map poll doesn't spam FCM.
const RESUME_NUDGE_STALE_MS = 2 * 60_000;
const RESUME_NUDGE_THROTTLE_MS = 5 * 60_000;
/**
 * Teto por usuario da cutucada de retomada. BEST-EFFORT, de proposito, e nao
 * de-se a ele mais confianca do que ele merece:
 *
 *  - E um Map EM MEMORIA de modulo. O Container App roda com `min-replicas 0`
 *    (ver CLAUDE.md), entao um cold start ZERA este teto -- duas tentativas
 *    separadas por um adormecimento do conteiner podem cutucar duas vezes
 *    dentro da mesma janela de 5min.
 *  - Se algum dia rodar com mais de uma replica, o teto passa a ser POR
 *    REPLICA: N replicas => ate N vezes mais cutucadas.
 *
 * Isso e aceitavel para o que ele protege (uma push silenciosa a mais nao
 * machuca ninguem), mas NAO serve como garantia de volume. Se um dia precisar
 * ser garantia, tem que sair da memoria e ir para o banco.
 */
const lastResumeNudgeAt = new Map<string, number>();

/**
 * Ultima vez que uma viagem foi ESCANEADA em busca de membros parados, a
 * partir do caminho de POST de localizacao. Existe por custo, nao por
 * corretude: `POST /:id/location` roda a cada ~10s POR MEMBRO, e varrer as
 * ultimas posicoes de todo mundo a cada post multiplicaria a carga de banco
 * pelo numero de membros. Um escaneamento por minuto por viagem e suficiente
 * -- o teto real de quem recebe cutucada continua sendo o de 5min por usuario.
 */
const lastNudgeScanAt = new Map<string, number>();
const NUDGE_SCAN_INTERVAL_MS = 60_000;

/** Realtime + (optional) push to every active member of a trip. Best-effort. */
async function notifyTripMembers(
  tripId: string,
  event: string,
  opts: { excludePush?: string; push?: { title: string; body: string } },
): Promise<void> {
  try {
    const members = await activeTripMembers(tripId);
    const memberIds = members.map((m) => m.UserId).filter((x): x is string => !!x);
    if (memberIds.length === 0) return;
    emitToUsers(memberIds, event, { travelGroupId: tripId });
    if (opts.push) {
      const recipients = memberIds.filter((id) => id !== opts.excludePush);
      if (recipients.length > 0) {
        pushToUsers(recipients, {
          ...opts.push,
          data: { type: "trip", travelGroupId: tripId },
        });
      }
    }
  } catch {
    /* notifications are best-effort */
  }
}
const TRIP_TYPE_TO_INT: Record<string, number> = { individual: 1, group: 2, temporary: 3 };
const TRIP_TYPE_NAMES: Record<number, "individual" | "group" | "temporary"> = {
  1: "individual",
  2: "group",
  3: "temporary",
};

interface TripRow {
  Id: string;
  Name: string;
  Type: number;
  IsActive: boolean;
  StartsAt: Date;
  EndsAt: Date;
  ClosedAt: Date | null;
  _count: { travel_group_members: number };
}

function mapTrip(g: TripRow) {
  return {
    id: g.Id,
    name: g.Name,
    type: TRIP_TYPE_NAMES[g.Type] ?? "group",
    isActive: g.IsActive && g.EndsAt > new Date(),
    startsAt: g.StartsAt.toISOString(),
    endsAt: g.EndsAt.toISOString(),
    memberCount: g._count.travel_group_members,
    closedAt: g.ClosedAt?.toISOString() ?? null,
  };
}

/**
 * The old .NET worker used to sweep the DB and auto-close travel groups past
 * their `EndsAt` (see SUMMARY.md — that worker was retired and never
 * replicated here). Rather than stand up a separate cron process, this closes
 * them lazily whenever the list is read — same pattern already used for
 * expired extra-time requests in parentalService.ts. Cheap: both `EndsAt` and
 * `IsActive` are indexed.
 */
async function closeOverdueTravelGroups(): Promise<void> {
  await prisma.travel_groups.updateMany({
    where: { IsActive: true, EndsAt: { lte: new Date() } },
    data: { IsActive: false, ClosedAt: new Date() },
  });
}

const activeMemberCount = { _count: { select: { travel_group_members: { where: { IsActive: true } } } } } as const;

const createSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["individual", "group", "temporary"]).default("group"),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  allowMembersToSeeEachOther: z.boolean().default(true),
  shareLiveLocation: z.boolean().default(true),
  shareBatteryStatus: z.boolean().default(true),
  receiveSosAlerts: z.boolean().default(true),
});

async function ownedTrip(travelGroupId: string, userId: string) {
  const trip = await prisma.travel_groups.findFirst({ where: { Id: travelGroupId } });
  if (!trip) throw new AppError("TravelNotFound", "Trajeto não encontrado.", 404);
  if (trip.CreatedByUserId !== userId) {
    throw new AppError("Forbidden", "Apenas o criador pode executar esta ação.", 403);
  }
  return trip;
}

/** Trip visible to the caller: they created it or are an active member. */
async function accessibleTrip(travelGroupId: string, userId: string) {
  const trip = await prisma.travel_groups.findFirst({
    where: {
      Id: travelGroupId,
      OR: [
        { CreatedByUserId: userId },
        { travel_group_members: { some: { UserId: userId, IsActive: true } } },
      ],
    },
  });
  if (!trip) throw new AppError("TravelNotFound", "Trajeto não encontrado.", 404);
  return trip;
}

interface TripMemberRow {
  Id: string;
  UserId: string;
  ShareLiveLocation: boolean;
  ShareBatteryStatus: boolean;
  ReceiveSosAlerts: boolean;
  JoinedAt: Date;
  users: { FullName: string; AvatarUrl: string | null };
}

async function activeTripMembers(travelGroupId: string): Promise<TripMemberRow[]> {
  return prisma.travel_group_members.findMany({
    where: { TravelGroupId: travelGroupId, IsActive: true, LeftAt: null },
    orderBy: { JoinedAt: "asc" },
    include: { users: { select: { FullName: true, AvatarUrl: true } } },
  });
}

/**
 * Acorda em silencio os membros desta viagem cuja posicao parou de chegar.
 *
 * A push de dados (alta prioridade -- `dataOnly` forca isso em lib/fcm.ts)
 * dispara a tarefa de segundo plano do app, que reinicia o servico de
 * localizacao sem nenhuma interacao do usuario.
 *
 * Chamada de DOIS lugares, de proposito:
 *  - `GET /:id/map`  alguem esta OLHANDO a viagem;
 *  - `POST /:id/location`  alguem esta TRANSMITINDO nela.
 *
 * O segundo existe porque o primeiro sozinho so recupera quando ha uma pessoa
 * com a tela aberta -- e quem mais precisa da recuperacao e justamente o pai
 * que NAO esta olhando. Com o segundo, enquanto UM membro transmite ele mantem
 * os outros vivos, que e a viagem assimetrica comum (um dirigindo com o app
 * aberto, os outros com o telefone no bolso).
 *
 * NAO VIRA PINGUE-PONGUE, e isto e o ponto a nao "otimizar" depois: o teto de
 * `RESUME_NUDGE_THROTTLE_MS` (5min) e por USUARIO ALVO e e gravado no momento
 * em que a cutucada e decidida. Se A cutuca B, B fica travado por 5min; quando
 * B volta e passa a transmitir, a tentativa dele de cutucar A so passa se A
 * estiver parado E fora do proprio teto de A. Dois membros ativos nunca se
 * cutucam, porque `RESUME_NUDGE_STALE_MS` ja exclui quem transmitiu nos
 * ultimos 2min. Remover qualquer um dos dois filtros reabre o ciclo.
 */
function nudgeStaleTripMembers(
  trip: { Id: string; IsActive: boolean; EndsAt: Date },
  members: TripMemberRow[],
  latestByUser: Map<string, { ReceivedAt: Date }>,
  callerUserId: string,
  now: number,
): void {
  if (!trip.IsActive || trip.EndsAt <= new Date()) return;
  const staleIds = members
    .filter((m) => {
      if (!m.UserId || m.UserId === callerUserId || !m.ShareLiveLocation) return false;
      const loc = latestByUser.get(m.UserId);
      if (loc && now - loc.ReceivedAt.getTime() <= RESUME_NUDGE_STALE_MS) return false;
      const last = lastResumeNudgeAt.get(m.UserId) ?? 0;
      if (now - last < RESUME_NUDGE_THROTTLE_MS) return false;
      lastResumeNudgeAt.set(m.UserId, now);
      return true;
    })
    .map((m) => m.UserId);
  if (staleIds.length === 0) return;
  void pushToUsers(staleIds, {
    title: "",
    body: "",
    dataOnly: true,
    data: { type: "trip-resume", travelGroupId: trip.Id },
  });
}

/**
 * Whether `viewerId` may see `memberId`'s position on this trip. Port of the
 * .NET temp-consent rule, collapsed to its effective behavior: the member must
 * be sharing (ShareLiveLocation) and the trip must allow members to see each
 * other — the creator and the member themselves always can.
 */
function canViewTripLocation(
  trip: { CreatedByUserId: string; AllowMembersToSeeEachOther: boolean },
  member: { UserId: string; ShareLiveLocation: boolean },
  viewerId: string,
) {
  if (member.UserId === viewerId) return true;
  if (!member.ShareLiveLocation) return false;
  return trip.AllowMembersToSeeEachOther || trip.CreatedByUserId === viewerId;
}

async function uniqueInviteCode(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    let code = "";
    for (let j = 0; j < 8; j++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    const taken = await prisma.travel_invites.findFirst({ where: { InviteCode: code }, select: { Id: true } });
    if (!taken) return code;
  }
  throw new AppError("CodeGenerationFailed", "Não foi possível gerar um código de convite.", 500);
}

export async function registerTripsRoutes(app: FastifyInstance) {
  // GET /api/v1/travels — the user's travel groups (active + history).
  app.get("/", { preHandler: app.authenticate }, async (request) => {
    const userId = request.user.sub;
    await closeOverdueTravelGroups();
    const groups = await prisma.travel_groups.findMany({
      where: {
        OR: [
          { CreatedByUserId: userId },
          { travel_group_members: { some: { UserId: userId, IsActive: true } } },
        ],
      },
      orderBy: [{ IsActive: "desc" }, { StartsAt: "desc" }],
      include: activeMemberCount,
    });
    return groups.map(mapTrip);
  });

  // POST /api/v1/travels — create a travel group (creator becomes a member).
  app.post("/", { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Payload de trajeto inválido." });
    const d = parsed.data;
    const userId = request.user.sub;
    const now = new Date();
    const startsAt = d.startsAt ? new Date(d.startsAt) : now;
    const endsAt = d.endsAt ? new Date(d.endsAt) : new Date(now.getTime() + 4 * 60 * 60_000);
    if (endsAt <= startsAt) {
      return reply.code(400).send({ message: "O fim do trajeto deve ser após o início." });
    }

    const id = randomUUID();
    await prisma.travel_groups.create({
      data: {
        Id: id,
        Name: d.name.trim(),
        CreatedByUserId: userId,
        Type: TRIP_TYPE_TO_INT[d.type],
        StartsAt: startsAt,
        EndsAt: endsAt,
        AllowMembersToSeeEachOther: d.allowMembersToSeeEachOther,
        IsActive: true,
        CreatedAt: now,
        travel_group_members: {
          create: {
            Id: randomUUID(),
            UserId: userId,
            ShareLiveLocation: d.shareLiveLocation,
            ShareBatteryStatus: d.shareBatteryStatus,
            ReceiveSosAlerts: d.receiveSosAlerts,
            JoinedAt: now,
            IsActive: true,
          },
        },
      },
    });
    const created = await prisma.travel_groups.findUniqueOrThrow({ where: { Id: id }, include: activeMemberCount });
    return reply.code(201).send(mapTrip(created));
  });

  // GET /api/v1/travels/:id — travel detail (member or creator only).
  app.get<{ Params: { id: string } }>("/:id", { preHandler: app.authenticate }, async (request) => {
    const userId = request.user.sub;
    await closeOverdueTravelGroups();
    const trip = await prisma.travel_groups.findFirst({
      where: {
        Id: request.params.id,
        OR: [
          { CreatedByUserId: userId },
          { travel_group_members: { some: { UserId: userId, IsActive: true } } },
        ],
      },
      include: activeMemberCount,
    });
    if (!trip) throw new AppError("TravelNotFound", "Trajeto não encontrado.", 404);
    return mapTrip(trip);
  });

  // PUT /api/v1/travels/:id — update a travel (creator only).
  app.put<{ Params: { id: string } }>("/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const userId = request.user.sub;
    const trip = await ownedTrip(request.params.id, userId);
    if (!trip.IsActive) throw new AppError("TravelClosed", "O trajeto já está encerrado.", 409);

    const parsed = z
      .object({
        name: z.string().min(1).optional(),
        type: z.enum(["individual", "group", "temporary"]).optional(),
        endsAt: z.string().datetime().optional(),
        allowMembersToSeeEachOther: z.boolean().optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Payload de trajeto inválido." });
    const d = parsed.data;

    const endsAt = d.endsAt ? new Date(d.endsAt) : undefined;
    if (endsAt && endsAt <= trip.StartsAt) {
      return reply.code(400).send({ message: "O fim do trajeto deve ser após o início." });
    }

    await prisma.travel_groups.update({
      where: { Id: trip.Id },
      data: {
        ...(d.name ? { Name: d.name.trim() } : {}),
        ...(d.type ? { Type: TRIP_TYPE_TO_INT[d.type] } : {}),
        ...(endsAt ? { EndsAt: endsAt } : {}),
        ...(d.allowMembersToSeeEachOther !== undefined
          ? { AllowMembersToSeeEachOther: d.allowMembersToSeeEachOther }
          : {}),
      },
    });
    const updated = await prisma.travel_groups.findUniqueOrThrow({ where: { Id: trip.Id }, include: activeMemberCount });
    return mapTrip(updated);
  });

  // GET /api/v1/travels/:id/members — active members of a travel.
  app.get<{ Params: { id: string } }>("/:id/members", { preHandler: app.authenticate }, async (request) => {
    const userId = request.user.sub;
    const trip = await accessibleTrip(request.params.id, userId);
    const members = await activeTripMembers(trip.Id);
    return members.map((m) => ({
      id: m.Id,
      userId: m.UserId,
      fullName: m.users.FullName,
      isCreator: m.UserId === trip.CreatedByUserId,
      isMe: m.UserId === userId,
      shareLiveLocation: m.ShareLiveLocation,
      shareBatteryStatus: m.ShareBatteryStatus,
      receiveSosAlerts: m.ReceiveSosAlerts,
      joinedAt: m.JoinedAt.toISOString(),
    }));
  });

  // GET /api/v1/travels/:id/map — members with their latest travel position.
  app.get<{ Params: { id: string } }>("/:id/map", { preHandler: app.authenticate }, async (request) => {
    const userId = request.user.sub;
    const trip = await accessibleTrip(request.params.id, userId);
    const members = await activeTripMembers(trip.Id);

    const latest = await prisma.location_events.findMany({
      where: {
        TravelGroupId: trip.Id,
        SourceType: LOCATION_SOURCE_TRAVEL,
        UserId: { in: members.map((m) => m.UserId) },
      },
      orderBy: [{ UserId: "asc" }, { ReceivedAt: "desc" }],
      distinct: ["UserId"],
    });
    const latestByUser = new Map(latest.map((e) => [e.UserId, e]));

    const now = Date.now();

    nudgeStaleTripMembers(trip, members, latestByUser, userId, now);

    return {
      travelGroupId: trip.Id,
      name: trip.Name,
      startsAt: trip.StartsAt.toISOString(),
      endsAt: trip.EndsAt.toISOString(),
      isActive: trip.IsActive && trip.EndsAt > new Date(),
      allowMembersToSeeEachOther: trip.AllowMembersToSeeEachOther,
      createdByUserId: trip.CreatedByUserId,
      members: members.map((m) => {
        const loc = latestByUser.get(m.UserId);
        const canView = canViewTripLocation(trip, m, userId);
        const show = canView && loc;
        const canViewBattery = m.UserId === userId || (m.ShareBatteryStatus && canView);
        return {
          userId: m.UserId,
          fullName: m.users.FullName,
          avatarUrl: m.users.AvatarUrl ?? null,
          isMe: m.UserId === userId,
          isCreator: m.UserId === trip.CreatedByUserId,
          isOnline: !!loc && now - loc.ReceivedAt.getTime() <= ONLINE_WINDOW_MS,
          canViewLocation: canView,
          latitude: show ? loc!.Latitude : null,
          longitude: show ? loc!.Longitude : null,
          accuracyMeters: show ? loc!.AccuracyMeters : null,
          batteryLevel: canViewBattery && loc ? loc.BatteryLevel : null,
          capturedAt: show ? loc!.CapturedAt.toISOString() : null,
        };
      }),
    };
  });

  // POST /api/v1/travels/:id/location — broadcast the caller's GPS to the trip.
  app.post<{ Params: { id: string } }>("/:id/location", { preHandler: app.authenticate }, async (request, reply) => {
    const userId = request.user.sub;
    const body = z
      .object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        accuracyMeters: z.number().nonnegative().optional(),
        batteryLevel: z.number().int().min(0).max(100).optional(),
        isCharging: z.boolean().optional(),
        capturedAt: z.string().datetime().optional(),
      })
      .safeParse(request.body);
    if (!body.success) return reply.code(400).send({ message: "Payload de localização inválido." });
    const d = body.data;

    const member = await prisma.travel_group_members.findFirst({
      where: { TravelGroupId: request.params.id, UserId: userId, IsActive: true, LeftAt: null },
    });
    if (!member) throw new AppError("NotFound", "Você não é membro ativo deste trajeto.", 404);
    if (!member.ShareLiveLocation) {
      throw new AppError("Forbidden", "Você não autorizou o compartilhamento de localização neste trajeto.", 403);
    }
    const trip = await prisma.travel_groups.findFirst({ where: { Id: request.params.id, IsActive: true } });
    if (!trip || trip.EndsAt <= new Date()) {
      throw new AppError("Gone", "Este trajeto já foi encerrado.", 410);
    }

    const now = new Date();
    const event = await prisma.location_events.create({
      data: {
        Id: randomUUID(),
        UserId: userId,
        DeviceId: null,
        Latitude: d.latitude,
        Longitude: d.longitude,
        AccuracyMeters: d.accuracyMeters ?? null,
        BatteryLevel: d.batteryLevel ?? null,
        IsCharging: d.isCharging ?? null,
        SourceType: LOCATION_SOURCE_TRAVEL,
        TravelGroupId: trip.Id,
        CapturedAt: d.capturedAt ? new Date(d.capturedAt) : now,
        ReceivedAt: now,
      },
    });

    // Live push to every member allowed to see this position (best-effort).
    try {
      const members = await activeTripMembers(trip.Id);

      // Quem transmite mantem os outros vivos -- ver nudgeStaleTripMembers.
      // O escaneamento e limitado a 1x/min POR VIAGEM porque este handler roda
      // a cada ~10s por membro: sem isso, a consulta das ultimas posicoes
      // rodaria a cada post, multiplicando a carga pelo numero de membros.
      const ultimoScan = lastNudgeScanAt.get(trip.Id) ?? 0;
      if (now.getTime() - ultimoScan >= NUDGE_SCAN_INTERVAL_MS) {
        lastNudgeScanAt.set(trip.Id, now.getTime());
        const ultimas = await prisma.location_events.findMany({
          where: {
            TravelGroupId: trip.Id,
            SourceType: LOCATION_SOURCE_TRAVEL,
            UserId: { in: members.map((m) => m.UserId) },
          },
          orderBy: [{ UserId: "asc" }, { ReceivedAt: "desc" }],
          distinct: ["UserId"],
        });
        nudgeStaleTripMembers(
          trip,
          members,
          new Map(ultimas.map((e) => [e.UserId, e])),
          userId,
          now.getTime(),
        );
      }
      const recipients = members
        .filter((m) => canViewTripLocation(trip, { UserId: userId, ShareLiveLocation: true }, m.UserId))
        .map((m) => m.UserId);
      emitToUsers(recipients, "TravelLocationUpdated", {
        travelGroupId: trip.Id,
        userId,
        latitude: event.Latitude,
        longitude: event.Longitude,
        capturedAt: event.CapturedAt.toISOString(),
      });
    } catch {
      /* realtime is best-effort */
    }

    return reply.code(201).send({ id: event.Id, capturedAt: event.CapturedAt.toISOString() });
  });

  // POST /api/v1/travels/:id/close — close a travel (creator only).
  app.post<{ Params: { id: string } }>("/:id/close", { preHandler: app.authenticate }, async (request) => {
    const userId = request.user.sub;
    await ownedTrip(request.params.id, userId);
    await prisma.travel_groups.update({
      where: { Id: request.params.id },
      data: { IsActive: false, ClosedAt: new Date(), ClosedByUserId: userId },
    });
    const trip = await prisma.travel_groups.findUniqueOrThrow({
      where: { Id: request.params.id },
      include: activeMemberCount,
    });
    // Members' devices stop broadcasting right away (realtime) instead of
    // discovering the closure on their next 410, and get a visible heads-up.
    void notifyTripMembers(trip.Id, "TravelClosed", {
      excludePush: userId,
      push: { title: trip.Name, body: "Trajeto encerrado." },
    });
    return mapTrip(trip);
  });

  // DELETE /api/v1/travels/:id — permanently remove a trip (creator only),
  // e.g. to drop a finished trip from history. Members/invites cascade;
  // trip-scoped ephemeral rows (positions, temp consents) are removed, while
  // records worth keeping (audit, SOS) just lose their nullable trip link.
  app.delete<{ Params: { id: string } }>("/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const userId = request.user.sub;
    const trip = await ownedTrip(request.params.id, userId);
    const id = trip.Id;
    // Awaited: members must be read BEFORE the cascade wipes the membership rows.
    await notifyTripMembers(id, "TravelClosed", { excludePush: userId });
    await prisma.$transaction([
      prisma.location_events.deleteMany({ where: { TravelGroupId: id } }),
      prisma.consent_grants.deleteMany({ where: { TravelGroupId: id } }),
      prisma.audit_logs.updateMany({ where: { TravelGroupId: id }, data: { TravelGroupId: null } }),
      prisma.sos_events.updateMany({ where: { TravelGroupId: id }, data: { TravelGroupId: null } }),
      prisma.travel_groups.delete({ where: { Id: id } }),
    ]);
    return reply.code(204).send();
  });

  // POST /api/v1/travels/:id/leave — leave a travel; if creator, close it.
  app.post<{ Params: { id: string } }>("/:id/leave", { preHandler: app.authenticate }, async (request, reply) => {
    const userId = request.user.sub;
    const trip = await prisma.travel_groups.findFirst({ where: { Id: request.params.id } });
    if (!trip) throw new AppError("TravelNotFound", "Trajeto não encontrado.", 404);

    await prisma.travel_group_members.updateMany({
      where: { TravelGroupId: trip.Id, UserId: userId, IsActive: true },
      data: { IsActive: false, LeftAt: new Date() },
    });
    if (trip.CreatedByUserId === userId && trip.IsActive) {
      await prisma.travel_groups.update({
        where: { Id: trip.Id },
        data: { IsActive: false, ClosedAt: new Date(), ClosedByUserId: userId },
      });
      void notifyTripMembers(trip.Id, "TravelClosed", {
        excludePush: userId,
        push: { title: trip.Name, body: "Trajeto encerrado." },
      });
    } else {
      // Remaining members refresh their member list/map live.
      void notifyTripMembers(trip.Id, "TravelMembersChanged", { excludePush: userId });
    }
    return reply.code(204).send();
  });

  // POST /api/v1/travels/:id/invites — create a shareable travel invite (creator only).
  app.post<{ Params: { id: string } }>("/:id/invites", { preHandler: app.authenticate }, async (request, reply) => {
    const userId = request.user.sub;
    const trip = await ownedTrip(request.params.id, userId);
    if (!trip.IsActive || trip.EndsAt <= new Date()) {
      throw new AppError("TravelClosed", "A viagem informada já está encerrada.", 409);
    }
    const now = new Date();
    let expiresAt = new Date(now.getTime() + 24 * 60 * 60_000);
    if (expiresAt > trip.EndsAt) expiresAt = trip.EndsAt;

    const invite = await prisma.travel_invites.create({
      data: {
        Id: randomUUID(),
        TravelGroupId: trip.Id,
        InviteCode: await uniqueInviteCode(),
        ExpiresAt: expiresAt,
        CreatedAt: now,
        CreatedByUserId: userId,
        IsUsed: false,
      },
    });
    return reply.code(201).send({
      inviteId: invite.Id,
      travelGroupId: invite.TravelGroupId,
      inviteCode: invite.InviteCode,
      expiresAt: invite.ExpiresAt.toISOString(),
      inviteLink: `wardyou://travel/invite/${invite.InviteCode}`,
    });
  });

  // GET /api/v1/travels/invites/:code — preview an invite before accepting.
  app.get<{ Params: { code: string } }>("/invites/:code", { preHandler: app.authenticate }, async (request) => {
    const invite = await prisma.travel_invites.findFirst({ where: { InviteCode: request.params.code } });
    if (!invite) throw new AppError("InviteNotFound", "Convite de viagem não encontrado.", 404);
    const trip = await prisma.travel_groups.findFirst({ where: { Id: invite.TravelGroupId } });
    if (!trip) throw new AppError("TravelNotFound", "A viagem do convite não foi encontrada.", 404);
    const now = new Date();
    return {
      travelGroupId: trip.Id,
      travelName: trip.Name,
      type: TRIP_TYPE_NAMES[trip.Type] ?? "group",
      startsAt: trip.StartsAt.toISOString(),
      endsAt: trip.EndsAt.toISOString(),
      allowMembersToSeeEachOther: trip.AllowMembersToSeeEachOther,
      isActive: trip.IsActive,
      isExpired: invite.ExpiresAt <= now || !trip.IsActive || trip.EndsAt <= now,
    };
  });

  // POST /api/v1/travels/invites/:code/accept — join a travel via invite code.
  app.post<{ Params: { code: string } }>(
    "/invites/:code/accept",
    { preHandler: app.authenticate },
    async (request) => {
      const userId = request.user.sub;
      const body = z
        .object({
          shareLiveLocation: z.boolean().default(true),
          shareBatteryStatus: z.boolean().default(true),
          receiveSosAlerts: z.boolean().default(true),
        })
        .parse(request.body ?? {});

      const invite = await prisma.travel_invites.findFirst({ where: { InviteCode: request.params.code } });
      if (!invite) throw new AppError("InviteNotFound", "Convite de viagem não encontrado.", 404);
      const trip = await prisma.travel_groups.findFirst({ where: { Id: invite.TravelGroupId } });
      if (!trip) throw new AppError("TravelNotFound", "A viagem do convite não foi encontrada.", 404);
      const now = new Date();
      if (!trip.IsActive || trip.EndsAt <= now || invite.ExpiresAt <= now) {
        throw new AppError("InviteExpired", "O convite expirou ou a viagem foi encerrada.", 409);
      }

      const existing = await prisma.travel_group_members.findFirst({
        where: { TravelGroupId: trip.Id, UserId: userId },
      });
      const memberData = {
        ShareLiveLocation: body.shareLiveLocation,
        ShareBatteryStatus: body.shareBatteryStatus,
        ReceiveSosAlerts: body.receiveSosAlerts,
        JoinedAt: now,
        LeftAt: null,
        IsActive: true,
      };
      if (existing) {
        await prisma.travel_group_members.update({ where: { Id: existing.Id }, data: memberData });
      } else {
        await prisma.travel_group_members.create({
          data: { Id: randomUUID(), TravelGroupId: trip.Id, UserId: userId, ...memberData },
        });
      }
      if (!invite.IsUsed) {
        await prisma.travel_invites.update({
          where: { Id: invite.Id },
          data: { IsUsed: true, UsedByUserId: userId, UsedAt: now },
        });
      }
      // Everyone on the trip sees the new member (and their pin) live, and gets
      // a visible heads-up — without having to reopen the app.
      const joiner = await prisma.users.findFirst({ where: { Id: userId }, select: { FullName: true } });
      void notifyTripMembers(trip.Id, "TravelMembersChanged", {
        excludePush: userId,
        push: { title: trip.Name, body: `${joiner?.FullName ?? "Um membro"} entrou no trajeto.` },
      });
      const updated = await prisma.travel_groups.findUniqueOrThrow({ where: { Id: trip.Id }, include: activeMemberCount });
      return mapTrip(updated);
    },
  );
}
