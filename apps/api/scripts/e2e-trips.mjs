// e2e for the new trip detail/map/broadcast endpoints against the local Node API.
// Creates two throwaway users, exercises the flow, and prints PASS/FAIL per step.
// Cleanup of all created rows happens in cleanup-trips.ts (prisma).
const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:3000";
const STAMP = Date.now();
const results = [];

function check(name, cond, extra = "") {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
}

async function api(path, { method = "GET", token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

async function registerAndLogin(tag) {
  const email = `wardyou-e2e-trip-${tag}-${STAMP}@test.local`;
  const password = "E2e!Trip12345";
  const reg = await api("/api/v1/auth/register", {
    method: "POST",
    body: { fullName: `E2E Trip ${tag}`, email, password, confirmPassword: password },
  });
  if (reg.status !== 200 && reg.status !== 201) throw new Error(`register ${tag}: ${reg.status} ${JSON.stringify(reg.json)}`);
  return { email, userId: reg.json.userId, token: reg.json.accessToken };
}

const a = await registerAndLogin("a");
const b = await registerAndLogin("b");
console.log("users:", a.userId, b.userId);

// A creates a trip
const created = await api("/api/v1/travels", { method: "POST", token: a.token, body: { name: "E2E Detalhe", type: "group" } });
check("create trip", created.status === 201 && created.json.isActive, `id=${created.json?.id}`);
const tripId = created.json.id;

// A renames + widens end via PUT
const upd = await api(`/api/v1/travels/${tripId}`, { method: "PUT", token: a.token, body: { name: "E2E Detalhe v2", allowMembersToSeeEachOther: true } });
check("PUT update (creator)", upd.status === 200 && upd.json.name === "E2E Detalhe v2");

// B cannot update
const updB = await api(`/api/v1/travels/${tripId}`, { method: "PUT", token: b.token, body: { name: "hack" } });
check("PUT update denied for non-creator", updB.status === 403);

// A invites, B accepts (B does NOT share live location)
const inv = await api(`/api/v1/travels/${tripId}/invites`, { method: "POST", token: a.token });
check("create invite", inv.status === 201 && !!inv.json.inviteCode);
const acc = await api(`/api/v1/travels/invites/${inv.json.inviteCode}/accept`, {
  method: "POST", token: b.token, body: { shareLiveLocation: false },
});
check("B accepts invite (no live share)", acc.status === 200 && acc.json.memberCount === 2);

// members list
const mem = await api(`/api/v1/travels/${tripId}/members`, { token: b.token });
check("GET members", mem.status === 200 && mem.json.length === 2);
const bRow = mem.json.find((m) => m.userId === b.userId);
check("member flags mapped", bRow && bRow.shareLiveLocation === false && bRow.isCreator === false && bRow.isMe === true);

// A posts a location; B cannot (didn't consent to share)
const locA = await api(`/api/v1/travels/${tripId}/location`, {
  method: "POST", token: a.token, body: { latitude: -23.55, longitude: -46.63, accuracyMeters: 10, batteryLevel: 80 },
});
check("A broadcasts location", locA.status === 201);
const locB = await api(`/api/v1/travels/${tripId}/location`, {
  method: "POST", token: b.token, body: { latitude: -23.56, longitude: -46.64 },
});
check("B broadcast blocked (403, no share)", locB.status === 403);

// map: B sees A's position (allowMembersToSeeEachOther); A sees B without position
const mapB = await api(`/api/v1/travels/${tripId}/map`, { token: b.token });
const aOnMap = mapB.json?.members?.find((m) => m.userId === a.userId);
check("GET map (as B)", mapB.status === 200 && mapB.json.travelGroupId === tripId);
check("B can see A's position", aOnMap && aOnMap.latitude === -23.55 && aOnMap.canViewLocation === true && aOnMap.isOnline === true);
check("battery gated by ShareBatteryStatus", aOnMap && aOnMap.batteryLevel === 80);

// outsider cannot see the map
const c = await registerAndLogin("c");
const mapC = await api(`/api/v1/travels/${tripId}/map`, { token: c.token });
check("outsider map denied (404)", mapC.status === 404);

// B leaves; A closes
const leave = await api(`/api/v1/travels/${tripId}/leave`, { method: "POST", token: b.token });
check("B leaves", leave.status === 204);
const closeR = await api(`/api/v1/travels/${tripId}/close`, { method: "POST", token: a.token });
check("A closes trip", closeR.status === 200 && closeR.json.isActive === false);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
console.log("CLEANUP_EMAILS=" + [a.email, b.email, c.email].join(","));
process.exit(failed.length ? 1 : 0);
