import { randomUUID } from "node:crypto";
import { prisma } from "../db.js";
import { AppError } from "../lib/errors.js";
import { ROLE } from "./familyService.js";
import { emitToFamily } from "../realtime.js";

const MANAGEMENT_ROLES = new Set<number>([ROLE.admin, ROLE.guardian]);
const STATUS_DISABLED = 2;

export interface UpsertZoneInput {
  familyId: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  notifyOnEntry: boolean;
  notifyOnExit: boolean;
  memberUserIds?: string[];
}

interface ZoneRow {
  Id: string;
  FamilyId: string;
  Name: string;
  Latitude: number;
  Longitude: number;
  RadiusMeters: number;
  NotifyOnEntry: boolean;
  NotifyOnExit: boolean;
  IsActive: boolean;
  CreatedAt: Date;
}

function mapZone(z: ZoneRow, memberUserIds: string[]) {
  return {
    id: z.Id,
    familyId: z.FamilyId,
    name: z.Name,
    latitude: z.Latitude,
    longitude: z.Longitude,
    radiusMeters: z.RadiusMeters,
    notifyOnEntry: z.NotifyOnEntry,
    notifyOnExit: z.NotifyOnExit,
    isActive: z.IsActive,
    createdAt: z.CreatedAt.toISOString(),
    memberUserIds,
  };
}

function validate(input: UpsertZoneInput) {
  if (!input.name?.trim()) throw new AppError("ZoneNameRequired", "Informe um nome para a zona.", 400);
  if (input.radiusMeters < 50 || input.radiusMeters > 20000) {
    throw new AppError("ZoneRadiusInvalid", "O raio deve ficar entre 50 e 20000 metros.", 400);
  }
}

async function requireMembership(familyId: string, userId: string, management: boolean) {
  const m = await prisma.family_members.findFirst({
    where: { FamilyId: familyId, UserId: userId, Status: { not: STATUS_DISABLED } },
  });
  if (!m) throw new AppError("NotFamilyMember", "Você não pertence a esta família.", 403);
  if (management && !MANAGEMENT_ROLES.has(m.Role)) {
    throw new AppError("InsufficientRole", "Apenas administradores ou responsáveis podem gerenciar zonas.", 403);
  }
  return m;
}

export async function getZones(userId: string, familyId: string) {
  await requireMembership(familyId, userId, false);
  const zones = await prisma.safety_zones.findMany({
    where: { FamilyId: familyId, IsActive: true },
    orderBy: { Name: "asc" },
  });
  const zoneIds = zones.map((z) => z.Id);
  const members =
    zoneIds.length === 0
      ? []
      : await prisma.safety_zone_members.findMany({ where: { ZoneId: { in: zoneIds } } });
  return zones.map((z) => mapZone(z, members.filter((m) => m.ZoneId === z.Id).map((m) => m.UserId)));
}

async function setMembers(zoneId: string, memberUserIds?: string[]) {
  if (!memberUserIds || memberUserIds.length === 0) return;
  const unique = [...new Set(memberUserIds)];
  await prisma.safety_zone_members.createMany({
    data: unique.map((userId) => ({ Id: randomUUID(), ZoneId: zoneId, UserId: userId })),
    skipDuplicates: true,
  });
}

export async function createZone(userId: string, input: UpsertZoneInput) {
  await requireMembership(input.familyId, userId, true);
  validate(input);
  const zone = await prisma.safety_zones.create({
    data: {
      Id: randomUUID(),
      FamilyId: input.familyId,
      Name: input.name.trim(),
      Latitude: input.latitude,
      Longitude: input.longitude,
      RadiusMeters: input.radiusMeters,
      NotifyOnEntry: input.notifyOnEntry,
      NotifyOnExit: input.notifyOnExit,
      IsActive: true,
      CreatedByUserId: userId,
      CreatedAt: new Date(),
    },
  });
  await setMembers(zone.Id, input.memberUserIds);
  return mapZone(zone, [...new Set(input.memberUserIds ?? [])]);
}

