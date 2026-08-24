import { randomUUID } from "node:crypto";
import { prisma } from "../db.js";
import { AppError } from "../lib/errors.js";
import { hasActiveFamilyConsent, hasActiveUserConsent } from "./consentService.js";
import { evaluateLocation } from "./zoneService.js";
import { writeAudit } from "./auditService.js";

const STATUS_DISABLED = 2;
const LOCATION_SOURCE_FAMILY = 1;
const ONLINE_WINDOW_MS = 5 * 60_000;
const ALLOWED_PLATFORMS = ["Android", "iOS", "Windows", "MacCatalyst"];

interface DeviceRow {
  Id: string;
  UserId: string;
  DeviceName: string;
  Platform: string;
  IsActive: boolean;
  SharePreciseLocation: boolean;
  RegisteredAt: Date;
  LastSeenAt: Date | null;
}
interface LocRow {
  Latitude: number;
  Longitude: number;
  AccuracyMeters: number | null;
  BatteryLevel: number | null;
  IsCharging: boolean | null;
  CapturedAt: Date;
}

function round3(v: number, precise: boolean) {
  return precise ? v : Math.round(v * 1000) / 1000;
}
function isOnline(lastSeen: Date | null) {
  return !!lastSeen && Date.now() - lastSeen.getTime() <= ONLINE_WINDOW_MS;
}

function mapDevice(d: DeviceRow, loc: LocRow | undefined) {
  return {
    id: d.Id,
    userId: d.UserId,
    deviceName: d.DeviceName,
    platform: d.Platform,
    isActive: d.IsActive,
    sharePreciseLocation: d.SharePreciseLocation,
    registeredAt: d.RegisteredAt.toISOString(),
    lastSeenAt: d.LastSeenAt?.toISOString() ?? null,
    isOnline: isOnline(d.LastSeenAt),
    batteryLevel: loc?.BatteryLevel ?? null,
    isCharging: loc?.IsCharging ?? null,
    latitude: loc ? round3(loc.Latitude, d.SharePreciseLocation) : null,
    longitude: loc ? round3(loc.Longitude, d.SharePreciseLocation) : null,
    accuracyMeters: loc?.AccuracyMeters ?? null,
    locationCapturedAt: loc?.CapturedAt.toISOString() ?? null,
  };
}

async function latestByDevice(deviceIds: string[]): Promise<Map<string, LocRow>> {
  const map = new Map<string, LocRow>();
  if (deviceIds.length === 0) return map;
  const rows = await prisma.location_events.findMany({
    where: { DeviceId: { in: deviceIds } },
    orderBy: [{ DeviceId: "asc" }, { ReceivedAt: "desc" }],
    distinct: ["DeviceId"],
    select: { DeviceId: true, Latitude: true, Longitude: true, AccuracyMeters: true, BatteryLevel: true, IsCharging: true, CapturedAt: true },
  });
  for (const r of rows) if (r.DeviceId) map.set(r.DeviceId, r);
  return map;
}

function normalizePlatform(p: string): string {
  const match = ALLOWED_PLATFORMS.find((x) => x.toLowerCase() === p.trim().toLowerCase());
  if (!match) throw new AppError("ValidationError", "Plataforma inválida.");
  return match;
}

export async function getMyDevices(userId: string) {
  const devices = await prisma.devices.findMany({
    where: { UserId: userId },
    orderBy: [{ LastSeenAt: "desc" }],
  });
  const locs = await latestByDevice(devices.map((d) => d.Id));
  return devices.map((d) => mapDevice(d, locs.get(d.Id)));
}

export async function createDevice(userId: string, input: { deviceName: string; platform: string; sharePreciseLocation?: boolean }) {
  if (!input.deviceName?.trim()) throw new AppError("ValidationError", "O nome do dispositivo é obrigatório.");
  const now = new Date();
  const device = await prisma.devices.create({
    data: {
      Id: randomUUID(),
      UserId: userId,
      DeviceName: input.deviceName.trim().slice(0, 120),
      Platform: normalizePlatform(input.platform),
      SharePreciseLocation: input.sharePreciseLocation ?? true,
      RegisteredAt: now,
      LastSeenAt: now,
      IsActive: true,
    },
  });
  await writeAudit({ actorUserId: userId, action: "DeviceRegistered", sourceType: "Device", targetUserId: userId, deviceId: device.Id, metadata: { deviceName: device.DeviceName, platform: device.Platform } });
  return mapDevice(device, undefined);
}

