// Teste real de push ponta a ponta ("modo de teste do SOS").
//
//   cd apps/api
//   SA_PATH=~/.wardyou/wardyou-fcm.json node --env-file=.env.qa scripts/test-push.mjs
//
// Pega o token do aparelho no banco e manda uma notificacao pelo FCM HTTP v1
// com a MESMA service account que a API usa. Prova de uma vez: credencial
// valida, token valido e aparelho recebendo. Um SOS nunca testado e uma falsa
// sensacao de protecao — este script existe para isso nao acontecer.
//
// Opcional: PUSH_TOKEN=<token> para mirar um aparelho especifico.
import { readFileSync } from "node:fs";
import { JWT } from "google-auth-library";
import { PrismaClient } from "@prisma/client";

const saPath = process.env.SA_PATH;
if (!saPath) {
  console.error("defina SA_PATH apontando para o JSON da service account do FCM");
  process.exit(1);
}
const SA = JSON.parse(readFileSync(saPath, "utf8"));

let token = process.env.PUSH_TOKEN;
let alvo = "token passado por env";

if (!token) {
  const prisma = new PrismaClient();
  const device = await prisma.devices.findFirst({
    where: { PushToken: { not: null }, IsActive: true },
    orderBy: { LastSeenAt: "desc" },
    select: { PushToken: true, DeviceName: true, Platform: true, UserId: true },
  });
  await prisma.$disconnect();
  if (!device) {
    console.error("nenhum dispositivo com PushToken — o app chegou a registrar?");
    process.exit(1);
  }
  token = device.PushToken;
  alvo = `${device.DeviceName} (${device.Platform})`;
}

console.log(`alvo:  ${alvo}`);
console.log(`token: ${token.slice(0, 20)}...${token.slice(-8)}  (${token.length} chars)`);

const jwt = new JWT({
  email: SA.client_email,
  key: SA.private_key,
  scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
});
const { access_token: accessToken } = await jwt.authorize();
console.log(`credencial FCM: OK (projeto ${SA.project_id})`);

const res = await fetch(
  `https://fcm.googleapis.com/v1/projects/${SA.project_id}/messages:send`,
  {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      message: {
        token,
        notification: {
          title: "WardYou — teste de QA",
          body: "Se voce esta lendo isto, o push funciona de ponta a ponta.",
        },
        android: { priority: "HIGH", notification: { channel_id: "default" } },
        data: { tipo: "qa-test" },
      },
    }),
  },
);

const body = await res.json();
if (res.ok) {
  console.log(`ENVIADO — HTTP ${res.status}`);
  console.log(`id: ${body.name}`);
} else {
  console.log(`FALHOU — HTTP ${res.status}`);
  console.log(JSON.stringify(body, null, 2).slice(0, 800));
  process.exit(1);
}
