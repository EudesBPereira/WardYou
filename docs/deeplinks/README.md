# Deep links — o que hospedar em `app.wityu.com` (ou `app.wardyou.com`)

Hoje (2026-08-29) **nenhum** dos hosts resolve DNS: `app.wityu.com`, `app.wardyou.com`, `wardyou.com`.
Consequencia: o link de convite que a API gera (`INVITE_BASE_URL` em `familyService.ts`,
`https://app.wityu.com/join?familyInvite=CODE`) nao abre em lugar nenhum — o convite so funciona
digitando o codigo. Universal Links (iOS) e App Links (Android) tambem ficam sem verificacao.

## Passos (acao do fundador)

1. **DNS**: criar `app.<dominio>` apontando pra qualquer hospedagem estatica com HTTPS valido
   (Azure Static Web App, Cloudflare Pages, Blob + CDN — tanto faz, so precisa servir 2 arquivos).
2. **Servir os dois arquivos desta pasta** exatamente nestes caminhos:
   - `https://app.<dominio>/.well-known/assetlinks.json` — `Content-Type: application/json`
   - `https://app.<dominio>/.well-known/apple-app-site-association` — **sem extensao**,
     `Content-Type: application/json`, sem redirect.
3. **Fallback web**: qualquer outra rota (ex. `/join?familyInvite=CODE`) deve mostrar uma pagina
   simples "Abra no app WardYou" com link pra loja — e o que o usuario ve se o app nao estiver instalado.
4. Validar:
   - Android: `adb shell pm verify-app-links --re-verify com.wityu.app` e depois
     `adb shell pm get-app-links com.wityu.app` → esperado `verified`.
   - iOS: https://app-site-association.cdn-apple.com/a/v1/app.<dominio>

## Atencao — fingerprint do certificado

O `assetlinks.json` esta com o SHA-256 do **debug keystore** (`apps/mobile/android/app/debug.keystore`),
que e o que assina o `wityu-latest.apk` hoje. E o keystore de debug padrao do Android — **publico e
identico em toda maquina** — entao qualquer app assinado com ele passaria na verificacao. Antes de
publicar na Play Store:

1. gerar um keystore de release proprio (ou usar Play App Signing e pegar o SHA-256 no console);
2. trocar o fingerprint aqui (`keytool -list -v -keystore <release.keystore> | grep SHA256`);
3. manter os **dois** fingerprints na lista enquanto houver APKs de debug em uso.

`apple-app-site-association`: substituir `TEAMID` pelo Team ID da conta Apple Developer (10 caracteres).

## Se o dominio for `app.wardyou.com`

`app.wityu.com` esta na tabela de identificadores congelados do `CLAUDE.md`. Migrar exige trocar,
no mesmo commit: `INVITE_BASE_URL` (`familyService.ts`), `associatedDomains` + `intentFilters[].data.host`
(`app.config.ts`), `CORS_ORIGIN` na Azure, `DEPLOY.md` — e rebuild do APK (o host fica no manifest).
Como nada foi distribuido com o dominio antigo funcionando, nao ha links legados a preservar.
