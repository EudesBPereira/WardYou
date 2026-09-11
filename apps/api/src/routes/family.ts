import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import * as familyService from "../services/familyService.js";
import * as locationService from "../services/locationService.js";
import * as deviceService from "../services/deviceService.js";
import { grantFamilyConsent } from "../services/consentService.js";

const STATUS_DISABLED = 2;

const createFamilySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});
const inviteSchema = z.object({ email: z.string().email().optional(), expiresInHours: z.number().optional() });
const joinSchema = z.object({ inviteCode: z.string().min(1), role: z.string().optional() });

export async function registerFamilyRoutes(app: FastifyInstance) {
  // GET /api/v1/families/members — all members across the user's active families.
  app.get("/members", { preHandler: app.authenticate }, async (request) => {
    const userId = request.user.sub;
    const myMemberships = await prisma.family_members.findMany({
      where: { UserId: userId, Status: { not: STATUS_DISABLED } },
      select: { FamilyId: true },
    });
    const familyIds = [...new Set(myMemberships.map((m) => m.FamilyId))];
    if (familyIds.length === 0) return [];

    const members = await prisma.family_members.findMany({
      where: { FamilyId: { in: familyIds }, Status: { not: STATUS_DISABLED } },
      orderBy: { JoinedAt: "asc" },
      include: { users: { select: { FullName: true, AvatarUrl: true } } },
    });
    return members.map(familyService.mapMember);
  });

  // GET /api/v1/families/map — members across the user's families with their
  // last known location (for the home/family map). Static path, so find-my-way
  // matches it ahead of the "/:familyId" param route.
  app.get("/map", { preHandler: app.authenticate }, async (request) =>
    locationService.getFamilyMap(request.user.sub),
  );

  // GET /api/v1/families — summary of families the user belongs to.
  app.get("/", { preHandler: app.authenticate }, async (request) =>
    familyService.listMyFamilies(request.user.sub),
  );

  // POST /api/v1/families — create a family (caller becomes admin).
  app.post("/", { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = createFamilySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Payload de família inválido." });
    return reply.code(201).send(await familyService.createFamily(request.user.sub, parsed.data));
  });

  // GET /api/v1/families/:familyId/devices — devices of family members (consent-gated).
  app.get<{ Params: { familyId: string } }>(
    "/:familyId/devices",
    { preHandler: app.authenticate },
    async (request) => deviceService.getFamilyDevices(request.user.sub, request.params.familyId),
  );

  // GET /api/v1/families/:familyId — family detail with members.
  app.get<{ Params: { familyId: string } }>(
    "/:familyId",
    { preHandler: app.authenticate },
    async (request) => familyService.getFamily(request.user.sub, request.params.familyId),
  );

  // GET/POST invite — reuse-or-create a generated invite for the family.
  app.get<{ Params: { familyId: string } }>(
    "/:familyId/invites/current",
    { preHandler: app.authenticate },
    async (request) => familyService.getOrCreateInvite(request.user.sub, request.params.familyId),
  );

  const createInvite = async (
    request: { user: { sub: string }; params: { familyId: string }; body: unknown },
    reply: { code: (n: number) => { send: (b: unknown) => unknown } },
  ) => {
    const parsed = inviteSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ message: "Payload de convite inválido." });
    return reply
      .code(201)
      .send(await familyService.getOrCreateInvite(request.user.sub, request.params.familyId, parsed.data.email));
  };
  app.post<{ Params: { familyId: string } }>("/:familyId/invites", { preHandler: app.authenticate }, createInvite);
  app.post<{ Params: { familyId: string } }>("/:familyId/invite", { preHandler: app.authenticate }, createInvite);

  // POST /api/v1/families/join — join via invite code in the body.
  app.post("/join", { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = joinSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Código de convite inválido." });
    return reply.send(await familyService.joinFamily(request.user.sub, parsed.data.inviteCode, parsed.data.role));
  });

  // POST /api/v1/families/join/:code — join via invite code in the path.
  app.post<{ Params: { code: string } }>(
    "/join/:code",
    { preHandler: app.authenticate },
    async (request) => familyService.joinFamily(request.user.sub, request.params.code),
  );

  // POST /:familyId/members/:memberId/approve — approve a pending member (admin).
  // Optional body { role } assigns the member's role (child/elder/guardian/member)
  // at approval time — the moment that decides which app experience they get.
  app.post<{ Params: { familyId: string; memberId: string } }>(
    "/:familyId/members/:memberId/approve",
    { preHandler: app.authenticate },
    async (request) => {
      const body = z.object({ role: z.string().optional() }).safeParse(request.body ?? {});
      const member = await familyService.approveMember(
        request.user.sub,
        request.params.familyId,
        request.params.memberId,
        body.success ? body.data.role : undefined,
      );
      // A child/elder is a dependent whose guardian is meant to see their
      // location by design — auto-grant a family-level LocationSharing consent
      // on approval so the map isn't hidden "sem consentimento". Best-effort.
      if ((member.role === "child" || member.role === "elder") && member.userId) {
        try {
          await grantFamilyConsent(request.user.sub, request.params.familyId, member.userId, {
            type: "LocationSharing",
            version: "auto-dependent-1",
          });
        } catch {
          /* consent is best-effort; approval already succeeded */
        }
      }
      return member;
    },
  );

  // PUT /:familyId/members/:memberId/role — change an active member's role (admin).
  app.put<{ Params: { familyId: string; memberId: string } }>(
    "/:familyId/members/:memberId/role",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const body = z
        .object({ role: z.enum(["admin", "guardian", "member", "child", "elder", "dependent"]) })
        .safeParse(request.body);
      if (!body.success) return reply.code(400).send({ message: "Papel inválido." });
      return familyService.setMemberRole(
        request.user.sub,
        request.params.familyId,
        request.params.memberId,
        body.data.role,
      );
    },
  );

  // PUT /:familyId/members/:memberId/avatar — guardian sets a member's photo
  // (children/elders rarely set their own).
  app.put<{ Params: { familyId: string; memberId: string } }>(
    "/:familyId/members/:memberId/avatar",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const body = z.object({ avatarUrl: z.string().max(400_000).nullable() }).safeParse(request.body);
      if (!body.success) return reply.code(400).send({ message: "Payload de avatar inválido." });
      return familyService.setMemberAvatar(
        request.user.sub,
        request.params.familyId,
        request.params.memberId,
        body.data.avatarUrl,
      );
    },
  );

  // PUT /:familyId/members/:memberId/nickname — guardian/admin sets (or clears,
  // with an empty/omitted string) how this member's name shows up across the
  // app. Optional: empty falls back to the real name, same as before.
  app.put<{ Params: { familyId: string; memberId: string } }>(
    "/:familyId/members/:memberId/nickname",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const body = z.object({ nickname: z.string().max(60).nullable() }).safeParse(request.body);
      if (!body.success) return reply.code(400).send({ message: "Apelido inválido." });
      return familyService.setMemberNickname(
        request.user.sub,
        request.params.familyId,
        request.params.memberId,
        body.data.nickname,
      );
    },
  );

  // POST /:familyId/members/:memberId/reject — reject a pending member (admin).
  app.post<{ Params: { familyId: string; memberId: string } }>(
    "/:familyId/members/:memberId/reject",
    { preHandler: app.authenticate },
    async (request) =>
      familyService.rejectMember(request.user.sub, request.params.familyId, request.params.memberId),
  );
}
