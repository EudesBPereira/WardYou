// e2e for the role-based profile + kids module against the local Node API:
// approval with role, /profile/me derivation, child my-status, extra time,
// task rewards, heartbeat and authz negatives. Cleanup: cleanup-e2e-users.mjs.
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
  const email = `wardyou-e2e-kids-${tag}-${STAMP}@test.local`;
  const password = "E2e!Kids12345";
  const reg = await api("/api/v1/auth/register", {
    method: "POST",
    body: { fullName: `E2E Kids ${tag}`, email, password, confirmPassword: password },
  });
  if (reg.status !== 200 && reg.status !== 201) throw new Error(`register ${tag}: ${reg.status} ${JSON.stringify(reg.json)}`);
  return { email, userId: reg.json.userId, token: reg.json.accessToken };
}

const admin = await registerAndLogin("admin");
const child = await registerAndLogin("child");
const elder = await registerAndLogin("elder");

// Family + joins
const fam = await api("/api/v1/families", { method: "POST", token: admin.token, body: { name: "E2E Kids Família" } });
check("create family", fam.status === 201 || fam.status === 200, `status=${fam.status}`);
const familyId = fam.json.id;
const inviteCode = fam.json.inviteCode;

const joinC = await api("/api/v1/families/join", { method: "POST", token: child.token, body: { inviteCode } });
check("child joins (pending)", (joinC.status === 200 || joinC.status === 201) && joinC.json.membershipStatus === "pending");
const joinE = await api("/api/v1/families/join", { method: "POST", token: elder.token, body: { inviteCode } });
check("elder joins (pending)", joinE.status === 200 || joinE.status === 201);

// Profile before approval: awaiting an admin → "pending" (NOT "member"), so the
// app routes to the waiting screen instead of the full adult tabs.
const profPending = await api("/api/v1/profile/me", { token: child.token });
check(
  "profile before approval = pending",
  profPending.status === 200 && profPending.json.appProfile === "pending",
  profPending.json?.appProfile,
);

// Approve with role — the moment that decides the app experience.
const membersList = await api("/api/v1/families/members", { token: admin.token });
const cRow = membersList.json.find((m) => m.userId === child.userId);
const eRow = membersList.json.find((m) => m.userId === elder.userId);
const apprC = await api(`/api/v1/families/${familyId}/members/${cRow.id}/approve`, {
  method: "POST", token: admin.token, body: { role: "child" },
});
check("approve as child", apprC.status === 200 && apprC.json.role === "child" && apprC.json.membershipStatus === "active");
const apprE = await api(`/api/v1/families/${familyId}/members/${eRow.id}/approve`, {
  method: "POST", token: admin.token, body: { role: "elder" },
});
check("approve as elder", apprE.status === 200 && apprE.json.role === "elder");

// Profiles after approval
const profC = await api("/api/v1/profile/me", { token: child.token });
check("child profile = child", profC.json?.appProfile === "child", JSON.stringify(profC.json?.appProfile));
const profE = await api("/api/v1/profile/me", { token: elder.token });
check("elder profile = elder", profE.json?.appProfile === "elder");
const profA = await api("/api/v1/profile/me", { token: admin.token });
check("admin profile = guardian", profA.json?.appProfile === "guardian");

// Role change + last-admin guard
const roleChange = await api(`/api/v1/families/${familyId}/members/${eRow.id}/role`, {
  method: "PUT", token: admin.token, body: { role: "member" },
});
check("PUT role elder→member", roleChange.status === 200 && roleChange.json.role === "member");
const back = await api(`/api/v1/families/${familyId}/members/${eRow.id}/role`, {
  method: "PUT", token: admin.token, body: { role: "elder" },
});
check("PUT role member→elder", back.status === 200 && back.json.role === "elder");
const meRow = membersList.json.find((m) => m.userId === admin.userId);
const demote = await api(`/api/v1/families/${familyId}/members/${meRow.id}/role`, {
  method: "PUT", token: admin.token, body: { role: "member" },
});
check("last admin cannot demote himself (409)", demote.status === 409);
const roleByChild = await api(`/api/v1/families/${familyId}/members/${eRow.id}/role`, {
  method: "PUT", token: child.token, body: { role: "member" },
});
check("child cannot change roles (403)", roleByChild.status === 403);

