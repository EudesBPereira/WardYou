// Read-only lookup: find users by name/email substring and show what's attached
// to each (family memberships + co-members, devices, tasks, zones, sos, travel).
// Run from apps/api:  node --env-file=.env scripts/find-users.mjs <term1> <term2> ...
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const terms = process.argv.slice(2);
if (terms.length === 0) {
  console.log("usage: node scripts/find-users.mjs <term1> <term2> ...");
  process.exit(1);
}

const users = await prisma.users.findMany({
  where: { OR: terms.flatMap((t) => [{ FullName: { contains: t, mode: "insensitive" } }, { Email: { contains: t, mode: "insensitive" } }]) },
  select: { Id: true, FullName: true, Email: true, CreatedAt: true },
});

if (users.length === 0) {
  console.log("nenhum usuário encontrado para:", terms.join(", "));
  process.exit(0);
}

for (const u of users) {
  console.log("\n=== ", u.FullName, "|", u.Email, "|", u.Id, "| criado em", u.CreatedAt.toISOString());

  const memberships = await prisma.family_members.findMany({
    where: { UserId: u.Id },
    select: { FamilyId: true, Role: true, families: { select: { Name: true } } },
  });
  for (const m of memberships) {
    const coMembers = await prisma.family_members.findMany({
      where: { FamilyId: m.FamilyId, UserId: { not: u.Id } },
      select: { UserId: true, Role: true, DisplayName: true, users: { select: { FullName: true, Email: true } } },
    });
    console.log(`  família "${m.families?.Name}" (${m.FamilyId}) role=${m.Role} — outros membros:`,
      coMembers.map((c) => `${c.users?.FullName ?? c.DisplayName ?? "(sem conta)"}[${c.Role}]`).join(", ") || "(nenhum)");
  }

  const devices = await prisma.devices.count({ where: { UserId: u.Id } });
  const childTasksAsChild = await prisma.child_tasks.count({ where: { ChildUserId: u.Id } });
  const childTasksCreated = await prisma.child_tasks.count({ where: { CreatedByUserId: u.Id } });
  const zonesCreated = await prisma.safety_zones.count({ where: { CreatedByUserId: u.Id } });
  const sosTriggered = await prisma.sos_events.count({ where: { TriggeredByUserId: u.Id } });
  const travelCreated = await prisma.travel_groups.count({ where: { CreatedByUserId: u.Id } });
  const auditRows = await prisma.audit_logs.count({ where: { OR: [{ ActorUserId: u.Id }, { TargetUserId: u.Id }] } });
  const asManager = await prisma.child_device_policies.count({ where: { ManagedByUserId: u.Id } });

  console.log(`  devices=${devices} childTasksAsChild=${childTasksAsChild} childTasksCreated=${childTasksCreated} zonesCreated=${zonesCreated} sosTriggered=${sosTriggered} travelCreated=${travelCreated} auditRows=${auditRows} managingPolicies=${asManager}`);
}

await prisma.$disconnect();