async function ownedDevice(userId: string, deviceId: string) {
  const d = await prisma.devices.findFirst({ where: { Id: deviceId, UserId: userId } });
  if (!d) throw new AppError("DeviceNotOwned", "O dispositivo informado não pertence ao usuário.", 403);
  return d;
}

export async function updateDevice(userId: string, deviceId: string, input: { deviceName: string; sharePreciseLocation: boolean; isActive: boolean }) {
  const d = await ownedDevice(userId, deviceId);
  if (!input.deviceName?.trim()) throw new AppError("ValidationError", "O nome do dispositivo é obrigatório.");
  const updated = await prisma.devices.update({
    where: { Id: d.Id },
    data: {
      DeviceName: input.deviceName.trim().slice(0, 120),
      SharePreciseLocation: input.sharePreciseLocation,
      IsActive: input.isActive,
      LastSeenAt: new Date(),
    },
  });
  const loc = (await latestByDevice([d.Id])).get(d.Id);
  return mapDevice(updated, loc);
}

export async function deleteDevice(userId: string, deviceId: string) {
  const d = await ownedDevice(userId, deviceId);
  await prisma.devices.update({ where: { Id: d.Id }, data: { IsActive: false, LastSeenAt: new Date() } });
  await writeAudit({ actorUserId: userId, action: "DeviceRemoved", sourceType: "Device", targetUserId: userId, deviceId: d.Id });
}

export async function updatePushToken(userId: string, deviceId: string, pushToken: string, pushLanguage?: string) {
  const d = await ownedDevice(userId, deviceId);
  await prisma.devices.update({
    where: { Id: d.Id },
    data: { PushToken: pushToken.trim().slice(0, 500), PushLanguage: pushLanguage ?? null, LastSeenAt: new Date() },
  });
}

export async function addDeviceLocation(
  userId: string,
  deviceId: string,
  input: { latitude: number; longitude: number; accuracyMeters?: number; batteryLevel?: number; isCharging?: boolean },
) {
  const d = await ownedDevice(userId, deviceId);
  if (input.latitude < -90 || input.latitude > 90 || input.longitude < -180 || input.longitude > 180) {
    throw new AppError("ValidationError", "As coordenadas informadas são inválidas.");
  }
  if (input.batteryLevel !== undefined && (input.batteryLevel < 0 || input.batteryLevel > 100)) {
    throw new AppError("ValidationError", "O nível de bateria deve estar entre 0 e 100.");
  }
  const now = new Date();
  const event = await prisma.location_events.create({
    data: {
      Id: randomUUID(),
      UserId: userId,
      DeviceId: d.Id,
      Latitude: input.latitude,
      Longitude: input.longitude,
      AccuracyMeters: input.accuracyMeters ?? null,
      BatteryLevel: input.batteryLevel ?? null,
      IsCharging: input.isCharging ?? null,
      SourceType: LOCATION_SOURCE_FAMILY,
      CapturedAt: now,
      ReceivedAt: now,
    },
  });
  await prisma.devices.update({ where: { Id: d.Id }, data: { LastSeenAt: now, IsActive: true } });
  try { await evaluateLocation(userId, input.latitude, input.longitude); } catch { /* best-effort */ }
  return {
    deviceId: d.Id,
    latitude: round3(event.Latitude, d.SharePreciseLocation),
    longitude: round3(event.Longitude, d.SharePreciseLocation),
    accuracyMeters: event.AccuracyMeters,
    batteryLevel: event.BatteryLevel,
    capturedAt: event.CapturedAt.toISOString(),
  };
}

