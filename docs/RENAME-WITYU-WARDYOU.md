# Wityu → WardYou: auditoria de resíduos e plano de migração

Auditoria feita em **2026-09-08** sobre `main` @ `5b8a40b`. Complementa a tabela de identificadores
congelados do [CLAUDE.md](../CLAUDE.md) — esta é a versão completa e verificada por `grep`.

**Regra que rege tudo aqui:** o rename de 2026-08-23 foi deliberadamente **cosmético**. Nada que seja
_identificador_ (package, scheme, canal, chave de storage, nome de recurso Azure, claim de JWT) foi
trocado, porque cada um deles tem estado persistido fora do repo — no aparelho do usuário, no console
do Google, no banco ou no Azure. Este documento separa "esqueceram de renomear" de "está congelado de
propósito" e diz, para cada congelado, **o que custaria** destravar.

---

## 1. Veredito da auditoria

`grep -ri wityu` (fora de `node_modules`/`.git`) devolve **~180 ocorrências em 51 arquivos**. Depois de
classificar, sobra **um único item de verdade** a fazer.

| Classe | Ocorrências | Ação |
|---|---|---|
| 🔴 **Visível ao usuário, ainda em Wityu** | 20 strings (4 locales × 5) | **Corrigir antes do lançamento** — §2 |
| 🔒 **Congelado de propósito** | ~95 | Não tocar — §3 |
| 🟡 **Cosmético interno** (comentários, `slug`, `group` do Gradle) | ~45 | Opcional, sem pressa — §4 |
| 📄 **Docs** (`SUMMARY.md`, `CLAUDE.md`, `DEPLOY.md`, `README`) | ~110 | Correto: documentam os congelados — não mexer |
| ⚪ **Não se aplica a este repo** | — | §5 |

### Já está 100% em WardYou (verificado)

- `name: "WardYou"` no [app.config.ts](../apps/mobile/app.config.ts) → nome no launcher e na Play Store.
- Os 4 locales JS: **21 ocorrências de "WardYou" e zero de "Wityu"** em `pt/en/es/fr.json`.
- Templates de e-mail ([resetTemplates.ts](../apps/api/src/lib/resetTemplates.ts)).
- Ícones/splash: `assets/icon.png`, `android-icon-*`, referência a `Image/WardYou-icon.png`.
- Nomes de pacote npm (`@wardyou/mobile`, `@wardyou/api`).

---

## 2. 🔴 O que falta: as strings nativas do módulo `app-block`

**Único resíduo com impacto real.** O rename passou pelos locales JS mas **não** pelos
`strings.xml` do módulo nativo Android — que são exatamente os textos que o **sistema operacional**
mostra, nas telas de maior atrito do produto:

| String | Onde o usuário vê | Texto hoje |
|---|---|---|
| `app_block_service_label` | Ajustes → Acessibilidade (lista de serviços) | "Proteção Wityu" |
| `app_block_service_description` | Diálogo de consentimento do AccessibilityService | "…que o **Wityu** aplique os limites…" |
| `app_block_shield_title` | Notificação persistente do foreground service | "Proteção Wityu ativa" |
| `app_block_admin_description` | Tela de ativação do Device Admin | "Impede que o **Wityu** seja desinstalado…" |
| `app_block_admin_disable_warning` | Diálogo de desativação do Device Admin | "…a proteção do **Wityu** poderá ser removida…" |

Arquivos: [values/](../apps/mobile/modules/app-block/android/src/main/res/values/strings.xml),
[values-en/](../apps/mobile/modules/app-block/android/src/main/res/values-en/strings.xml),
[values-es/](../apps/mobile/modules/app-block/android/src/main/res/values-es/strings.xml),
[values-fr/](../apps/mobile/modules/app-block/android/src/main/res/values-fr/strings.xml).

**Por que é P0 e não cosmético:** o diálogo do AccessibilityService e o do Device Admin são os dois
momentos em que a família mais desconfia do app. Um app chamado "WardYou" na loja pedindo permissão de
acessibilidade em nome de "Wityu" parece sequestro de permissão — derruba conversão no onboarding e é
justamente o tipo de inconsistência que a revisão da Play Store sinaliza em política de transparência
de permissões.