export async function updateZone(userId: string, zoneId: string, input: UpsertZoneInput) {
  validate(input);
  const zone = await prisma.safety_zones.findFirst({ where: { Id: zoneId } });
  if (!zone) throw new AppError("ZoneNotFound", "Zona não encontrada.", 404);
  await requireMembership(zone.FamilyId, userId, true);

  const updated = await prisma.safety_zones.update({
    where: { Id: zoneId },
    data: {
      Name: input.name.trim(),
      Latitude: input.latitude,
      Longitude: input.longitude,
      RadiusMeters: input.radiusMeters,
      NotifyOnEntry: input.notifyOnEntry,
      NotifyOnExit: input.notifyOnExit,
      UpdatedAt: new Date(),
    },
  });
  // Replace member restrictions.
  await prisma.safety_zone_members.deleteMany({ where: { ZoneId: zoneId } });
  await setMembers(zoneId, input.memberUserIds);
  return mapZone(updated, [...new Set(input.memberUserIds ?? [])]);
}

export async function deleteZone(userId: string, zoneId: string) {
  const zone = await prisma.safety_zones.findFirst({ where: { Id: zoneId } });
  if (!zone) throw new AppError("ZoneNotFound", "Zona não encontrada.", 404);
  await requireMembership(zone.FamilyId, userId, true);
  await prisma.safety_zones.update({ where: { Id: zoneId }, data: { IsActive: false, UpdatedAt: new Date() } });
}

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Update each applicable zone's occupancy for the user and return the entry/exit
 * transitions detected. Member-scoped zones apply only to their listed members;
 * member-less zones apply to everyone. Realtime/push notification of transitions
 * arrives with the push phase — here we keep occupancy state consistent.
 */
export async function evaluateLocation(userId: string, latitude: number, longitude: number) {
  const memberships = await prisma.family_members.findMany({
    where: { UserId: userId, Status: { not: STATUS_DISABLED } },
    select: { FamilyId: true },
  });
  const familyIds = [...new Set(memberships.map((m) => m.FamilyId))];
  if (familyIds.length === 0) return [];

  const zones = await prisma.safety_zones.findMany({
    where: { FamilyId: { in: familyIds }, IsActive: true },
  });
  if (zones.length === 0) return [];

  const zoneIds = zones.map((z) => z.Id);
  const restrictions = new Map<string, Set<string>>();
  for (const m of await prisma.safety_zone_members.findMany({ where: { ZoneId: { in: zoneIds } } })) {
    if (!restrictions.has(m.ZoneId)) restrictions.set(m.ZoneId, new Set());
    restrictions.get(m.ZoneId)!.add(m.UserId);
  }

  const transitions: { zoneId: string; zoneName: string; entered: boolean }[] = [];
  const now = new Date();
  for (const zone of zones) {
    const allowed = restrictions.get(zone.Id);
    if (allowed && !allowed.has(userId)) continue;

    const isInside = haversineMeters(latitude, longitude, zone.Latitude, zone.Longitude) <= zone.RadiusMeters;
    const occupancy = await prisma.safety_zone_occupancies.findFirst({
      where: { ZoneId: zone.Id, UserId: userId },
    });

    if (!occupancy) {
      await prisma.safety_zone_occupancies.create({
        data: { Id: randomUUID(), ZoneId: zone.Id, UserId: userId, IsInside: isInside, UpdatedAt: now },
      });
      continue; // baseline only
    }
    if (occupancy.IsInside === isInside) continue;

    await prisma.safety_zone_occupancies.update({
      where: { Id: occupancy.Id },
      data: { IsInside: isInside, UpdatedAt: now },
    });
    if ((isInside && zone.NotifyOnEntry) || (!isInside && zone.NotifyOnExit)) {
      transitions.push({ zoneId: zone.Id, zoneName: zone.Name, entered: isInside });
      emitToFamily(zone.FamilyId, "ZoneTransition", {
        zoneId: zone.Id,
        zoneName: zone.Name,
        familyId: zone.FamilyId,
        userId,
        entered: isInside,
      });
    }
  }
  return transitions;
}
