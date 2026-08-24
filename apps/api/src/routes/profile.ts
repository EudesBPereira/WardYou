import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getMyProfile, updateMyAvatar } from "../services/profileService.js";

const avatarSchema = z.object({ avatarUrl: z.string().max(400_000).nullable() });

export async function registerProfileRoutes(app: FastifyInstance) {
  // GET /api/v1/profile/me — who am I + which app experience to render.
  app.get("/me", { preHandler: app.authenticate }, async (request) => getMyProfile(request.user.sub));

  // PUT /api/v1/profile/me/avatar — set/clear the caller's profile photo.
  app.put("/me/avatar", { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = avatarSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Payload de avatar inválido." });
    return reply.send(await updateMyAvatar(request.user.sub, parsed.data.avatarUrl));
  });
}
