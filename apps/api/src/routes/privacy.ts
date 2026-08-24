import type { FastifyInstance } from "fastify";
import * as privacy from "../services/privacyService.js";

export async function registerPrivacyRoutes(app: FastifyInstance) {
  const auth = { preHandler: app.authenticate };

  app.get("/summary", auth, async (req) => privacy.getSummary(req.user.sub));
  app.post("/export", auth, async (req) => privacy.exportData(req.user.sub));
  app.post("/delete-account-request", auth, async (req) => privacy.requestAccountDeletion(req.user.sub));
  app.post("/revoke-all-consents", auth, async (req) => privacy.revokeAllConsents(req.user.sub));
}