**Risco de mudar: nenhum.** São `<string>` de exibição. Os **nomes** dos recursos
(`app_block_service_label`) e os IDs de canal ficam iguais; só o conteúdo muda. Não há estado
persistido amarrado ao texto.

**Execução:** trocar "Wityu" → "WardYou" nos 5 valores × 4 locales (20 substituições), preservando o
gênero/artigo de cada idioma (`o WardYou`, `de WardYou`, `Protección WardYou`, `Protection WardYou`).
Depois: `npx expo prebuild --platform android` + APK e conferir a tela de acessibilidade no aparelho.

---

## 3. 🔒 Congelados — inventário completo

A tabela do CLAUDE.md cobria a maioria. A auditoria achou **5 congelados que não estavam
documentados** (marcados ⚠️ **NOVO**) — todos no módulo nativo, todos com estado persistido no SO.

### 3.1 Identidade do app (quebra a Play Store)

| Identificador | Onde | Custo de trocar |
|---|---|---|
| `com.wityu.app` | `app.config.ts` (package/bundleId), `enforcementLogic.ts:9`, `tripLocationTracking.native.ts:184` | App **novo** na loja: base instalada não recebe update, assinatura muda, vínculo Firebase quebra |
| `google-services.json` (`wityu-499413`) | `apps/mobile/` | Gerado pelo Firebase, amarrado ao package. Editar à mão quebra o FCM |
| `slug: "wityu"` | `app.config.ts:12` | Só importa se/quando adotarem EAS — ver §4 |

### 3.2 Enforcement (desliga a proteção do modo criança)

