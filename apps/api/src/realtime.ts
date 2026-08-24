import type { Server as HttpServer } from "node:http";
import { Server as IOServer } from "socket.io";
import { prisma } from "./db.js";

const STATUS_DISABLED = 2;

let io: IOServer | null = null;

export interface VerifiedToken {
  sub: string;
}

/**
 * Attach a Socket.IO server to the HTTP server. Clients authenticate by passing
 * their access token in `handshake.auth.token`; on connect they auto-join their
 * personal room (`user:{id}`) and every active family room (`family:{id}`), so
 * the backend can target them without the client managing rooms.
 */
export function initRealtime(
  httpServer: HttpServer,
  verify: (token: string) => VerifiedToken | null,
  corsOrigins: string[],
) {
  io = new IOServer(httpServer, {
    cors: { origin: corsOrigins, credentials: true },
    path: "/realtime",
  });

  io.use((socket, next) => {
    const token = (socket.handshake.auth?.token as string | undefined) ?? undefined;
    const payload = token ? verify(token) : null;
    if (!payload) return next(new Error("unauthorized"));
    socket.data.userId = payload.sub;
    next();
  });

  io.on("connection", async (socket) => {
    const userId = socket.data.userId as string;
    socket.join(`user:${userId}`);
    try {
      const memberships = await prisma.family_members.findMany({
        where: { UserId: userId, Status: { not: STATUS_DISABLED } },
        select: { FamilyId: true },
      });
      for (const m of memberships) socket.join(`family:${m.FamilyId}`);
    } catch {
      /* room join is best-effort */
    }
  });
}

export function emitToUser(userId: string, event: string, payload: unknown) {
  io?.to(`user:${userId}`).emit(event, payload);
}

export function emitToUsers(userIds: string[], event: string, payload: unknown) {
  for (const id of new Set(userIds)) emitToUser(id, event, payload);
}

export function emitToFamily(familyId: string, event: string, payload: unknown) {
  io?.to(`family:${familyId}`).emit(event, payload);
}
