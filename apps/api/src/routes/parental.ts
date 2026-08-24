import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as parental from "../services/parentalService.js";

const policySchema = z.object({
  dailyScreenTimeLimitMinutes: z.number().int(),
  isEnabled: z.boolean(),
  blockAppInstall: z.boolean().optional(),
  entertainmentDailyLimitMinutes: z.number().int().nullable().optional(),
});

const appRulesSchema = z.object({
  rules: z.array(
    z.object({
      appPackageName: z.string().min(1),
      appDisplayName: z.string().optional(),
      isBlocked: z.boolean(),
      dailyLimitMinutes: z.number().int().nullable().optional(),
      isEmergencyAllowed: z.boolean().optional(),
      isWhitelisted: z.boolean().optional(),
      appCategory: z.string().optional(),
    }),
  ),
});

const extraRequestSchema = z.object({ childUserId: z.string().uuid(), requestedMinutes: z.number().int() });
const time = z.string().regex(/^\d{2}:\d{2}$/);
const sleepSchema = z.object({
  isEnabled: z.boolean(),
  startTime: time,
  endTime: time,
  daysOfWeek: z.number().int(),
});
const blockSchema = sleepSchema.extend({
  name: z.string().min(1),
  blockAll: z.boolean(),
  blockGames: z.boolean(),
  blockSocial: z.boolean(),
  blockVideo: z.boolean(),
});
const usageSchema = z.object({
  childUserId: z.string().uuid(),
  deviceId: z.string().uuid(),
  usageDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  items: z.array(
    z.object({
      appPackageName: z.string().min(1),
      appDisplayName: z.string().optional(),
      usedMinutes: z.number().int(),
    }),
  ),
});
const taskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  category: z.string().optional(),
  rewardMinutes: z.number().int(),
  isRecurring: z.boolean().optional(),
  recurringDays: z.number().int().optional(),
});
const updateTaskSchema = taskSchema.extend({ isActive: z.boolean() });
const reviewSchema = z.object({ parentNote: z.string().optional() }).optional();

type Cid = { childUserId: string };

