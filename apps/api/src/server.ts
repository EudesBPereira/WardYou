import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { env } from "./env.js";
import { AppError } from "./lib/errors.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerJoinRoutes } from "./routes/join.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerFamilyRoutes } from "./routes/family.js";
import { registerTripsRoutes } from "./routes/trips.js";
import { registerSosRoutes } from "./routes/sos.js";
import { registerLocationRoutes } from "./routes/location.js";
import { registerConsentRoutes } from "./routes/consents.js";
import { registerZoneRoutes } from "./routes/zones.js";
import { registerParentalRoutes } from "./routes/parental.js";
import { registerElderRoutes } from "./routes/elder.js";
import { registerDeviceRoutes } from "./routes/devices.js";
import { initRealtime } from "./realtime.js";
import { startElderScheduler } from "./scheduler.js";
import { registerAuditRoutes } from "./routes/audit.js";
import { registerPrivacyRoutes } from "./routes/privacy.js";
import { registerProfileRoutes } from "./routes/profile.js";

async function main() {
  const app = Fastify({ logger: true });

  // CORS_ORIGIN is a comma-separated allowlist. "*" means "any origin" and must
  // become `origin: true` (reflect the caller's origin) — NOT the string "*":
  // @fastify/cors string-compares each entry of an array against the request
  // origin, so `["*"]` matched nothing and blocked every browser request. (It
  // went unnoticed because native apps don't enforce CORS; only the web preview
  // broke.) A literal "*" is also invalid alongside `credentials: true`, which
  // reflecting the origin handles correctly.
  const allowed = env.CORS_ORIGIN.split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  await app.register(cors, {
    origin: allowed.includes("*") ? true : allowed,
    credentials: true,
  });
  await app.register(jwt, {
    secret: env.JWT_SECRET,
    sign: { iss: env.JWT_ISSUER, aud: env.JWT_AUDIENCE },
    verify: { allowedIss: env.JWT_ISSUER, allowedAud: env.JWT_AUDIENCE },
  });

  // `{ preHandler: app.authenticate }` guard for protected routes.
  app.decorate("authenticate", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ message: "Unauthorized" });
    }
  });

  // Translate domain errors (AppError) into the { message } shape the mobile
  // client reads; everything else is a 500.
  app.setErrorHandler((error: Error & { validation?: unknown }, _request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.status).send({ message: error.message, code: error.code });
    }
    if (error.validation) {
      return reply.code(400).send({ message: error.message });
    }
    app.log.error(error);
    return reply.code(500).send({ message: "Erro interno do servidor." });
  });

  await app.register(registerHealthRoutes);
  // Landing publica do convite — sem prefixo, para o link ficar curto.
  await app.register(registerJoinRoutes);
  await app.register(registerAuthRoutes, { prefix: "/api/v1/auth" });
  await app.register(registerFamilyRoutes, { prefix: "/api/v1/families" });
  await app.register(registerTripsRoutes, { prefix: "/api/v1/travels" });
  await app.register(registerSosRoutes, { prefix: "/api/v1/sos" });
  await app.register(registerLocationRoutes, { prefix: "/api/v1" });
  await app.register(registerConsentRoutes, { prefix: "/api/v1" });
  await app.register(registerZoneRoutes, { prefix: "/api/v1/zones" });
  await app.register(registerParentalRoutes, { prefix: "/api/v1/parental" });
  await app.register(registerElderRoutes, { prefix: "/api/v1/elder" });
  await app.register(registerDeviceRoutes, { prefix: "/api/v1/devices" });
  await app.register(registerAuditRoutes, { prefix: "/api/v1/audit" });
  await app.register(registerPrivacyRoutes, { prefix: "/api/v1/privacy" });
  await app.register(registerProfileRoutes, { prefix: "/api/v1/profile" });

  await app.listen({ port: env.PORT, host: "0.0.0.0" });

  // Realtime (Socket.IO) shares the Fastify HTTP server. Verify the access token
  // with the same @fastify/jwt config used for HTTP routes.
  initRealtime(
    app.server,
    (token) => {
      try {
        return app.jwt.verify<{ sub: string }>(token);
      } catch {
        return null;
      }
    },
    env.CORS_ORIGIN.split(","),
  );
  app.log.info("Realtime (Socket.IO) ready on /realtime");

  // Elder-care scheduler: medication reminders, daily check-in reminder and
  // the caregiver inactivity alert (see scheduler.ts; ELDER_SCHEDULER=off to disable).
  startElderScheduler();
  app.log.info("Elder scheduler started");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