| Identificador | Onde | Custo de trocar |
|---|---|---|
| `PROTECTED_APP = "wityu"` | [parentalService.ts:27](../apps/api/src/services/parentalService.ts#L27) | Casa com `com.wityu.app` via `.includes()`. Trocar sem trocar o package **desliga a autoproteção** — a criança bloqueia o próprio WardYou |
| `__wityu.` / `__wityu.pause` | [parentalService.ts:35-36](../apps/api/src/services/parentalService.ts#L35) | Sentinelas **gravadas na tabela `app_rules` em produção**. Trocar orfana as regras existentes |
| ⚠️ **NOVO** `wityu_app_block_prefs` | [AppBlockPrefs.kt:7](../apps/mobile/modules/app-block/android/src/main/java/expo/modules/appblock/AppBlockPrefs.kt#L7) | Nome do arquivo de `SharedPreferences` **no aparelho**. Trocar = todo dispositivo já instalado perde a política em cache e fica **sem enforcement até o próximo sync** |
| ⚠️ **NOVO** `com.wityu.app.APPBLOCK_WATCHDOG` | [AppBlockWatchdog.kt:23](../apps/mobile/modules/app-block/android/src/main/java/expo/modules/appblock/AppBlockWatchdog.kt#L23) + `AndroidManifest.xml:83` | Action de broadcast de `PendingIntent` **agendado no AlarmManager**. Alarmes já agendados nos aparelhos continuam disparando a action antiga → watchdog morre silenciosamente |

### 3.3 Canais de notificação Android (imutáveis por design do SO)

Um `NotificationChannel` **não pode ser renomeado nem reconfigurado** depois de criado; criar um novo
ID reseta as preferências do usuário e o canal antigo fica órfão nos Ajustes.

| Canal | Onde |
|---|---|
| `wityu_sos` / `wityu_sos_v2` | [pushService.ts:35,44](../apps/mobile/src/services/push/pushService.ts#L35), [fcm.ts:84](../apps/api/src/lib/fcm.ts#L84) |
| ⚠️ **NOVO** `wityu_protection` | [AppBlockShieldService.kt:23](../apps/mobile/modules/app-block/android/src/main/java/expo/modules/appblock/AppBlockShieldService.kt#L23) |
| ⚠️ **NOVO** `wityu_blocked_fullscreen` | [AppBlockOverlay.kt:119](../apps/mobile/modules/app-block/android/src/main/java/expo/modules/appblock/AppBlockOverlay.kt#L119) |

> O ID do canal **nunca é visível** ao usuário — o que aparece nos Ajustes é
> `app_block_shield_channel` ("Proteção ativa"), que já é neutro. Zero motivo para tocar.

### 3.4 Tasks do expo-task-manager (registradas no SO, persistem entre reboots)

`wityu-trip-location-broadcast` ([tripLocationTracking.native.ts:18](../apps/mobile/src/services/location/tripLocationTracking.native.ts#L18)),
`wityu-push-background` ([pushBackgroundTask.native.ts:13](../apps/mobile/src/services/push/pushBackgroundTask.native.ts#L13)).
Trocar orfana a task já registrada → **rastreamento de viagem para de funcionar** em quem já tem o app.

### 3.5 Chaves de storage (`wityu_*`) — perda de sessão/config

Todas exigem código de migração (ler chave antiga → escrever nova → apagar antiga):

`wityu_session` ([session.ts:5](../apps/mobile/src/stores/session.ts#L5), duplicada em
[tripLocationTracking.native.ts:21](../apps/mobile/src/services/location/tripLocationTracking.native.ts#L21)) ·
`wityu_pending_invite` · `wityu_push_device_${userId}` · `wityu_active_trip_ids` ·
`wityu_battery_opt_asked` · `wityu_shield_setup_done` · `wityu_antifurto` · `wityu_app_lock_enabled` ·
`wityu_onboarding_ack`

> `wityu_session` fica no **SecureStore** — perdê-la é **logout forçado de toda a base**.

### 3.6 Auth e deep links (quebra login e convites)

| Identificador | Onde | Custo |
|---|---|---|
| `JWT_ISSUER=Wityu` / `JWT_AUDIENCE=Wityu.App` | [env.ts:6-7](../apps/api/src/env.ts#L6) | Invalida **todo access/refresh token emitido** → logout global, e quebra compat com tokens do legado .NET |
| `wityu://` | `app.config.ts:13`, [auth.ts:14](../apps/api/src/routes/auth.ts#L14), [api/auth.ts:59](../apps/mobile/src/services/api/auth.ts#L59), `trips.ts:547`, `AppBlockOverlay.kt:130` | Registrado nos consoles OAuth (Google/Apple). Trocar sem atualizar lá **quebra o login externo** |
| `https://app.wityu.com` | [familyService.ts:24](../apps/api/src/services/familyService.ts#L24) (`INVITE_BASE_URL`), `app.config.ts` (App Links + `associatedDomains`), `docs/deeplinks/` | Exige hospedar `assetlinks.json`+AASA no domínio novo **e manter o antigo para sempre** pelos convites já distribuídos |

### 3.7 Azure (exige recriar infra)

`wityu-api-96164` (Web App), `wityuacr96164` (ACR), `wityu-kv-mvpsf` (Key Vault),
`mvp-sf-pg-96164` (Postgres). O Azure **não renomeia in-place**: exige recriar recurso, novo DNS,
novo `EXPO_PUBLIC_API_BASE_URL` — e todo app instalado apontando para o host antigo **para de
funcionar** até atualizar. Referências: `scripts/deploy-prod.ps1:14-20`, `DEPLOY.md`.

---

## 4. 🟡 Zona cinzenta: mudar só de carona

| Item | Onde | Recomendação |
|---|---|---|
| `slug: "wityu"` | `app.config.ts:12` | **Deixar.** Invisível ao usuário. Só passa a importar se adotarem EAS Build/Update (aí o slug amarra o projeto EAS) — trocar depois é pior. Hoje o build é APK local. |
| `group = 'com.wityu.appblock'` | [build.gradle:6](../apps/mobile/modules/app-block/android/build.gradle#L6) | **Deixar.** Coordenada Maven interna, nunca publicada. Trocar é seguro mas rende zero. |
| 10 comentários "Wityu" em `.kt` (+ alguns em `.ts` que só citam o scheme) | módulo `app-block`, `env.ts`, `routes/auth.ts` | Trocar **junto do §2**, no mesmo commit. São comentários de código: risco zero, e evita que a próxima pessoa ache que o rename ficou pela metade. |
| `// Same wire shape as Wityu.Contracts.Auth.AuthResponse` | [auth.ts:73](../apps/api/src/routes/auth.ts#L73) | **Manter "Wityu"** e anotar "(legado .NET)". É referência histórica a um tipo que existia no app antigo — reescrever para `WardYou.Contracts` documenta algo que nunca existiu. |

---

## 5. ⚪ Itens da sua lista que não se aplicam a este repo

Vários itens da lista pressupõem o stack .NET. **Ele não está mais aqui:**
`git ls-remote` mostra só `refs/heads/main`, e não existe nenhum `.csproj`, `.sln` nem pasta
`Migrations/` no repo. A branch `master` (MAUI legado) mencionada no SUMMARY **não existe mais no
remoto** — o legado só sobrevive como documentação em `SCAN_MAUI.md`.

| Item da lista | Status |
|---|---|
| Renomear projetos `Wityu.*` → `WardYou.*` | **N/A** — não há projetos .NET |
| Renomear namespaces | **N/A** — TypeScript, sem namespaces; pacotes npm já são `@wardyou/*` |
| Compatibilidade com migrações EF Core | **N/A no código, crítico na operação** — este repo **nunca** roda `prisma migrate`; o schema é `db pull` da produção. A compat é preservada por construção |
| Nomes de filas | **N/A** — não há fila nenhuma (sem Service Bus/BullMQ/Rabbit). Push é FCM direto, realtime é Socket.IO in-process |
| Telemetria e logs | **N/A** — só `Fastify({ logger: true })`, sem App Insights/OTel e sem `serviceName` |
| Docker images e pipelines | **Já congelado, não pendente** — a tag `wityu-api:latest` no ACR `wityuacr96164` é §3.7. O CI (`ci.yml`) não cita a marca |
| Atualizar OpenAPI/Swagger | ⚠️ **Vira outro assunto** — não existe OpenAPI/Swagger no `apps/api`. Não é resíduo de marca, é **falta de documentação de API**. Backlog próprio |
| Textos visíveis, splash, ícones, i18n | ✅ **Feito**, exceto §2 |
| Preservar deep links antigos | ✅ Preservado por não ter mudado nada (§3.6) |
| Preservar convites já gerados | ✅ `INVITE_BASE_URL` intacto |
| Upgrade de quem já tem o app | ✅ Seguro hoje — §6 |

---

## 6. Validação de upgrade da base instalada

Com o estado atual, **o update de quem já tem o app é seguro**: nada que o SO ou o banco persistem
mudou. Depois do §2 o roteiro de validação é curto — e o ponto é justamente provar que **nada** além
de texto mudou.

1. Instalar o APK **atual** (pré-fix) num aparelho; logar; ativar modo criança (acessibilidade +
   Device Admin); iniciar uma viagem; deixar bloquear um app.
2. Instalar o APK **novo por cima** (mesmo package, sem desinstalar).
3. Conferir, sem refazer nenhum setup:
   - continua **logado** (`wityu_session` no SecureStore intacta);
   - Acessibilidade **continua ligada** e agora diz "Proteção WardYou";
   - Device Admin **continua ativo**;
   - o bloqueio de app ainda dispara (prefs `wityu_app_block_prefs` preservadas);
   - a notificação persistente reaparece **no mesmo canal** (`wityu_protection`) — sem canal duplicado
     nos Ajustes;
   - a viagem em andamento continua enviando posição (task `wityu-trip-location-broadcast` viva);
   - push de SOS chega (token FCM não foi invalidado);
   - abrir um convite `https://app.wityu.com/join/CODE` ainda entra no app.

Se **qualquer** um desses 8 falhar, algum congelado do §3 foi tocado — reverter antes de publicar.

---

## 7. Se um dia quiserem destravar um congelado

Nenhum deles vale um "find/replace". Cada um é **projeto próprio**, e todos seguem o mesmo padrão de
convivência (dual-support), nunca corte seco:

| Congelado | Estratégia de convivência |
|---|---|
| Chaves `wityu_*` | Migração na leitura: `get(novo) ?? migrate(get(antigo))`, grava no novo, apaga o antigo. Manter o fallback por ≥2 releases |
| `wityu://` scheme | Registrar **os dois** schemes no `app.config.ts` e **os dois** redirect URIs nos consoles OAuth. Emitir só o novo; aceitar o antigo indefinidamente |
| `app.wityu.com` | Hospedar `assetlinks.json`+AASA nos dois domínios; `INVITE_BASE_URL` passa a emitir o novo; o antigo **nunca** é desligado (convites já impressos/enviados) |
| `JWT_ISSUER/AUDIENCE` | Verificar aceitando **array** de issuers/audiences durante a janela de rotação (≥ validade do refresh token); emitir só o novo. Só depois remover o antigo |
| Canais de notificação | Não migra: criar canal novo custa reset das preferências do usuário. Só junto de uma mudança que já justifique |
| `com.wityu.app` | **Não migra.** Package novo = app novo. Só via app novo + campanha de migração manual |
| Recursos Azure | Criar em paralelo, apontar DNS/`API_BASE_URL` novo, manter o antigo como proxy até a base instalada atualizar |
| `PROTECTED_APP` / sentinelas `__wityu.` | Só junto de um backfill em `app_rules` na produção, com janela de leitura dupla (aceitar prefixo antigo **e** novo) |

---

## 8. Checklist pós-migração (guard contra reincidência)

Depois de aplicar o §2, o repo deve ter **zero** ocorrências de `wityu` fora da allowlist de
congelados. Comando de verificação:

Usa `git grep` (só arquivos versionados) — assim `node_modules/`, o `apps/mobile/android/` gerado pelo
prebuild e os diretórios de build ficam de fora sem precisar de `--exclude-dir`, que por acidente
esconderia justamente o `modules/app-block/android/` do §2.

```bash
# Deve devolver VAZIO depois do §2 + limpeza de comentários do §4.
# Qualquer linha = resíduo novo, ou congelado ainda não documentado neste doc.
git grep -in "wityu" -- . \
  ':!SUMMARY.md' ':!CLAUDE.md' ':!README.md' ':!apps/api/DEPLOY.md' ':!docs/' ':!.claude/' \
| grep -viE "com\.wityu\.app|wityu://|app\.wityu\.com|wityu_|__wityu\.|wityu-trip-location|wityu-push-background|wityu-api|wityuacr96164|wityu-kv-mvpsf|wityu-499413|JWT_ISSUER|JWT_AUDIENCE|slug: \"wityu\"|scheme: \"wityu\"|com\.wityu\.appblock|PROTECTED_APP|Wityu\.Contracts"
```

Rodado em **2026-09-08** (pré-fix), devolve **30 linhas**: as 20 strings do §2 e os 10 comentários Kotlin do
§4 — e nada mais. Ou seja, a allowlist acima está fechada e o §2 é de fato o único resíduo funcional.

Checklist de release:

- [ ] Comando acima devolve vazio
- [ ] `grep -ci wityu apps/mobile/src/locales/*.json` → `0` nos 4 arquivos
- [ ] `grep -ci wityu apps/mobile/modules/app-block/android/src/main/res/values*/strings.xml` → `0` nos 4
- [ ] `grep -c WardYou` nos 4 locales → mesmo número nos 4 (paridade de tradução)
- [ ] Nenhum diff em `app.config.ts` nas linhas de `package`, `bundleIdentifier`, `scheme`, `associatedDomains`, `intentFilters`
- [ ] Nenhum diff em `google-services.json`
- [ ] `git diff` não toca nenhuma linha com `wityu_` (chave de storage/canal/prefs)
- [ ] Os 8 pontos de validação de upgrade do §6 passam em aparelho real
- [ ] Screenshot da tela Ajustes → Acessibilidade mostrando "Proteção WardYou"
- [ ] Screenshot do diálogo de Device Admin sem "Wityu"

> **Opcional:** virar o comando do §8 em `scripts/check-brand.sh` e plugar no `ci.yml` depois do
> typecheck — assim um "Wityu" novo falha o PR em vez de chegar na loja.