export async function registerParentalRoutes(app: FastifyInstance) {
  const auth = { preHandler: app.authenticate };

  app.get("/children", auth, async (req) => parental.getChildren(req.user.sub));

  app.get<{ Params: Cid }>("/children/:childUserId/policy", auth, async (req) =>
    parental.getPolicy(req.user.sub, req.params.childUserId),
  );
  app.put<{ Params: Cid }>("/children/:childUserId/policy", auth, async (req, reply) => {
    const p = policySchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ message: "Payload de política inválido." });
    return parental.upsertPolicy(req.user.sub, req.params.childUserId, p.data);
  });

  app.get<{ Params: Cid }>("/children/:childUserId/apps", auth, async (req) =>
    parental.getAppRules(req.user.sub, req.params.childUserId),
  );

  // Remote pause/resume (real-time action). Pause may carry a duration —
  // it then auto-lifts (Kids360-style "pausar por 1h").
  app.post<{ Params: Cid }>("/children/:childUserId/remote-action", auth, async (req, reply) => {
    const p = z
      .object({
        action: z.enum(["Pause", "Resume"]),
        durationMinutes: z.number().int().min(1).max(24 * 60).optional(),
      })
      .safeParse(req.body);
    if (!p.success) return reply.code(400).send({ message: "Ação inválida." });
    return parental.applyRemoteAction(req.user.sub, req.params.childUserId, p.data.action, p.data.durationMinutes ?? null);
  });

  // Temporary allow: one app usable for the next N hours without changing its
  // permanent allow/block state. hours=0 clears an active temporary allow.
  app.post<{ Params: Cid & { packageName: string } }>(
    "/children/:childUserId/apps/:packageName/temporary-allow",
    auth,
    async (req, reply) => {
      const p = z.object({ hours: z.number().min(0).max(24) }).safeParse(req.body);
      if (!p.success) return reply.code(400).send({ message: "Duração inválida (0 a 24 horas)." });
      return parental.temporaryAllowApp(
        req.user.sub,
        req.params.childUserId,
        decodeURIComponent(req.params.packageName),
        p.data.hours,
      );
    },
  );

  // Blocked websites (web filtering).
  app.put<{ Params: Cid }>("/children/:childUserId/blocked-websites", auth, async (req, reply) => {
    const p = z.object({ domains: z.array(z.string()) }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ message: "Payload de sites inválido." });
    return parental.upsertBlockedWebsites(req.user.sub, req.params.childUserId, p.data.domains);
  });

  // Child's own daily status (limit vs. usage, pause, extra time, sleep window).
  app.get("/my-status", auth, async (req) => parental.getMyStatus(req.user.sub));

  // Child device heartbeat (online + granted OS permissions).
  app.post("/heartbeat", auth, async (req, reply) => {
    const p = z
      .object({
        hasUsageAccess: z.boolean(),
        hasAccessibility: z.boolean(),
        /** Uninstall protection (device admin) was switched off since the last
         *  heartbeat — a tamper the guardian must hear about immediately. */
        adminDisabled: z.boolean().optional(),
        appVersion: z.string().optional(),
        batteryLevel: z.number().int().optional(),
      })
      .safeParse(req.body);
    if (!p.success) return reply.code(400).send({ message: "Payload de heartbeat inválido." });
    await parental.reportHeartbeat(req.user.sub, p.data);
    return reply.code(204).send();
  });
  app.put<{ Params: Cid }>("/children/:childUserId/apps/rules", auth, async (req, reply) => {
    const p = appRulesSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ message: "Payload de regras inválido." });
    return parental.upsertAppRules(req.user.sub, req.params.childUserId, p.data.rules);
  });

  // Extra time
  app.post("/extra-time/request", auth, async (req, reply) => {
    const p = extraRequestSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ message: "Payload de tempo extra inválido." });
    return parental.requestExtraTime(req.user.sub, p.data.childUserId, p.data.requestedMinutes);
  });
  app.get("/extra-time/pending", auth, async (req) => parental.getPendingExtraTime(req.user.sub));
  app.put<{ Params: { requestId: string } }>("/extra-time/:requestId/approve", auth, async (req) =>
    parental.approveExtraTime(req.user.sub, req.params.requestId),
  );
  app.put<{ Params: { requestId: string } }>("/extra-time/:requestId/reject", auth, async (req) =>
    parental.rejectExtraTime(req.user.sub, req.params.requestId),
  );

  // Everything awaiting the guardian's decision for one child (extra time +
  // app-access requests), so the child's management screen can show it.
  app.get<{ Params: Cid }>("/children/:childUserId/requests", auth, async (req) =>
    parental.getChildPendingRequests(req.user.sub, req.params.childUserId),
  );

  // Approve/reject an app-access request (optionally as a temporary window).
  app.post<{ Params: Cid }>("/children/:childUserId/requests/app-access", auth, async (req, reply) => {
    const p = z
      .object({
        packageName: z.string().min(1).max(200),
        approve: z.boolean(),
        hours: z.number().int().min(0).max(24).optional(),
      })
      .safeParse(req.body);
    if (!p.success) return reply.code(400).send({ message: "Payload de decisão inválido." });
    return parental.decideAppAccess(req.user.sub, req.params.childUserId, p.data);
  });

  // Child hit the blocked screen and asked for an app to be allowed — nudges
  // the tutors via push/realtime (no DB state; schema is frozen).
  app.post("/request-app-access", auth, async (req, reply) => {
    const p = z
      .object({ packageName: z.string().min(1).max(200), label: z.string().max(200).optional() })
      .safeParse(req.body);
    if (!p.success) return reply.code(400).send({ message: "Payload de pedido de liberação inválido." });
    return parental.requestAppAccess(req.user.sub, p.data.packageName, p.data.label);
  });

  // Child self-reports its installed apps → guardian sees the real list.
  app.post("/my-apps", auth, async (req, reply) => {
    const p = z
      .object({ apps: z.array(z.object({ packageName: z.string().min(1), label: z.string().optional() })).max(1000) })
      .safeParse(req.body);
    if (!p.success) return reply.code(400).send({ message: "Payload de apps inválido." });
    return parental.reportInstalledApps(req.user.sub, p.data.apps);
  });

  // Usage
  app.post("/usage-summary", auth, async (req, reply) => {
    const p = usageSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ message: "Payload de uso inválido." });
    await parental.saveUsageSummary(req.user.sub, p.data);
    return reply.code(204).send();
  });
  app.get<{ Params: Cid; Querystring: { date?: string } }>(
    "/children/:childUserId/usage-summary",
    auth,
    async (req) => parental.getUsageSummary(req.user.sub, req.params.childUserId, req.query.date),
  );
  app.get<{ Params: Cid; Querystring: { days?: string } }>(
    "/children/:childUserId/usage-summary/overview",
    auth,
    async (req) => parental.getUsageOverview(req.user.sub, req.params.childUserId, Number(req.query.days) || 7),
  );

  // Sleep schedule
  app.get<{ Params: Cid }>("/children/:childUserId/sleep-schedule", auth, async (req) =>
    parental.getSleepSchedule(req.user.sub, req.params.childUserId),
  );
  app.put<{ Params: Cid }>("/children/:childUserId/sleep-schedule", auth, async (req, reply) => {
    const p = sleepSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ message: "Payload de agendamento inválido." });
    return parental.upsertSleepSchedule(req.user.sub, req.params.childUserId, p.data);
  });

  // Block schedules
  app.get<{ Params: Cid }>("/children/:childUserId/block-schedules", auth, async (req) =>
    parental.getBlockSchedules(req.user.sub, req.params.childUserId),
  );
  app.post<{ Params: Cid }>("/children/:childUserId/block-schedules", auth, async (req, reply) => {
    const p = blockSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ message: "Payload de agendamento inválido." });
    return reply.code(201).send(await parental.upsertBlockSchedule(req.user.sub, req.params.childUserId, null, p.data));
  });
  app.put<{ Params: Cid & { scheduleId: string } }>(
    "/children/:childUserId/block-schedules/:scheduleId",
    auth,
    async (req, reply) => {
      const p = blockSchema.safeParse(req.body);
      if (!p.success) return reply.code(400).send({ message: "Payload de agendamento inválido." });
      return parental.upsertBlockSchedule(req.user.sub, req.params.childUserId, req.params.scheduleId, p.data);
    },
  );
  app.delete<{ Params: Cid & { scheduleId: string } }>(
    "/children/:childUserId/block-schedules/:scheduleId",
    auth,
    async (req, reply) => {
      await parental.deleteBlockSchedule(req.user.sub, req.params.childUserId, req.params.scheduleId);
      return reply.code(204).send();
    },
  );

  // Tasks (parent)
  app.get<{ Params: Cid }>("/children/:childUserId/tasks", auth, async (req) =>
    parental.getChildTasks(req.user.sub, req.params.childUserId),
  );
  app.post<{ Params: Cid }>("/children/:childUserId/tasks", auth, async (req, reply) => {
    const p = taskSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ message: "Payload de tarefa inválido." });
    return reply.code(201).send(await parental.createTask(req.user.sub, req.params.childUserId, p.data));
  });
  app.put<{ Params: Cid & { taskId: string } }>("/children/:childUserId/tasks/:taskId", auth, async (req, reply) => {
    const p = updateTaskSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ message: "Payload de tarefa inválido." });
    return parental.updateTask(req.user.sub, req.params.childUserId, req.params.taskId, p.data);
  });
  app.delete<{ Params: Cid & { taskId: string } }>(
    "/children/:childUserId/tasks/:taskId",
    auth,
    async (req, reply) => {
      await parental.deleteTask(req.user.sub, req.params.childUserId, req.params.taskId);
      return reply.code(204).send();
    },
  );
  app.get<{ Params: Cid }>("/children/:childUserId/tasks/completions", auth, async (req) =>
    parental.getCompletionHistory(req.user.sub, req.params.childUserId),
  );

  // Tasks (child)
  app.get("/tasks/my", auth, async (req) => parental.getMyTasks(req.user.sub));
  app.post("/tasks/complete", auth, async (req, reply) => {
    const p = z.object({ taskId: z.string().uuid(), childNote: z.string().optional() }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ message: "Payload de conclusão inválido." });
    return parental.submitCompletion(req.user.sub, p.data.taskId, p.data.childNote);
  });

  // Tasks (review)
  app.get("/tasks/completions/pending", auth, async (req) => parental.getPendingCompletions(req.user.sub));
  app.put<{ Params: { completionId: string } }>(
    "/tasks/completions/:completionId/approve",
    auth,
    async (req) => {
      const p = reviewSchema.safeParse(req.body);
      return parental.approveCompletion(req.user.sub, req.params.completionId, p.success ? p.data?.parentNote : undefined);
    },
  );
  app.put<{ Params: { completionId: string } }>("/tasks/completions/:completionId/reject", auth, async (req) => {
    const p = reviewSchema.safeParse(req.body);
    return parental.rejectCompletion(req.user.sub, req.params.completionId, p.success ? p.data?.parentNote : undefined);
  });
}