// Parental: policy → my-status
// An approved child gets a policy created on first read (enabled by default) so
// the device starts enforcing immediately, without waiting for the guardian to
// open the policy screen. hasPolicy=false only for non-children.
const noStatus = await api("/api/v1/parental/my-status", { token: child.token });
check(
  "my-status auto-creates the policy for a child",
  noStatus.status === 200 && noStatus.json.hasPolicy === true,
  `hasPolicy=${noStatus.json?.hasPolicy}`,
);
const policy = await api(`/api/v1/parental/children/${child.userId}/policy`, {
  method: "PUT", token: admin.token, body: { dailyScreenTimeLimitMinutes: 120, isEnabled: true },
});
check("admin sets policy", policy.status === 200 && policy.json.isEnabled === true);
let st = await api("/api/v1/parental/my-status", { token: child.token });
check("my-status: limit 120, remaining 120", st.json?.hasPolicy && st.json.dailyLimitMinutes === 120 && st.json.remainingMinutes === 120);

// Extra time: request → pending → approve → reflected in my-status
const ask = await api("/api/v1/parental/extra-time/request", {
  method: "POST", token: child.token, body: { childUserId: child.userId, requestedMinutes: 15 },
});
check("child asks +15min", ask.status === 200 || ask.status === 201);
st = await api("/api/v1/parental/my-status", { token: child.token });
check("my-status shows pending request", st.json?.pendingExtraRequest?.requestedMinutes === 15);
const pend = await api("/api/v1/parental/extra-time/pending", { token: admin.token });
const reqRow = pend.json.find((r) => r.childUserId === child.userId);
check("admin sees pending extra time", !!reqRow);
const appr = await api(`/api/v1/parental/extra-time/${reqRow.id}/approve`, { method: "PUT", token: admin.token });
check("admin approves extra time", appr.status === 200 && appr.json.status === "Approved");
st = await api("/api/v1/parental/my-status", { token: child.token });
check("my-status: +15 extra, remaining 135", st.json?.extraMinutesToday === 15 && st.json.remainingMinutes === 135 && !st.json.pendingExtraRequest);

// Tasks: create → child completes → approve → auto-credits time
const task = await api(`/api/v1/parental/children/${child.userId}/tasks`, {
  method: "POST", token: admin.token, body: { title: "Arrumar o quarto", category: "Household", rewardMinutes: 20 },
});
check("admin creates task (+20min)", task.status === 200 || task.status === 201);
const myTasks = await api("/api/v1/parental/tasks/my", { token: child.token });
check("child sees the task", myTasks.json?.tasks?.length === 1);
const done = await api("/api/v1/parental/tasks/complete", {
  method: "POST", token: child.token, body: { taskId: task.json.id, childNote: "feito!" },
});
check("child submits completion", done.status === 200 || done.status === 201);
const pendC = await api("/api/v1/parental/tasks/completions/pending", { token: admin.token });
const compRow = pendC.json.find((c) => c.childUserId === child.userId);
check("admin sees pending completion", !!compRow);
const apprComp = await api(`/api/v1/parental/tasks/completions/${compRow.id}/approve`, {
  method: "PUT", token: admin.token, body: {},
});
check("admin approves completion", apprComp.status === 200);
st = await api("/api/v1/parental/my-status", { token: child.token });
check("task reward credited: extra 35, remaining 155", st.json?.extraMinutesToday === 35 && st.json.remainingMinutes === 155, JSON.stringify({ extra: st.json?.extraMinutesToday, rem: st.json?.remainingMinutes }));

// Heartbeat → guardian sees the child connected
const hb = await api("/api/v1/parental/heartbeat", {
  method: "POST", token: child.token, body: { hasUsageAccess: false, hasAccessibility: false, appVersion: "e2e" },
});
check("child heartbeat", hb.status === 204);
const children = await api("/api/v1/parental/children", { token: admin.token });
const childRow = children.json.find((c) => c.userId === child.userId);
check("guardian sees child connected", childRow?.isConnected === true);

