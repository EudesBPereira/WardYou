// Testa se o Socket.IO do QA aceita conexao com token real, e se o cliente
// entra na sala do usuario (o servidor emite em `user:<id>`).
import { io } from "socket.io-client";
const BASE = process.env.E2E_BASE;
const r = await fetch(`${BASE}/api/v1/auth/register`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ fullName: "QA Socket", email: `qa-socket-${Date.now()}@test.local`,
    password: "QaSocket!2026", confirmPassword: "QaSocket!2026" }),
});
const auth = await r.json();
console.log(`usuario: ${auth.userId}`);
const s = io(BASE, { path: "/realtime", auth: { token: auth.accessToken },
  transports: ["websocket"], reconnection: false, timeout: 20000 });
const fim = new Promise((res) => {
  s.on("connect", () => { console.log(`CONECTOU (id ${s.id}, transporte ${s.io.engine.transport.name})`); res("ok"); });
  s.on("connect_error", (e) => { console.log(`FALHOU: ${e.message}`); res("erro"); });
  setTimeout(() => res("timeout"), 22000);
});
const rr = await fim;
if (rr === "timeout") console.log("TIMEOUT - nao conectou em 22s");
s.close();
process.exit(0);
