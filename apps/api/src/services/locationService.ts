import { randomUUID } from "node:crypto";
import { prisma } from "../db.js";
import { AppError } from "../lib/errors.js";
import { STATUS, mapMember } from "./familyService.js";
import { hasActiveUserConsent, hasActiveFamilyConsent } from "./consentService.js";
import { evaluateLocation } from "./zoneService.js";

// LocationSourceType.Family (legacy domain enum) — a routine presence ping.
const LOCATION_SOURCE_FAMILY = 1;

export interface RecordLocationInput {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  batteryLevel?: number;
  isCharging?: boolean;
  deviceId?: string;
  familyId?: string;
  /** Reverse-geocoded place label from the device (see route schema). */
  locationLabel?: string;
}

function validate(input: RecordLocationInput) {
  if (input.latitude < -90 || input.latitude > 90 || input.longitude < -180 || input.longitude > 180) {
    throw new AppError("ValidationError", "As coordenadas informadas são inválidas.");
  }
  if (input.batteryLevel !== undefined && (input.batteryLevel < 0 || input.batteryLevel > 100)) {
    throw new AppError("ValidationError", "O nível de bateria deve estar entre 0 e 100.");
  }
}

/**
 * Record the caller's current position and refresh their presence on every
 * active family membership, so the family map/list reflects the new fix even
 * before location_events are joined. A `deviceId`, when supplied, must belong
 * to the caller.
 */
export async function recordLocation(userId: string, input: RecordLocationInput) {
  validate(input);
  const now = new Date();

  let deviceId: string | null = null;
  if (input.deviceId) {
    const device = await prisma.devices.findFirst({
      where: { Id: input.deviceId, UserId: userId },
      select: { Id: true },
    });
    if (!device) throw new AppError("DeviceNotOwned", "O dispositivo informado não pertence ao usuário.", 403);
    deviceId = device.Id;
  }

  const event = await prisma.location_events.create({
    data: {
      Id: randomUUID(),
      UserId: userId,
      DeviceId: deviceId,
      Latitude: input.latitude,
      Longitude: input.longitude,
      AccuracyMeters: input.accuracyMeters ?? null,
      BatteryLevel: input.batteryLevel ?? null,
      IsCharging: input.isCharging ?? null,
      SourceType: LOCATION_SOURCE_FAMILY,
      FamilyId: input.familyId ?? null,
      CapturedAt: now,
      ReceivedAt: now,
    },
  });

  await prisma.family_members.updateMany({
    where: { UserId: userId, Status: { not: STATUS.disabled } },
    data: {
      LastSeenAt: now,
      ...(input.batteryLevel !== undefined ? { BatteryLevel: input.batteryLevel } : {}),
      ...(input.locationLabel ? { LastLocationLabel: input.locationLabel.slice(0, 120) } : {}),
    },
  });

  if (deviceId) {
    await prisma.devices.update({ where: { Id: deviceId }, data: { LastSeenAt: now, IsActive: true } });
  }

  // Geofencing: update safety-zone occupancy and surface any entry/exit
  // transitions. Must never block a location update.
  let zoneTransitions: { zoneId: string; zoneName: string; entered: boolean }[] = [];
  try {
    zoneTransitions = await evaluateLocation(userId, input.latitude, input.longitude);
  } catch {
    /* geofence evaluation is best-effort */
  }

  return {
    id: event.Id,
    zoneTransitions,
    latitude: event.Latitude,
    longitude: event.Longitude,
    accuracyMeters: event.AccuracyMeters,
    capturedAt: event.CapturedAt.toISOString(),
  };
}

interface LatestLocation {
  Latitude: number;
  Longitude: number;
  AccuracyMeters: number | null;
  CapturedAt: Date;
}

/** Latest known location per user (DISTINCT ON UserId, newest first). */
async function latestLocationsByUser(userIds: string[]): Promise<Map<string, LatestLocation>> {
  const map = new Map<string, LatestLocation>();
  if (userIds.length === 0) return map;
  const events = await prisma.location_events.findMany({
    where: { UserId: { in: userIds } },
    orderBy: [{ UserId: "asc" }, { ReceivedAt: "desc" }],
    distinct: ["UserId"],
    select: { UserId: true, Latitude: true, Longitude: true, AccuracyMeters: true, CapturedAt: true },
  });
  for (const e of events) map.set(e.UserId, e);
  return map;
}

/**
 * Members across the caller's active families with their last known location.
 *
 * Location is shown when the viewer is the member themselves, or the member
 * has an active LocationSharing consent — either self-granted (user-level, via
 * the Consent Center) or family-granted (admin/guardian per member). The
 * `canViewLocation` flag travels on the wire so the UI can explain a hidden pin.
 */
export async function getFamilyMap(userId: string) {
  const myMemberships = await prisma.family_members.findMany({
    where: { UserId: userId, Status: { not: STATUS.disabled } },
    select: { FamilyId: true },
  });
  const familyIds = [...new Set(myMemberships.map((m) => m.FamilyId))];
  if (familyIds.length === 0) return [];

  const members = await prisma.family_members.findMany({
    where: { FamilyId: { in: familyIds }, Status: { not: STATUS.disabled } },
    orderBy: { JoinedAt: "asc" },
    include: { users: { select: { FullName: true, AvatarUrl: true } } },
  });

  const userIds = [...new Set(members.map((m) => m.UserId).filter((id): id is string => !!id))];
  const latestByUser = await latestLocationsByUser(userIds);

  return Promise.all(
    members.map(async (m) => {
      const base = mapMember(m);
      const loc = m.UserId ? latestByUser.get(m.UserId) : undefined;
      const canViewLocation =
        !!m.UserId &&
        (m.UserId === userId ||
          (await hasActiveUserConsent(m.UserId, "LocationSharing")) ||
          (await hasActiveFamilyConsent(m.FamilyId, m.UserId, "LocationSharing")));
      const show = canViewLocation && loc;
      return {
        ...base,
        latitude: show ? loc!.Latitude : null,
        longitude: show ? loc!.Longitude : null,
        accuracyMeters: show ? loc!.AccuracyMeters : null,
        locationCapturedAt: show ? loc!.CapturedAt.toISOString() : null,
        canViewLocation,
      };
    }),
  );
}