// Elder care: guardian manages medications → elder reads their own schedule
const elders = await api("/api/v1/elder/elders", { token: admin.token });
check("guardian lists elders", elders.status === 200 && elders.json.some((e) => e.userId === elder.userId));
const meds = await api(`/api/v1/elder/${elder.userId}/medications`, {
  method: "PUT", token: admin.token,
  body: { medications: [{ name: "Losartana", dosage: "50mg", times: ["08:00", "20:00"], daysOfWeek: 127 }] },
});
check("guardian sets medications", meds.status === 200 && meds.json.length === 1);
const myMeds = await api("/api/v1/elder/medications/my", { token: elder.token });
check(
  "elder sees own medications",
  myMeds.status === 200 && myMeds.json[0]?.name === "Losartana" && myMeds.json[0]?.times?.length === 2,
);
const medsByChild = await api(`/api/v1/elder/${elder.userId}/medications`, {
  method: "PUT", token: child.token,
  body: { medications: [] },
});
check("child cannot edit elder medications", medsByChild.status === 403 || medsByChild.status === 404);

// Authz negatives
const childSetsPolicy = await api(`/api/v1/parental/children/${child.userId}/policy`, {
  method: "PUT", token: child.token, body: { dailyScreenTimeLimitMinutes: 999, isEnabled: false },
});
check("child cannot edit own policy (403)", childSetsPolicy.status === 403);
const childApproves = await api(`/api/v1/families/${familyId}/members/${eRow.id}/approve`, {
  method: "POST", token: child.token, body: { role: "member" },
});
check("child cannot approve members (403)", childApproves.status === 403);

// ── Blocked-screen requests → guardian's pending queue → decision ──────────
// The child taps "Pedir liberação" on the native blocked panel; the guardian
// must SEE it (not just get a push) and be able to allow/deny it.
const PKG = "com.example.blocked";
const askAccess = await api("/api/v1/parental/request-app-access", {
  method: "POST", token: child.token, body: { packageName: PKG, label: "Blocked App" },
});
check("child asks to unlock an app", askAccess.status === 200 || askAccess.status === 201);

const pend1 = await api(`/api/v1/parental/children/${child.userId}/requests`, { token: admin.token });
check(
  "guardian sees the app request pending",
  pend1.status === 200 && (pend1.json.appAccess ?? []).some((r) => r.packageName === PKG),
  JSON.stringify(pend1.json?.appAccess ?? []),
);

const childPeeks = await api(`/api/v1/parental/children/${child.userId}/requests`, { token: child.token });
check("child cannot read the pending queue (403)", childPeeks.status === 403);

const decide = await api(`/api/v1/parental/children/${child.userId}/requests/app-access`, {
  method: "POST", token: admin.token, body: { packageName: PKG, approve: true },
});
check("guardian approves the app request", decide.status === 200 || decide.status === 201);

const pend2 = await api(`/api/v1/parental/children/${child.userId}/requests`, { token: admin.token });
check(
  "request leaves the queue once decided",
  pend2.status === 200 && !(pend2.json.appAccess ?? []).some((r) => r.packageName === PKG),
);

const rules = await api(`/api/v1/parental/children/${child.userId}/apps`, { token: admin.token });
check(
  "approving whitelists the app on the device policy",
  rules.status === 200 && (rules.json ?? []).some((r) => r.appPackageName === PKG && r.isWhitelisted),
);

// ── Guardian sets a member's photo (children rarely set their own) ─────────
const cRow2 = (await api("/api/v1/families/members", { token: admin.token })).json?.find(
  (m) => m.userId === child.userId,
);
const tinyPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const setAvatar = await api(`/api/v1/families/${familyId}/members/${cRow2.id}/avatar`, {
  method: "PUT", token: admin.token, body: { avatarUrl: tinyPng },
});
check("guardian sets the child's photo", setAvatar.status === 200);

const avatarByChild = await api(`/api/v1/families/${familyId}/members/${cRow2.id}/avatar`, {
  method: "PUT", token: child.token, body: { avatarUrl: tinyPng },
});
check("child cannot change photos (403)", avatarByChild.status === 403);

const badAvatar = await api(`/api/v1/families/${familyId}/members/${cRow2.id}/avatar`, {
  method: "PUT", token: admin.token, body: { avatarUrl: "javascript:alert(1)" },
});
check("invalid photo payload is rejected", badAvatar.status === 400);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
