// Publica o APK no Firebase App Distribution usando a MESMA service account do
// FCM — sem depender do firebase CLI (que exige login interativo).
//
//   SA_PATH=~/.wardyou/wardyou-fcm.json \
//   APK=apps/mobile/android/app/build/outputs/apk/release/app-release.apk \
//   TESTERS=alguem@exemplo.com,outro@exemplo.com \
//   NOTAS="o que mudou nesta build" \
//   node apps/api/scripts/distribute-apk.mjs
//
// Por que nao o `firebase appdistribution:distribute`: o firebase CLI autentica
// por navegador e este ambiente nao tem stdin interativo. A API REST aceita
// service account, entao funciona sem interacao.
import { readFileSync } from "node:fs";
import { JWT } from "google-auth-library";

const APP_ID = process.env.APP_ID ?? "1:983714620760:android:0b41bb2da2b2503c4ef12d";
const PROJECT_NUMBER = process.env.PROJECT_NUMBER ?? "983714620760";
const apkPath = process.env.APK;
const saPath = process.env.SA_PATH;

if (!apkPath || !saPath) {
  console.error("defina APK e SA_PATH");
  process.exit(1);
}

const SA = JSON.parse(readFileSync(saPath, "utf8"));
const apk = readFileSync(apkPath);
console.log(`apk:  ${apkPath} (${(apk.length / 1024 / 1024).toFixed(2)} MB)`);

const jwt = new JWT({
  email: SA.client_email,
  key: SA.private_key,
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});
const { access_token: token } = await jwt.authorize();
console.log("credencial: OK");

console.log("==> enviando o binario...");
const up = await fetch(
  `https://firebaseappdistribution.googleapis.com/upload/v1/projects/${PROJECT_NUMBER}/apps/${APP_ID}/releases:upload`,
  {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/octet-stream",
      "X-Goog-Upload-File-Name": "app-release.apk",
      "X-Goog-Upload-Protocol": "raw",
    },
    body: apk,
  },
);

const upBody = await up.json();
if (!up.ok) {
  console.log(`FALHOU no upload — HTTP ${up.status}`);
  console.log(JSON.stringify(upBody, null, 2).slice(0, 900));
  process.exit(1);
}
console.log(`upload aceito: ${upBody.name}`);

// O upload devolve uma long-running operation; o release so existe quando ela termina.
let release = null;
for (let i = 0; i < 40; i++) {
  const op = await fetch(`https://firebaseappdistribution.googleapis.com/v1/${upBody.name}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const opBody = await op.json();
  if (opBody.done) {
    if (opBody.error) {
      console.log("FALHOU no processamento:", JSON.stringify(opBody.error).slice(0, 500));
      process.exit(1);
    }
    release = opBody.response?.release;
    console.log(`resultado: ${opBody.response?.result ?? "OK"}`);
    break;
  }
  await new Promise((r) => setTimeout(r, 3000));
}

if (!release) {
  console.log("a operacao nao concluiu a tempo — confira no console do Firebase");
  process.exit(1);
}
console.log(`release: ${release.name}`);
console.log(`versao:  ${release.displayVersion} (${release.buildVersion})`);

const notas = process.env.NOTAS;
if (notas) {
  await fetch(`https://firebaseappdistribution.googleapis.com/v1/${release.name}`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ releaseNotes: { text: notas } }),
  });
  console.log("notas da versao gravadas");
}

const testers = (process.env.TESTERS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
if (testers.length) {
  const dist = await fetch(`https://firebaseappdistribution.googleapis.com/v1/${release.name}:distribute`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ testerEmails: testers }),
  });
  if (dist.ok) {
    console.log(`convidados: ${testers.join(", ")}`);
  } else {
    console.log(`falha ao convidar — HTTP ${dist.status}`);
    console.log(JSON.stringify(await dist.json(), null, 2).slice(0, 500));
  }
}

console.log(`\nlink de download: ${release.testingUri ?? "(ver console do Firebase)"}`);