export async function getLocationHistory(userId: string, deviceId: string) {
  const device = await prisma.devices.findFirst({ where: { Id: deviceId } });
  if (!device) throw new AppError("DeviceNotFound", "Dispositivo não encontrado.", 404);
  if (device.UserId !== userId) {
    // Viewable only with an active family LocationSharing consent in a shared family.
    const mine = await prisma.family_members.findMany({ where: { UserId: userId, Status: { not: STATUS_DISABLED } }, select: { FamilyId: true } });
    const theirs = await prisma.family_members.findMany({ where: { UserId: device.UserId, Status: { not: STATUS_DISABLED } }, select: { FamilyId: true } });
    const shared = mine.map((m) => m.FamilyId).filter((f) => theirs.some((t) => t.FamilyId === f));
    let allowed = false;
    for (const fid of shared) if (await hasActiveFamilyConsent(fid, device.UserId, "LocationSharing")) { allowed = true; break; }
    if (!allowed) throw new AppError("ConsentRequired", "O compartilhamento de localização não está ativo para este dispositivo.", 403);
  }
  const events = await prisma.location_events.findMany({
    where: { DeviceId: deviceId },
    orderBy: { ReceivedAt: "desc" },
    take: 100,
  });
  return events.map((e) => ({
    deviceId,
    latitude: round3(e.Latitude, device.SharePreciseLocation),
    longitude: round3(e.Longitude, device.SharePreciseLocation),
    accuracyMeters: e.AccuracyMeters,
    batteryLevel: e.BatteryLevel,
    isCharging: e.IsCharging,
    capturedAt: e.CapturedAt.toISOString(),
    receivedAt: e.ReceivedAt.toISOString(),
  }));
}

/** Devices of every member in the family, location/battery gated by family consent. */
export async function getFamilyDevices(userId: string, familyId: string) {
  const memberUserIds = (
    await prisma.family_members.findMany({ where: { FamilyId: familyId }, select: { UserId: true } })
  ).map((m) => m.UserId).filter((id): id is string => !!id);
  if (!memberUserIds.includes(userId)) {
    throw new AppError("FamilyNotFound", "A família informada não foi encontrada para o usuário autenticado.", 404);
  }
  const devices = await prisma.devices.findMany({
    where: { UserId: { in: memberUserIds }, IsActive: true },
    include: { users: { select: { Id: true, FullName: true } } },
  });
  const locs = await latestByDevice(devices.map((d) => d.Id));
  const result = [];
  for (const d of devices) {
    const isSelf = d.UserId === userId;
    // Consistent with the family map: self, or an active LocationSharing consent
    // granted at the user level (self-service) or by the family.
    const canViewLocation =
      isSelf ||
      (await hasActiveUserConsent(d.UserId, "LocationSharing")) ||
      (await hasActiveFamilyConsent(familyId, d.UserId, "LocationSharing"));
    const canViewBattery =
      isSelf ||
      (await hasActiveUserConsent(d.UserId, "BatteryStatus")) ||
      (await hasActiveFamilyConsent(familyId, d.UserId, "BatteryStatus"));
    const loc = locs.get(d.Id);
    result.push({
      deviceId: d.Id,
      userId: d.UserId,
      userName: d.users?.FullName ?? "Membro",
      deviceName: d.DeviceName,
      platform: d.Platform,
      isOnline: isOnline(d.LastSeenAt),
      lastSeenAt: d.LastSeenAt?.toISOString() ?? null,
      batteryLevel: canViewBattery ? loc?.BatteryLevel ?? null : null,
      isCharging: canViewBattery ? loc?.IsCharging ?? null : null,
      latitude: canViewLocation && loc ? round3(loc.Latitude, d.SharePreciseLocation) : null,
      longitude: canViewLocation && loc ? round3(loc.Longitude, d.SharePreciseLocation) : null,
      accuracyMeters: canViewLocation ? loc?.AccuracyMeters ?? null : null,
      locationCapturedAt: canViewLocation ? loc?.CapturedAt.toISOString() ?? null : null,
      canViewLocation,
    });
  }
  return result.sort((a, b) => a.userName.localeCompare(b.userName));
}
