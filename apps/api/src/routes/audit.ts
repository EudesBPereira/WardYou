import type { FastifyInstance } from "fastify";
import * as audit from "../services/auditService.js";

type Q = { page?: string; pageSize?: string };
const parse = (q: Q) => ({ page: Number(q.page) || undefined, pageSize: Number(q.pageSize) || undefined });

export async function registerAuditRoutes(app: FastifyInstance) {
  const auth = { preHandler: app.authenticate };

  app.get<{ Querystring: Q }>("/my-data-access", auth, async (req) => audit.getMyDataAccess(req.user.sub, parse(req.query)));
  app.get<{ Querystring: Q }>("/actions", auth, async (req) => audit.getActions(req.user.sub, parse(req.query)));
  app.get<{ Params: { auditLogId: string } }>("/actions/:auditLogId", auth, async (req) =>
    audit.getById(req.user.sub, req.params.auditLogId),
  );
}
