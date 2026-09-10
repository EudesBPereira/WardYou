// Reproduz o cenario relatado em QA: o responsavel aprova a entrada e a tela do
// novo membro deveria sair de "Conta em analise" sozinha.
//
//   cd apps/api
//   E2E_BASE=https://... node scripts/e2e-approval-realtime.mjs
//
// Testa a cadeia inteira: membro pendente conectado ao Socket.IO -> admin aprova
// -> o evento `MembershipApproved` chega no aparelho do membro -> /profile/me
// deixa de responder `pending`.
import { io } from "socket.io-client";

const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:3000";
const STAMP = Date.now();
const resultados = [];
const check = (nome, ok, extra = "") => {
  resultados.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${nome}${extra ? " — " + extra : ""}`);
};

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
  try { json = await res.json(); } catch { /* sem corpo */ }
  return { status: res.status, json };
}

async function registrar(rotulo) {
  const email = `qa-approve-${rotulo}-${STAMP}@test.local`;
  const { json } = await api("/api/v1/auth/register", {
    method: "POST",
    body: { fullName: `QA Approve ${rotulo}`, email, password: "QaApprove!2026", confirmPassword: "QaApprove!2026" },
  });
  return { email, token: json.accessToken, userId: json.userId };
}

const admin = await registrar("admin");
const novo = await registrar("novo");
console.log(`admin: ${admin.userId}\nnovo:  ${novo.userId}\n`);

const { json: familia } = await api("/api/v1/families", {
  method: "POST", token: admin.token, body: { name: `QA Aprovacao ${STAMP}` },
});
check("admin cria a familia", !!familia?.id);

const { json: convite } = await api(`/api/v1/families/${familia.id}/invites`, {
  method: "POST", token: admin.token,
});
check("convite gerado", !!convite?.inviteCode, convite?.inviteCode);

const entrada = await api("/api/v1/families/join", {
  method: "POST", token: novo.token, body: { inviteCode: convite.inviteCode },
});
check("novo membro entra (fica pendente)", entrada.status === 200 || entrada.status === 201);

const { json: perfilAntes } = await api("/api/v1/profile/me", { token: novo.token });
check("perfil do novo membro = pending", perfilAntes?.appProfile === "pending", perfilAntes?.appProfile);

// O aparelho do novo membro: socket conectado, parado na tela "Conta em analise".
const socket = io(BASE, {
  path: "/realtime", auth: { token: novo.token },
  transports: ["websocket"], reconnection: false, timeout: 20000,
});
const conectou = await new Promise((res) => {
  socket.on("connect", () => res(true));
  socket.on("connect_error", () => res(false));
  setTimeout(() => res(false), 20000);
});
check("aparelho do novo membro conectado ao realtime", conectou);

const eventoChegou = new Promise((res) => {
  socket.on("MembershipApproved", (p) => res(p ?? {}));
  setTimeout(() => res(null), 15000);
});

// O admin aprova, como fez no aparelho.
const { json: membros } = await api("/api/v1/families/members", { token: admin.token });
const pendente = (membros ?? []).find((m) => m.userId === novo.userId);
check("admin enxerga o membro pendente", !!pendente);

const aprovacao = await api(`/api/v1/families/${familia.id}/members/${pendente.id}/approve`, {
  method: "POST", token: admin.token, body: { role: "member" },
});
check("aprovacao aceita pelo servidor", aprovacao.status === 200, `HTTP ${aprovacao.status}`);

const evento = await eventoChegou;
check("evento MembershipApproved chegou no aparelho do membro", evento !== null,
  evento === null ? "NAO CHEGOU em 15s" : JSON.stringify(evento));

const { json: perfilDepois } = await api("/api/v1/profile/me", { token: novo.token });
check("perfil deixou de ser pending", perfilDepois?.appProfile !== "pending", perfilDepois?.appProfile);

socket.close();
const ok = resultados.filter(Boolean).length;
console.log(`\n${ok}/${resultados.length} passaram`);
process.exit(ok === resultados.length ? 0 : 1);
