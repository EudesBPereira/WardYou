// Hard-delete specific users and everything hanging off them, for resetting a
// test account to a clean slate. Targets exact user IDs (never a name/email
// substring) and runs inside a single transaction — if any step fails, nothing
// is committed. Extends the FK coverage of cleanup-e2e-users.mjs (audit,
// parental graph, family graph, travel, zones, SOS ack/close) since this
// targets real accounts, not just the narrow e2e fixture shape.
//
// Run from apps/api:  node --env-file=.env scripts/delete-users.mjs <userId1> <userId2> ...
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const ids = process.argv.slice(2);
if (ids.length === 0) {
  console.log("usage: node scripts/delete-users.mjs <userId1> <userId2> ...");
  process.exit(1);
}

const users = await prisma.users.findMany({ where: { Id: { in: ids } }, select: { Id: true, FullName: true, Email: true } });
if (users.length === 0) {
  console.log("nenhum usuário encontrado para os ids informados");
  process.exit(0);
}
console.log("apagando:", users.map((u) => `${u.FullName} <${u.Email}>`).join(", "));

await prisma.$transaction(async (tx) => {
  // Parental graph (NoAction FKs that don't cascade from users).
  await tx.task_completions.deleteMany({ where: { OR: [{ ChildUserId: { in: ids } }, { ReviewedByUserId: { in: ids } }] } });
  await tx.child_tasks.deleteMany({ where: { OR: [{ ChildUserId: { in: ids } }, { CreatedByUserId: { in: ids } }] } });
  await tx.extra_time_requests.deleteMany({
    where: { OR: [{ ChildUserId: { in: ids } }, { RequestedToUserId: { in: ids } }, { RespondedByUserId: { in: ids } }] },
  });
  const policies = await tx.child_device_policies.findMany({
    where: { OR: [{ ChildUserId: { in: ids } }, { ManagedByUserId: { in: ids } }] },
    select: { Id: true },
  });
  const policyIds = policies.map((p) => p.Id);
  if (policyIds.length > 0) {
    await tx.app_rules.deleteMany({ where: { ChildDevicePolicyId: { in: policyIds } } });
    await tx.sleep_schedules.deleteMany({ where: { ChildDevicePolicyId: { in: policyIds } } });
    await tx.app_block_schedules.deleteMany({ where: { ChildDevicePolicyId: { in: policyIds } } });
    await tx.child_device_policies.deleteMany({ where: { Id: { in: policyIds } } });
  }
  await tx.app_usage_summaries.deleteMany({ where: { ChildUserId: { in: ids } } });
  await tx.child_device_statuses.deleteMany({ where: { ChildUserId: { in: ids } } });

  // Audit + location.
  await tx.audit_logs.deleteMany({ where: { OR: [{ ActorUserId: { in: ids } }, { TargetUserId: { in: ids } }] } });
  await tx.location_events.deleteMany({ where: { UserId: { in: ids } } });

  // SOS: TriggeredByUserId cascades; Acknowledged/Closed are optional NoAction
  // FKs — null them out rather than deleting someone else's SOS event.
  await tx.sos_events.updateMany({ where: { AcknowledgedByUserId: { in: ids } }, data: { AcknowledgedByUserId: null } });
  await tx.sos_events.updateMany({ where: { ClosedByUserId: { in: ids } }, data: { ClosedByUserId: null } });

  // Safety zones.
  await tx.safety_zone_members.deleteMany({ where: { UserId: { in: ids } } });
  await tx.safety_zone_occupancies.deleteMany({ where: { UserId: { in: ids } } });
  await tx.safety_zones.deleteMany({ where: { CreatedByUserId: { in: ids } } });

  // Travel graph.
  await tx.travel_invites.deleteMany({ where: { OR: [{ CreatedByUserId: { in: ids } }, { UsedByUserId: { in: ids } }] } });
  await tx.travel_group_members.deleteMany({ where: { UserId: { in: ids } } });
  await tx.travel_groups.deleteMany({ where: { CreatedByUserId: { in: ids } } });

  // remote_commands (unused by the Node stack per CLAUDE.md, but cover it defensively).
  await tx.remote_commands.deleteMany({ where: { OR: [{ RequestedByUserId: { in: ids } }, { TargetUserId: { in: ids } }] } });

  // Family graph. A family is fully removed only if every member is in `ids`
  // (mirrors cleanup-e2e-users.mjs) — never touches a family with an outside member.
  const touched = await tx.family_members.findMany({ where: { UserId: { in: ids } }, select: { FamilyId: true } });
  const candidateIds = [...new Set(touched.map((m) => m.FamilyId))];
  const familyIds = [];
  for (const fid of candidateIds) {
    const outsiders = await tx.family_members.count({ where: { FamilyId: fid, OR: [{ UserId: null }, { UserId: { notIn: ids } }] } });
    if (outsiders === 0) familyIds.push(fid);
  }
  await tx.family_consents.deleteMany({
    where: { OR: [{ GrantedByUserId: { in: ids } }, { UserId: { in: ids } }, ...(familyIds.length ? [{ FamilyId: { in: familyIds } }] : [])] },
  });
  await tx.family_invites.deleteMany({
    where: { OR: [{ CreatedByUserId: { in: ids } }, ...(familyIds.length ? [{ FamilyId: { in: familyIds } }] : [])] },
  });
  await tx.family_members.deleteMany({ where: { OR: [{ UserId: { in: ids } }, ...(familyIds.length ? [{ FamilyId: { in: familyIds } }] : [])] } });
  if (familyIds.length > 0) {
    console.log("removendo família(s) totalmente própria(s):", familyIds.join(", "));
    await tx.families.deleteMany({ where: { Id: { in: familyIds } } });
  }

  // Finally the users themselves — cascades away devices, refresh_tokens,
  // user_consents, consent_grants, medication_reminders, and any remaining
  // rows with ON DELETE CASCADE (see schema.prisma).
  await tx.users.deleteMany({ where: { Id: { in: ids } } });
}, { timeout: 30000, maxWait: 15000 });

console.log(`removido(s) ${users.length} usuário(s) e todos os dados vinculados`);
await prisma.$disconnect();
