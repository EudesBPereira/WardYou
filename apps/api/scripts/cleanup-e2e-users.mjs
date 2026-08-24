// Remove throwaway e2e users (and everything hanging off them) created by the
// e2e scripts. Users are matched by the @test.local e-mail suffix used only by
// those scripts, so real accounts are never touched. Deletion order follows
// the FKs that do NOT cascade from users (audit, policies, tasks, families…).
//
// Run from apps/api:  node --env-file=.env scripts/cleanup-e2e-users.mjs
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const users = await prisma.users.findMany({
  where: { Email: { endsWith: "@test.local" } },
  select: { Id: true, Email: true },
});
if (users.length === 0) {
  console.log("no e2e users found — nothing to clean");
  process.exit(0);
}
const ids = users.map((u) => u.Id);
console.log("cleaning:", users.map((u) => u.Email).join(", "));

// Parental graph.
await prisma.task_completions.deleteMany({
  where: { OR: [{ ChildUserId: { in: ids } }, { ReviewedByUserId: { in: ids } }] },
});
await prisma.child_tasks.deleteMany({
  where: { OR: [{ ChildUserId: { in: ids } }, { CreatedByUserId: { in: ids } }] },
});
await prisma.extra_time_requests.deleteMany({
  where: { OR: [{ ChildUserId: { in: ids } }, { RequestedToUserId: { in: ids } }, { RespondedByUserId: { in: ids } }] },
});
const policies = await prisma.child_device_policies.findMany({
  where: { OR: [{ ChildUserId: { in: ids } }, { ManagedByUserId: { in: ids } }] },
  select: { Id: true },
});
const policyIds = policies.map((p) => p.Id);
if (policyIds.length > 0) {
  await prisma.app_rules.deleteMany({ where: { ChildDevicePolicyId: { in: policyIds } } });
  await prisma.sleep_schedules.deleteMany({ where: { ChildDevicePolicyId: { in: policyIds } } });
  await prisma.app_block_schedules.deleteMany({ where: { ChildDevicePolicyId: { in: policyIds } } });
  await prisma.child_device_policies.deleteMany({ where: { Id: { in: policyIds } } });
}
await prisma.app_usage_summaries.deleteMany({ where: { ChildUserId: { in: ids } } });
await prisma.child_device_statuses.deleteMany({ where: { ChildUserId: { in: ids } } });

// Audit + location.
await prisma.audit_logs.deleteMany({
  where: { OR: [{ ActorUserId: { in: ids } }, { TargetUserId: { in: ids } }] },
});
await prisma.location_events.deleteMany({ where: { UserId: { in: ids } } });

// Family graph (family_members.UserId does not cascade). `families` has no
// creator column, so an "e2e family" is one where every member is an e2e user.
const touched = await prisma.family_members.findMany({
  where: { UserId: { in: ids } },
  select: { FamilyId: true },
});
const candidateIds = [...new Set(touched.map((m) => m.FamilyId))];
const familyIds = [];
for (const fid of candidateIds) {
  const outsiders = await prisma.family_members.count({
    where: { FamilyId: fid, OR: [{ UserId: null }, { UserId: { notIn: ids } }] },
  });
  if (outsiders === 0) familyIds.push(fid);
}
await prisma.family_consents.deleteMany({
  where: { OR: [{ GrantedByUserId: { in: ids } }, ...(familyIds.length ? [{ FamilyId: { in: familyIds } }] : [])] },
});
await prisma.family_invites.deleteMany({
  where: { OR: [{ CreatedByUserId: { in: ids } }, ...(familyIds.length ? [{ FamilyId: { in: familyIds } }] : [])] },
});
await prisma.family_members.deleteMany({
  where: { OR: [{ UserId: { in: ids } }, ...(familyIds.length ? [{ FamilyId: { in: familyIds } }] : [])] },
});
if (familyIds.length > 0) {
  await prisma.families.deleteMany({ where: { Id: { in: familyIds } } });
}

// Travel graph.
await prisma.travel_invites.deleteMany({
  where: { OR: [{ CreatedByUserId: { in: ids } }, { UsedByUserId: { in: ids } }] },
});
await prisma.travel_group_members.deleteMany({ where: { UserId: { in: ids } } });
await prisma.travel_groups.deleteMany({ where: { CreatedByUserId: { in: ids } } });

await prisma.users.deleteMany({ where: { Id: { in: ids } } });
console.log(`removed ${users.length} e2e user(s) and their data`);
await prisma.$disconnect();
