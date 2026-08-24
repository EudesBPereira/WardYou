import { prisma } from "../db.js";
import { isPushConfigured, sendPush, type PushMessage } from "../lib/fcm.js";

/**
 * High-level push: resolve the active devices' push tokens for a set of users
 * and deliver an FCM notification to each. Best-effort — never throws, so a
 * push failure can't break the action that triggered it (mirrors the realtime
 * `emitToUsers` pattern). Tokens FCM reports as invalid/unregistered are
 * cleared so we stop trying them.
 */
export async function pushToUsers(userIds: string[], message: PushMessage): Promise<void> {
  if (!isPushConfigured()) return;
  const ids = [...new Set(userIds)].filter(Boolean);
  if (ids.length === 0) return;

  try {
    const devices = await prisma.devices.findMany({
      where: { UserId: { in: ids }, IsActive: true, PushToken: { not: null } },
      select: { Id: true, PushToken: true },
    });
    await Promise.all(
      devices.map(async (d) => {
        const token = d.PushToken;
        if (!token) return;
        const result = await sendPush(token, message);
        if (result === "invalid-token") {
          await prisma.devices.update({ where: { Id: d.Id }, data: { PushToken: null } }).catch(() => {});
        }
      }),
    );
  } catch {
    /* best-effort */
  }
}

export const pushToUser = (userId: string, message: PushMessage) => pushToUsers([userId], message);
