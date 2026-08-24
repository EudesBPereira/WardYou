import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as devices from "../services/deviceService.js";

const createSchema = z.object({
  deviceName: z.string().min(1),
  platform: z.string().min(1),
  sharePreciseLocation: z.boolean().optional(),
});
const updateSchema = z.object({
  deviceName: z.string().min(1),
  sharePreciseLocation: z.boolean(),
  isActive: z.boolean(),
});
const pushTokenSchema = z.object({ deviceId: z.string().uuid(), pushToken: z.string().min(1), pushLanguage: z.string().optional() });
const locationSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  accuracyMeters: z.number().optional(),
  batteryLevel: z.number().int().optional(),
  isCharging: z.boolean().optional(),
});

export async function registerDeviceRoutes(app: FastifyInstance) {
  const auth = { preHandler: app.authenticate };

  app.get("/", auth, async (req) => devices.getMyDevices(req.user.sub));

  app.post("/", auth, async (req, reply) => {
    const p = createSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ message: "Payload de dispositivo inválido." });
    return reply.code(201).send(await devices.createDevice(req.user.sub, p.data));
  });

  // PUT /api/v1/devices/push-token — update a device's push token.
  app.put("/push-token", auth, async (req, reply) => {
    const p = pushTokenSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ message: "Payload de push token inválido." });
    await devices.updatePushToken(req.user.sub, p.data.deviceId, p.data.pushToken, p.data.pushLanguage);
    return reply.code(204).send();
  });

  app.put<{ Params: { id: string } }>("/:id", auth, async (req, reply) => {
    const p = updateSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ message: "Payload de dispositivo inválido." });
    return devices.updateDevice(req.user.sub, req.params.id, p.data);
  });

  app.delete<{ Params: { id: string } }>("/:id", auth, async (req, reply) => {
    await devices.deleteDevice(req.user.sub, req.params.id);
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>("/:id/location", auth, async (req, reply) => {
    const p = locationSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ message: "Payload de localização inválido." });
    return reply.code(201).send(await devices.addDeviceLocation(req.user.sub, req.params.id, p.data));
  });

  app.get<{ Params: { id: string } }>("/:id/location-history", auth, async (req) =>
    devices.getLocationHistory(req.user.sub, req.params.id),
  );
}
