# WardYou React Native — Status & Roadmap

> Status vivo do projeto. **Atualizar sempre que algo for concluído.** Histórico detalhado fica no git;
> aqui só o que importa pra retomar: **o que está aberto** + runbooks. Última rodada: 2026-07-10 (time de
> 8 agentes especialistas criado — ver `docs/ARQUITETURA-AGENTES.md` — trabalhou em paralelo: fix do push
> de nova tarefa, fix do Settings-essentials nativo, correções de frontend, LGPD reforçado, pesquisa de
> mercado, cor de marca corrigida pro azul real, **bateria de QA real rodada no emulador Android** via adb
> (login/settings/family/SOS hold/child/trip em background — ver seções "QA no emulador" abaixo) —
> **nenhum código foi alterado a partir dos achados de SOS/Accessibility/trip** (são pendências de
> validação em device real, não fixes aplicados ainda). **5ª rodada (2026-07-10): 4 bugs visuais de
> device corrigidos e verificados no emulador** (splash, SOS, modais, botões trajeto — ver "Correções de
> UI" abaixo + checklist Play Store no doc de agentes §8). Último APK: `wityu-20260829-rebrand-api11.apk`
> (= `wityu-latest.apk`, 2026-08-29). Emulador Android (`wityu_test`, AVD x86_64) disponível localmente pra QA — AVD
> é x86_64, então testes locais usam um build `-PreactNativeArchitectures=x86_64` à parte do arm64 de produção.
> **Todo o código acionável foi entregue** — o que resta é validação em aparelho (usuário) + ações externas
> (Google OAuth público, LGPD, pagamentos, Play Store) — ver seções abaixo.

## 🚦 ESTADO PARA RETOMAR (fim de 2026-09-11 / madrugada de 12-09) — LEIA ISTO PRIMEIRO

34 commits num dia. Esta seção é o ponto de partida de qualquer conversa nova.

### ✅ Validado EM APARELHO (funciona, medido, não inferido)

| Área | Evidência |
|---|---|
| **Rastreamento de viagem com o app FECHADO** | `entrou` → `carimbo ok` → `POST ok` nos dois aparelhos, com o app fora da tela e até com outro app por cima |
| Sobrevive ao processo ser morto | `am kill` não derruba (FGS protege), tarefa segue reportando |
| Aviso de GPS desligado | aviso em ~20s + selo "Sem sinal" + "Visto às" congela; recuperação ao religar; confirmado no banco |
| Push ponta a ponta | FCM HTTP 200 e `FirebaseMessaging` processando no aparelho |
| **Painel de app bloqueado** | superfície real `1080x2307` (antes `[0,0][0,0]`), tipo `APPLICATION_OVERLAY` |
| Crédito duplicado de tarefa | extra foi 75→105min na aprovação e **ficou** em 105 no reenvio |
| Tarefa paga mostra "Já concluída" | sem caminho clicável em nenhum dos dois cards |
| App-lock | 0 de 12 tentativas de bypass; ciclo cancelar→tocar→reabrir 5/5 em ~0,3s |
| Reversão de papel preserva tudo | Controle Parental, 480min e "TesteQA" voltam — verificado NA TELA |
| Apelido, mapa recentralizar, teclado, datas pt-BR, layout | todos confirmados |

### 🔧 Corrigido mas NÃO validado em aparelho
- **Sirene do antifurto, reescrita 100% nativa** (completa, compila, falta testar no aparelho):
  - As duas leituras foram CONFIRMADAS: (a) `setAudioModeAsync` não aguardado contra
    `play()` imediato, com o lock correndo em paralelo; (b) `player.volume` é ganho do
    tocador, não do `STREAM_ALARM` do sistema.
  - O motivo decisivo de ir para o nativo não foi só "já roda em foreground service":
    **é a única forma de tornar o `play()` síncrono** (`MediaPlayer.prepare()` bloqueante,
    contra o `prepareAsync()`/promise do JS). Quando `startSiren()` retorna, ou a sirene
    está tocando de verdade, ou já falhou de forma definitiva — a corrida morre aí.
  - `AudioAttributes.USAGE_ALARM` + `STREAM_ALARM` no máximo, **reafirmado a cada 300ms**
    por um handler nativo (sobrevive à pausa dos timers do JS).
  - Foreground service dedicado, separado do shield — o antifurto precisa funcionar em
    aparelho sem política de bloqueio ativa (idoso/SOS). Notificação **sem** `MediaStyle`,
    **sem** `MediaSession` e **sem** botão de ação: nada que dê ao ladrão um "pausar".
  - **Limite honesto, documentado:** o Android **não permite desabilitar as teclas físicas
    de volume**, e não há confirmação de que `onKeyEvent` as intercepte com a tela
    bloqueada. A defesa é **reafirmação, não bloqueio** — o ladrão abaixa por uma fração
    de segundo e o volume volta ao máximo em até ~300ms. Prometer "impossível abaixar"
    seria falso.
  - iOS mantém o caminho antigo (`expo-audio`), fora do escopo.
- `capturedAt` real na tarefa nativa de viagem
- Cutucada de retomada no `POST /location`
- Painel de proteção re-medindo a cada 15s (era leitura congelada)
- Bloqueio de SITES — **implementado 11/09, ZERO validação em aparelho**

### ❌ Em aberto / quebrado
1. **Sirene do antifurto — código pronto, FALTA VALIDAR NO APARELHO.** Roteiro para o fundador:
   (1) ative o antifurto; (2) confirme que a sirene toca **imediatamente**, repetindo a
   ativação 4-5 vezes — era o cenário intermitente; (3) com a sirene tocando e a tela
   desbloqueada, segure o **volume para baixo** e confirme que ele volta sozinho ao máximo
   em menos de 1s; (4) repita com a tela **bloqueada**; (5) tente deslizar a notificação da
   sirene para fora — não deve sumir; (6) feche o app pelos Recentes — a sirene deve
   continuar; (7) para sair, desbloqueie com biometria/PIN do aparelho.
2. **Bloqueio de sites — SEM VEREDITO. O teste está inválido enquanto o Chrome
   estiver bloqueado como APP.** Desambiguado em 12/09 00:50 no Redmi, com três casos:
   | URL | Resultado |
   |---|---|
   | `g1.com.br` (na lista) | bloqueado |
   | `naog1.com.br` (não está) | bloqueado |
   | `example.com` (controle, sem relação) | **bloqueado** |
   O terceiro caso resolve: **é o Chrome que está bloqueado como aplicativo**, não a regra
   de domínio. Tudo que abre no Chrome é barrado antes de a regra de site ser consultada.
   A lógica em `websiteBlocking.ts` / `AppBlockWebsiteRules.kt` compara sufixo em fronteira
   de ponto (`h === d || h.endsWith("." + d)`) e não casaria `naog1.com.br` — mas isso
   continua **sem prova em aparelho**.
   → **Passo 1 de amanhã:** Controle parental → Apps → **liberar o Chrome permanentemente**.
   Só então repetir: `g1.com.br` e `www.` e subdomínio devem bloquear; `naog1.com.br` e
   `example.com` **não** podem. Depois: navegador nativo Xiaomi (id da barra de endereço
   não confirmado) e aba anônima (ninguém respondeu ainda). Para testar, o Chrome precisa estar LIBERADO como app — senão tudo bloqueia e o teste não significa nada. Casos: `g1.com.br`, `www.`, subdomínio, **`naog1.com.br` que NÃO pode bloquear**, navegador nativo Xiaomi, aba anônima, link dentro do Instagram (esperado não bloquear).
3. **Rastreamento FORA de viagem não existe**. O mapa da família mostra a posição de quando a criança abriu o app pela última vez. Recomendação: reusar o `AppBlockShieldService` (já roda 24h) para reportar a cada 10-15min com precisão `Balanced`.

### 🧪 NUNCA TESTADO — prioridade para a próxima sessão
**MODO IDOSO, inteiro.** Nenhuma tela, nenhum fluxo. Existe `ElderHome`, `app/elder/`, `elderService.ts`, medicação, check-in. **Zero validação.** O fundador pediu explicitamente que isto entre na próxima rodada.

### 💭 Decisões de produto pendentes (do fundador, não técnicas)
- **Premium**: o card em Ajustes abre "Em breve" — não há pagamento no app. Esconder, virar lista de espera, ou integrar cobrança?
- **Consentimento de viagem**: entrar numa viagem compartilha localização, bateria e SOS **sem nenhuma tela de aceite**.
- **Consentimento familiar concedido em nome de outro membro não tem como ser revogado** — nem no app, nem na API.
- **SOS não expira** — fica ativo para sempre até alguém cancelar.
- **A criança pode desligar sozinha o compartilhamento da própria localização.**
- **O responsável não vê o saldo de tempo extra** (só o limite base).
- Rastreamento permanente fora de viagem (privacidade vs. promessa do produto).
- Limiar do antifurto (2.2G) segue sem calibração.
- Gatilho de recuperação independente de alguém olhar o mapa (exige contêiner acordado ou agendador; hoje `min-replicas 0`).

### ⚠️ ARMADILHAS OPERACIONAIS — custaram horas, não repita

**1. `uiautomator dump` DERRUBA a acessibilidade.** Uma sessão de `UiAutomation` suspende TODOS os serviços de acessibilidade do sistema e às vezes fica pendurada (`IllegalStateException: UiAutomationService already registered`). Isso poluiu horas de diagnóstico e fez o fundador ir ao aparelho várias vezes para consertar o que NÓS quebrávamos.
→ **Use `dumpsys window` / `dumpsys activity` para foco e estado.** Só use `uiautomator dump` quando precisar do texto real, e avise que a acessibilidade vai cair.
→ Se travar: `adb kill-server && adb start-server` recupera aparelho que aparece como "(no serial number)".

**2. Instalar o APK REVOGA `SYSTEM_ALERT_WINDOW`.** Reconceder após cada instalação:
`adb -s <serial> shell appops set com.wardyou.app SYSTEM_ALERT_WINDOW allow`
(A isenção de bateria, ao contrário, sobrevive.)

**3. Agentes em paralelo NUNCA rodam git destrutivo.** Ver CLAUDE.md — um `git stash` apagou ~20 arquivos de trabalho não commitado.

**4. `Test-Path` não prova que o build rodou.** O `ship.ps1` já exige `LastWriteTimeUtc` mais novo; **confira o artefato, não a mensagem de sucesso** (um APK velho foi publicado e instalado anunciado como novo).

**5. Escrever em `settings secure` é bloqueado pelo classificador.** Religar acessibilidade é sempre ação do fundador.

### 🔁 O padrão que se repetiu o dia inteiro
**O servidor estava certo e a TELA mentia** — ou pior, o app **fabricava** o dado. Casos: posição congelada republicada com carimbo novo (o app inventava frescor); painel acusando acessibilidade caída com ela funcionando; site "bloqueado" que nunca foi implementado; contador prometendo tempo já pago; painel de bloqueio interceptando toque sem desenhar nada.
**Corolário de método:** um card que mede uma vez e lembra o resultado mente sem perceber — o estado muda FORA do app. Três correções de hoje foram exatamente isso.
**Segundo corolário:** três correções feitas hoje introduziram os defeitos seguintes. Correção em caminho de autenticação ou de background **exige teste em aparelho**, não basta typecheck.

## 🔴 RODADA DE VALIDAÇÃO TOTAL (2026-09-11) — 25 commits, 34 defeitos

Bateria completa nos dois aparelhos reais (Redmi = criança, POCO = responsável), com arquiteto
supervisor e dois testadores presos a um aparelho cada. Testes feitos **pela tela** via
`uiautomator dump` (nunca screenshot — os aparelhos têm conteúdo pessoal do fundador).

### O padrão que se repetiu — vale mais que a lista de bugs

Em quase todo caso grave, **o servidor estava certo e a TELA mentia**: crédito duplicado de tarefa,
botão de desbloquear inerte, site "bloqueado" que não bloqueava, contador de tarefas prometendo tempo
já pago, painel acusando acessibilidade caída com ela funcionando. Num produto de segurança familiar
isso é caro: o responsável decide com base no que a tela diz.

Corolário: **três correções feitas HOJE introduziram os defeitos seguintes** (o app lock é o caso
claro — de "preso para sempre" para "preso por um minuto"). Correção em caminho de autenticação
precisa de teste em aparelho antes de ser considerada pronta, não só typecheck.

### Já provado em aparelho (14)
crédito duplicado fechado (tempo extra não subiu no reenvio) · tarefa paga mostra "Já concluída e
recompensada", sem caminho clicável · app lock: 5/5 ciclos reabrindo em ~0.3s (antes travava até 1min)
· prompt fantasma no aparelho da criança eliminado · enforcement resiste a kill (`F/S/FGS`, adj 100) ·
acessibilidade volta sozinha após reinstalação · apelido resolve nomes duplicados em todas as telas ·
botão de centralizar recupera o mapa arrastado · teclado não cobre mais o campo · datas em pt-BR ·
layout sem corte atrás da barra de navegação · nomes de app na tela "Uso" · botões de liberar app
legíveis · painel de proteção honesto.

### ⚠️ SEM NENHUMA VALIDAÇÃO — o coração do produto
**Bloqueio de app e de site.** Implementado hoje (o de sites **nunca existiu** antes — a tela salvava
no banco e nada no aparelho lia), mas a acessibilidade está desligada no Redmi e só o dono do aparelho
pode religar. **Não lançar sem testar isto.**

### Não implementado, apesar de visível
**Premium / pagamento** — o card em Ajustes abre "Este recurso estará disponível em breve". Único
ponto assim no app. Decisão de negócio: esconder, virar lista de espera, ou integrar cobrança.

### Decisões de produto em aberto (achadas nesta rodada)
SOS não expira (fica ativo para sempre) · consentimento concedido em nome de outro membro não tem como
ser revogado, nem no app nem na API · a criança pode desligar sozinha o compartilhamento da própria
localização · o responsável não enxerga o saldo de tempo extra · localização só é reportada com o app
aberto · limiar do antifurto (2.2G) segue sem calibração.

### Lições operacionais
- **Agentes em paralelo nunca rodam git destrutivo** — um `git stash` apagou ~20 arquivos de trabalho
  não commitado de todos os outros. Ver CLAUDE.md.
- **`Test-Path` não prova que o build rodou.** O `ship.ps1` publicou um APK ANTIGO após um build que
  falhou, e ele foi instalado e anunciado como novo. Agora exige `LastWriteTimeUtc` mais novo.
- **Conferir o artefato, não a mensagem de sucesso.** O que pegou o APK velho foi inspecionar o
  `canRetrieveWindowContent` dentro do próprio APK, não a linha "Entregue nos dois canais".
- Agentes raciocinam dentro do que enxergam: um deles concluiu que a biometria "se resolvia sozinha
  sem explicação possível" — não sabia que havia uma pessoa com o telefone na mão.

## 🟢 AMBIENTE DE QA NO AR (2026-09-09) — Azure NEOBPO, 59/59 e2e passando

**Produção não existe.** O ambiente `mvp-sf` (subscription pessoal, `wityu-api-96164`) é legado e está
fora do ar; a partir de agora o caminho é: QA → validar → **depois** criar produção. Isso invalidou a
tabela de identificadores congelados do CLAUDE.md (ver seção seguinte).

**Subscription:** `9bbce015-49c1-4a55-98b3-33a39cfebc23` — "Assinatura do Visual Studio Professional",
tenant NEOBPO (`neobpo.com.br`), usuário `eudes.pereira@neohype.co`. ⚠️ Benefício VS tem **teto de
crédito mensal** e a subscription **já hospeda o `cloudorin-qa` inteiro** — atenção ao custo somado.

### Recursos criados (RG `wardyou`)

| Recurso | Nome | Detalhe |
|---|---|---|
| PostgreSQL Flexible | `wardyou-qa-psql` | B1ms Burstable, PG **16.15**, 32 GB, westus3, ~US$ 13/mês |
| Database | `wardyou_qa` | **33 tabelas** criadas via `prisma db push` |
| Container App | `wardyou-qa-api` | 0.25 vCPU / 0.5 GiB, **min-replicas 0**, max 2 |
| Managed Identity | `wardyou-qa-id` | AcrPull em `cloudorinqaacr` |

**Reusado do `cloudorin-qa`** (compartilhável, sem dado): ACR `cloudorinqaacr` (repo `wardyou-api:qa`)
e Container Apps env `cloudorin-qa-cae`. O **banco é próprio** — dados de localização de menores não
dividem servidor com outro produto.

**URL da API de QA:** `https://wardyou-qa-api.orangesand-7bad7871.westus3.azurecontainerapps.io`
Segredos em `apps/api/.env.qa` (gitignored) + secrets do Container App. Deploy: `apps/api/scripts/deploy-qa.ps1`.

### Verificado por execução contra o QA real
- `/health` → `{"status":"ok","service":"wardyou-api"}`
- Register → grava no banco; Login → PBKDF2 round-trip OK; rota protegida sem token → 401
- **`e2e-kids.mjs` 44/44** e **`e2e-trips.mjs` 15/15** — módulo parental e trajetos ponta a ponta
- typecheck api+mobile limpos, **28/28** testes unitários

### 🔴 Achado de segurança novo (encontrado pelo QA)
**O JWT sai sem `iss` e sem `aud`, e a API aceita tokens sem esses claims.** `server.ts:42-43` registra
`sign: { iss, aud }` + `verify: { allowedIss, allowedAud }`, mas `buildAuthResponse` chama
`app.jwt.sign(payload, { expiresIn })` — as opções por chamada **substituem** as do plugin em vez de
somar, então o token sai só com `sub/email/name/iat/exp`. Payload real capturado do QA:
`{"sub":"…","email":"…","name":"…","iat":…,"exp":…}`. Ou seja, a validação de issuer/audience que o
código aparenta ter **não está em vigor**. Não corrigido ainda — decisão pendente.

### ⚠️ Postura de QA que NÃO pode ir para produção
- Regra de firewall **`AllowAzureServices-QA-ONLY` (0.0.0.0)** no `wardyou-qa-psql`: necessária porque um
  Container App de plano Consumption tem **160+ IPs de saída instáveis**. Produção precisa de VNet +
  private endpoint, não desta regra.
- `min-replicas 0` → cold start no primeiro request. Para uma sessão de testes:
  `az containerapp update -g wardyou -n wardyou-qa-api --min-replicas 1` (e voltar para 0 depois).

### ✅ Norton AntiVirus interceptava TLS — RESOLVIDO (2026-09-09)
**Correção:** atribuí isso à "rede corporativa NEOBPO" durante a sessão — estava errado. O interceptador
é local: o **Norton AntiVirus** (`NortonSvc`) faz SSL/TLS scanning e reassina todo HTTPS com o CA
`CN=Norton Web/Mail Shield Root`. Verificado inspecionando o emissor do certificado de
`dl.google.com`, `repo.maven.apache.org` e `registry.npmjs.org` — os três vêm assinados pelo Norton.

Quebrou **cinco** ferramentas: npm, winget, az CLI, sdkmanager e Gradle. As quatro primeiras por não
confiarem no CA; o Gradle por algo pior — `(bad_record_mac) Tag mismatch!`, ou seja, o Norton
**corrompendo bytes em trânsito** em TLS 1.3 durante downloads grandes e paralelos.

**Resolvido desligando "Navegação segura" no Norton.** Verificado depois: `dl.google.com` volta a vir
do Google Trust Services e `repo.maven.apache.org` da Let's Encrypt; `az` e `sdkmanager` funcionam
**sem workaround nenhum**. Os flags seguem nos scripts (`deploy-qa.ps1`, build do APK) porque são
inofensivos e mantêm tudo funcionando caso a proteção seja religada por update ou política.

⚠️ Isso deixou o Norton com "1 proteção desativada" — decisão consciente do fundador. Se a navegação
segura for religada, os builds voltam a falhar e o CLAUDE.md tem o comando de verificação.

### ⬜ Pendente nesta frente
- **Projeto Firebase novo** para o package `com.wardyou.app` (decisão tomada) — ação no console, sua.
  Sem `google-services.json` novo, o build Android quebra e não há push.
- APK de QA com `EXPO_PUBLIC_API_BASE_URL` apontando para a URL acima (exige `expo prebuild`).
### ✅ Falha de rede deixou de se disfarçar de "não há nada" (2026-09-09)

**Correção de diagnóstico:** o SUMMARY e o relatório de 08/09 diziam "o spinner gira para sempre".
**Está errado.** Verificado no código: os dois usos de `isPending` (`blocked.tsx`, `ElderHome.tsx`) são
de **mutations**, não de queries. No TanStack Query v5, quando uma query falha, `isLoading` volta a
`false` e `data` fica `undefined` — então o default do destructuring (`= []`) assume e a tela renderiza
o **estado vazio**.

O bug real era pior que travar: uma falha de rede aparecia como *"Nenhuma zona cadastrada"* ou
*"Nenhum membro na família"*. Num app de segurança familiar, o responsável pode concluir que não há o
que ver — quando na verdade não houve resposta do servidor.

**Corrigido de forma central**, no `QueryCache` do root layout, cobrindo as 29 telas de uma vez em vez
de 29 edições: `stores/connection.ts` (sinal global), `components/ConnectionBanner.tsx` (faixa âmbar com
"tentar de novo" que refaz todas as queries) e o wiring em `app/_layout.tsx`. Também criei
`components/ui/ErrorState.tsx` para uso inline por tela, seguindo o formato do estado vazio existente.
i18n: `common.loadError` + `common.retry` nos 4 locales (paridade 611 × 4). Typecheck limpo, 21/21.

## 🏷️ Auditoria final do rename Wityu → WardYou (2026-09-08) — sobrou 1 item, e ele é P0

Varredura completa (`git grep -i wityu`): **~180 ocorrências em 51 arquivos**, classificadas em
[docs/RENAME-WITYU-WARDYOU.md](docs/RENAME-WITYU-WARDYOU.md). Resultado:

- 🔴 **Único resíduo funcional:** os `strings.xml` do módulo nativo `app-block` (4 locales × 5 strings)
  nunca foram renomeados. São os textos que **o Android** mostra em Ajustes → Acessibilidade, na
  notificação persistente do escudo e na tela de Device Admin — ou seja, um app "WardYou" pede
  acessibilidade em nome de "Wityu". **Corrigir antes do lançamento**; risco técnico zero (é só texto
  de exibição, os nomes dos recursos e IDs de canal não mudam).
- 🔒 **~95 ocorrências congeladas de propósito.** A auditoria achou **5 congelados não documentados**,
  agora na tabela do CLAUDE.md: `wityu_app_block_prefs` (SharedPreferences no aparelho),
  `com.wityu.app.APPBLOCK_WATCHDOG` (action de PendingIntent no AlarmManager), e os canais
  `wityu_protection` / `wityu_blocked_fullscreen`.
- ⚪ **Boa parte da lista de rename não se aplica:** não há mais nenhum `.csproj`/`.sln`/`Migrations/`
  no repo e a branch `master` (MAUI legado) **não existe mais no remoto** — logo "renomear projetos
  `Wityu.*`", "namespaces" e "compat com migrações EF Core" são N/A. Também não há fila (sem Service
  Bus/BullMQ), nem telemetria nomeada (só `Fastify({ logger: true })`).
- ⚠️ **Achado lateral:** não existe OpenAPI/Swagger no `apps/api`. Não é resíduo de marca — é falta de
  documentação de API. Backlog próprio.
- ✅ Já 100% WardYou: nome no launcher, os 4 locales JS (21 ocorrências cada, zero "Wityu"), templates
  de e-mail, ícones/splash, pacotes npm.
- 🧪 O doc traz o comando de guarda (`git grep` + allowlist) que deve devolver **vazio** pós-fix — dá
  pra plugar no `ci.yml` como `scripts/check-brand.sh`.

## 🔎 Auditoria de estado (2026-08-29) — o que esta funcionando de verdade

Verificado **por execucao**, nao por leitura: typecheck api+mobile OK, `node --test` **7/7 api + 21/21
mobile**, `tsc` build da API OK. Infra viva de novo: assinatura Azure **reativada**, Web App `Running`,
Postgres `mvp-sf-pg-96164` `Ready`, `/health` 200, login responde `InvalidCredentials` (= banco
alcancavel), Socket.IO faz handshake em `/realtime`, guard JWT devolve 401. App settings de prod tem
`FCM_SERVICE_ACCOUNT_JSON`, `ACS_CONNECTION_STRING`/`MAIL_FROM`, OAuth Google.

**Achados (em ordem de impacto):**
1. 🔴 **API de prod esta DEFASADA** — imagem `wityu-api:latest` do ACR e de **2026-07-26 15:01**, anterior a
   rodada 11. Sondagem das 120 rotas locais contra prod: **117 existem, 3 dao 404**:
   `GET /parental/children/:id/requests`, `POST .../requests/app-access`, `PUT /families/:f/members/:m/avatar`.
   O APK de 23/08 (`wityu-latest.apk`) **ja chama essas rotas** → card "Aguardando voce" e foto do
   membro **falham em campo** ate redeployar. Bateria/"ultimo lugar" (mesma rodada) tambem so funcionam
   com a API nova. ~~**Acao: deploy da API**~~ **FEITO 2026-08-29 ~11:50** — imagem nova no ACR
   (`lastUpdate 14:47Z`), `webapp restart`, container novo no ar em ~40s; re-sondagem: **120/120 rotas
   respondem, 0 × 404**; `/health` agora devolve `service: "wardyou-api"`; Socket.IO OK.
2. 🟡 **APK de 23/08 22:50 e anterior ao ultimo toque em `ChildHome.tsx`/`enforcementLogic.ts`**
   (24/08) — provavel so rename cosmetico, mas o header da home da crianca pode ainda mostrar "Wityu".
   ~~Rebuild so-JS (`assembleRelease`) resolve.~~ **FEITO 2026-08-29 12:07** — APK
   **`wityu-20260829-rebrand-api11.apk`** (= `wityu-latest.apk`, 55,97 MB, arm64, Blob `mvpsfapk80840/apk`,
   SAS 7 dias gerado). ⚠️ O 1º rebuild so-JS saiu com `application-label:'Wityu'` (launcher) porque
   `android/` e gerado e nao passou por `prebuild` desde o rename; corrigido `app_name` em `strings.xml`,
   recompilado incremental e reenviado — `aapt` confirma `'WardYou'`. ⬜ **Instalar no aparelho (voce)**.
3. 🟡 **Deep links mortos**: `app.wityu.com`, `app.wardyou.com` e `wardyou.com` **nao resolvem DNS**. Links
   de convite `https://app.wityu.com/join?...` gerados pela API (`INVITE_BASE_URL`) nao abrem em lugar
   nenhum — hoje o convite so funciona pelo codigo digitado. Precisa DNS + `assetlinks.json`/AASA.
   **Preparado (2026-08-29):** `docs/deeplinks/` tem os dois arquivos prontos (assetlinks com o SHA-256 do
   debug keystore atual; AASA com `TEAMID` placeholder) + README com DNS, validacao e o aviso de trocar o
   fingerprint pro keystore de release antes da Play Store. **Falta so hospedar (acao do fundador).**
4. 🟡 **`npm audit`: 15 high / 11 moderate** (o SUMMARY anterior dizia "so moderada de build"). Com fix
   sem major: `find-my-way` (router do Fastify, DDoS HTTP/2), `socket.io-parser` (memory exhaustion),
   `fast-uri`, `js-yaml`, `brace-expansion`, `nanoid`, `postcss`, `image-size`, `deepmerge-ts`/`prisma`.
   Os moderados de `@expo/config-plugins`/`uuid` continuam sem fix sem rebaixar o Expo.
   **Parcialmente feito 2026-08-29** (o `audit fix` rodou so na cadeia `@expo/cli`/`metro` antes de ser
   interrompido; fundador optou por **manter**): audit **26 → 18 (high 15 → 7)**, typecheck + testes +
   `npm ls` OK, APK compilado com esse lock. ⬜ Restam os high de runtime da API (`find-my-way`,
   `socket.io-parser`, `fast-uri`, `js-yaml`, `nanoid`, `brace-expansion`) — proxima rodada:
   `npm audit fix` de novo (sem `--force`) + retestar + redeploy.
6. 🟡 **444 artefatos de build versionados** em `apps/mobile/modules/app-block/android/build/` (entraram
   no commit inicial). **Corrigido 2026-08-29**: `.gitignore` + `git rm -r --cached` (disco intacto).
7. ⚪ Sem mudanca: Google OAuth em modo Testing, Facebook sem App ID (`EXPO_PUBLIC_FACEBOOK_APP_ID` vazio),
   Premium placeholder, PRIVACY/TERMS rascunho, `family_elder_settings` sem UI, Antifurto fase 2 nao
   iniciado, validacoes device-only da secao "Modo crianca" ainda abertas.

## 🏷️ Rebrand WardYou — pontas soltas fechadas (2026-08-29)

O rename cosmetico de 2026-08-23 tinha deixado 7 identificadores em `wityu` que **nao estao** na tabela
de congelados do `CLAUDE.md`. Todos trocados agora (typecheck api + mobile OK):

| Onde | Antes → Depois |
|---|---|
| `app/privacy.tsx` | `wityu-data-export-*.json` → `wardyou-data-export-*.json` — **nome de arquivo que o usuario baixa** |
| `routes/health.ts` | `service: "wityu-api"` → `"wardyou-api"` (payload do `/health`, nao o repo do ACR) |
| `mockData.ts`, `profile/queries.ts`, `api/auth.ts` | e-mails mock `@wityu.app` → `@wardyou.com` |
| `scripts/e2e-{kids,trips}.mjs` | prefixo de conta de teste `wityu-e2e-*` → `wardyou-e2e-*` |
| `AntifurtoAlarmOverlay.tsx` | `KEEP_AWAKE_TAG` → `wardyou-antifurto` |
| `apps/api/.env.example` | banco local `wityu_dev` → `wardyou_dev` |
| `apps/mobile/.env`, `apps/api/.env` | cabecalho do comentario |

**Decisao (2026-08-29):** `com.wityu.app` e `app.wityu.com` **continuam congelados** — trocar o package
criaria um app novo na Play Store e exigiria refazer Firebase/FCM, client OAuth (pacote + SHA-1) e chave
Maps Android. `README.md` mantem `wityu://` (scheme congelado) e o link para
`PROMPT_Migracao_Wityu_MAUI_para_ReactNative.md` (nome real do arquivo legado).

Adicionado a tabela de congelados do `CLAUDE.md`: os nomes de task do expo-task-manager
(`wityu-trip-location-broadcast`, `wityu-push-background`) — ficam registrados no SO do aparelho.

## 📁 Estado do Git (2026-08-24)
O repo `EudesBPereira/WardYou` (**privado**) hospeda **duas bases de codigo lado a lado**:

| Branch | Conteudo | Ultimo commit |
|---|---|---|
| **`main`** ← **trabalhe aqui** | Rebuild **React Native** (este monorepo) | 2026-08-24 |
| `master` | **MAUI legado** em .NET (`Wityu.sln`, `src/`, `infra/`) — referencia historica, nao mexer | 2026-06-14 |
| `bloco-*`, `feat/*` (10 branches) | Historico do desenvolvimento MAUI | — |

Ate 2026-08-24 o rebuild RN **nunca tinha sido versionado** — o diretorio local nao tinha `.git`.
Foi criado o branch orfao `main` (735 arquivos) sem tocar em `master`.

**Nao versionados** (ver `.gitignore`): `.env`, `google-services.json`, `node_modules/`,
`apps/api/dist/`, `.expo/`, `.idea/` e os projetos nativos gerados por prebuild
(`apps/mobile/android/`, `apps/mobile/ios/`).

⚠️ **`apps/mobile/android/` nao e versionado**, entao o pin do CMake 3.30.5 em
`android/app/build.gradle` (necessario no Windows por causa do MAX_PATH) **precisa ser reaplicado
manualmente depois de cada `expo prebuild`** — ver `CLAUDE.md` -> "Windows MAX_PATH gotcha".

⬜ **Pendente (so voce pode fazer, precisa das Settings do GitHub):**
- Tornar **`main` o branch padrao**: Settings -> General -> Default branch -> `main`.
  Enquanto nao fizer, quem clonar o repo cai no MAUI legado (`master`).
- Opcional: `master` carrega **390 arquivos de lixo** (`publish/api-logs/`, `wityu-api-deploy.zip`,
  `stage9_*.log`) commitados por engano — vale limpar num commit futuro se for reutilizar aquele branch.

## ✅ REBRANDING: Wityu -> WardYou (2026-08-23)
Dominio **`wardyou.com`** (ja comprado). `withyou.com`/`wityu.com` estavam ocupados por terceiros.
Tambem livres e reservaveis: `wardyou.app`, `wardyou.io`, `wardyou.co`.

**Aplicado** (typecheck mobile+api limpos, 28/28 testes passando):
- Nome de exibicao do app (`app.config.ts`) + textos de permissao iOS/Android
- Strings dos **4 locales** (pt/en/es/fr) — inclui o wordmark "WardYou Premium"
- Templates de e-mail de reset de senha (`resetTemplates.ts`)
- Docs: `CLAUDE.md`, `README.md`, `SUMMARY.md`, `docs/*`, `.claude/agents/*`
- Pacotes npm: `wardyou` (root), `@wardyou/mobile`, `@wardyou/api` (+ `npm install` reconciliado)
- Identificadores internos: `wardYouLogoXml`/`wardYouBrandXml`, `WARDYOU_PACKAGE`
- Arquivos de marca: `Image/WardYou-icon.png`, `Image/wardyou-logo.png`

**NAO aplicado de proposito** — ver tabela completa em `CLAUDE.md` -> "Marca WardYou vs. identificadores
tecnicos congelados". Resumo do que continua `wityu` e por que trocar e destrutivo:
`com.wityu.app` (package Android/iOS -> app novo na Play Store), `google-services.json` (Firebase),
`PROTECTED_APP="wityu"` (autoprotecao do modo crianca), sentinelas `__wityu.*` (gravados em `app_rules`),
`JWT_ISSUER/AUDIENCE` (invalida tokens + compat .NET), scheme `wityu://` (consoles OAuth),
storage keys `wityu_*` (perda de sessao dos instalados), canais `wityu_sos*` (imutaveis no Android),
recursos Azure (`wityu-api-96164`, `wityuacr96164`, `wityu-kv-mvpsf`) e `app.wityu.com` (deep links).

⬜ **Pendente (acao externa, fora do meu alcance):**
1. ~~Renomear o repo GitHub~~ **FEITO (2026-08-24)**: `https://github.com/EudesBPereira/WardYou.git`.
   ~~Versionar o projeto RN~~ **FEITO**: ver "Estado do Git" logo abaixo.
2. Reservar `wardyou.app` / `wardyou.io` / `wardyou.co` na Cloudflare (opcional, protecao de marca).
3. Novo logo/wordmark com o nome WardYou (os SVGs atuais ainda desenham a marca antiga).
4. Checar marca "WardYou" no INPI + disponibilidade do nome na Play Store/App Store.
5. **Atualizar o Firebase / Google Cloud** (projeto `wityu-499413`) — ainda esta com a marca antiga:
   - display name do projeto Firebase (o *project ID* `wityu-499413` e o bucket
     `wityu-499413.firebasestorage.app` sao **imutaveis** — so o nome de exibicao muda);
   - **app name da tela de consentimento OAuth** (Cloud Console > APIs & Services > OAuth consent screen):
     este e **visivel ao usuario** — no login com Google aparece "<app name> quer acessar sua conta";
   - nickname do app Android no Firebase (cosmetico).
   Como `com.wityu.app` segue congelado, **nao** e preciso registrar app novo nem gerar um
   `google-services.json` novo.

## 🔴 INFRA FORA DO AR: assinatura Azure desabilitada (2026-07-26) + e2e kids 44/44 em ambiente local
**Sintoma**: app do fundador "só fica carregando". **Causa**: NÃO é código — a assinatura Azure
(`d038c7dc-…`) foi **desabilitada** (`ReadOnlyDisabledSubscription`). Consequências verificadas:
API responde **403 em tudo** (inclusive `/health`), Postgres `mvp-sf-pg-96164:5432` **inalcançável**
(`TcpTestSucceeded: False`), e **qualquer deploy/restart é recusado** (assinatura read-only).
👉 **Ação do fundador (única saída)**: portal Azure → Subscriptions → reativar (crédito/limite de gastos/
pagamento). Reconfirmado 2×: `webapp restart` é recusado com o mesmo erro — não há contorno por código.
👉 **Deploy já preparado**: `powershell -File apps/api/scripts/deploy-prod.ps1` (da raiz) faz tudo assim que
a assinatura voltar — ACR build → restart → espera `/health` 200 → **smoke test que distingue rota nova
no ar (401) de imagem velha (404)**. Um monitor local está armado observando o fim do 403.
Enquanto isso, o bloqueio no aparelho da criança **continua valendo** (enforcement roda local com o
último estado em cache, default-deny + regras de horário nativas); o que cai é tudo que depende de rede.

**Como os testes do modo kids foram garantidos mesmo com a infra fora** (contorno montado nesta rodada):
Postgres 16 descartável em Docker (`wityu-e2e-pg`, porta 55432) + `prisma db push` do schema
introspectado (só no banco local — produção nunca tocada) + API local em `dist/` → `E2E_BASE=127.0.0.1:3000
node scripts/e2e-kids.mjs`. Ambiente derrubado ao final. **Resultado: 44/44 PASS.**
- **2 falhas iniciais eram expectativas velhas do script, não regressões** (corrigidas):
  (a) `profile before approval` esperava `member`, mas o correto hoje é **`pending`** (a tela de espera
  foi criada justamente pra isso); (b) `my-status without policy` esperava `hasPolicy=false`, mas hoje a
  política **nasce ao primeiro read** de uma criança aprovada (enabled), pra o device já enforçar.
- **+9 testes novos** cobrindo o que as rodadas 11-12 entregaram e não tinham e2e: pedido de liberação
  pelo painel de bloqueio → aparece na fila do responsável → 403 se a criança tentar ler a fila →
  aprovar → **sai da fila e o app fica whitelisted na política** → foto do membro pelo responsável,
  403 pra criança e 400 pra payload inválido.

## 📋 Pendências no gerencial + bateria e "último lugar" que nunca funcionaram (2026-07-26, rodada 11)
Três achados do fundador na tela de gerenciamento da criança. **Sem build nesta rodada** (pedido dele —
mais melhorias vêm antes de empacotar).
1. **Pedidos só chegavam por push** — se o responsável perdesse a notificação, não havia onde aprovar.
   Agora há um **card "Aguardando você"** (`PendingRequestsCard`, com badge de contagem) na tela do membro
   **e** na do controle parental, com **aprovar/recusar inline**: tempo extra (tabela `extra_time_requests`,
   fluxo existente) e **liberação de app** — que não tinha tabela. Estratégia schema-frozen: o pedido vive
   em `audit_logs` (46 = solicitado, **48 novo** = resolvido); pendente = último 46 sem 48 depois, janela
   de 24h. Aprovar grava `IsWhitelisted` (ou usa `temporaryAllowApp` no botão **"Por 1h"**), recusar só
   fecha; ambos avisam a criança (push + realtime `AppAccessDecided`) e o device re-sincroniza em segundos.
   Rotas: `GET /parental/children/:id/requests`, `POST .../requests/app-access`.
2. **"Bateria" sempre "—"**: `expo-battery` estava **instalado e nunca usado** — nada no cliente reportava.
   Agora o **heartbeat da criança** (60s) manda `batteryLevel`, e o `useReportLocation` também (centralizado
   no hook, então home/criança/idoso ganham de graça).
3. **"Último lugar" sempre "—"**: `family_members.LastLocationLabel` era **lido e nunca escrito** por
   ninguém. Agora o cliente faz **reverse-geocode** (`expo-location`) do fix e envia `locationLabel` no
   `POST /locations`; a API persiste (truncado em 120 chars). Best-effort — sem rede, só não rotula.
4. **Tela do membro reorganizada** (mesmo dia): removido o card "hero" de presença (avatar + nome +
   "Offline · visto…" + badge do papel) — era redundante com o header. O **avatar foi pro canto superior
   direito do header**, clicável, com o mesmo fluxo de foto do perfil do adulto (pick → resize 256px →
   data URI) e badge de câmera; toque com foto existente abre "Alterar/Remover". Só responsáveis podem
   editar (`canManage`), demais veem o avatar sem ação. A presença não se perdeu: virou a linha **"Visto
   por último"** no card de detalhes, junto de Bateria e Último lugar.
   - API nova: `PUT /families/:familyId/members/:memberId/avatar` (`setMemberAvatar`) — guard de
     admin/guardião na família, mesma validação do avatar próprio (https ou data URI ≤400k), audita a
     mudança e emite `ProfileUpdated` pro membro. Motivo: só existia "atualizar MINHA foto"; criança/idoso
     raramente põem a própria.
- TS mobile+api OK, 28/28 testes. ⬜ Falta: build/deploy quando o fundador pedir.

## 🛡️ Escudo em processo separado + ícone da marca no overlay (2026-07-26, rodada 10)
**Confirmado em device**: overlay "App bloqueado" aparecendo sobre o launcher ✅ e Device Admin ativo
(prova: "Forçar parada" fica **cinza** nas Informações do app — o MIUI só desabilita isso para device
admins) ✅. **Falha restante**: ao "fechar todos" os apps, a proteção parava.
- **Causa raiz**: o `AppBlockShieldService` rodava **no mesmo processo** do app RN. Limpar os recentes no
  MIUI mata o processo da task inteira → o escudo (e o AccessibilityService com ele) morriam junto;
  `stopWithTask="false"` não salva quando é o PROCESSO que é morto, não só o serviço.
- **Fix**: `android:process=":shield"` — o escudo agora vive em processo próprio, isolado da task do app.
  Fechar todos não o alcança. Como um processo separado não pode confiar em SharedPreferences escritas
  pelo processo principal (instância potencialmente stale), o estado (`enabled`) chega via **extra do
  Intent** e é cacheado no serviço (START_STICKY entrega intent nulo no restart → mantém o último valor).
- **Heartbeat interno** (Handler, 5 min): enquanto o processo do escudo está vivo ele re-arma o watchdog
  sozinho — sem depender de alarme sobreviver ao OEM. Watchdog do AlarmManager caiu p/ **10 min** (só
  cobre o caso "processo morto mesmo assim").
- **Passo "Travar nos recentes"** no guia (só em OEM agressivo): puxar o card do WardYou pra baixo → cadeado.
  É o mecanismo do MIUI que impede o "fechar todos" de matar o app — instrução pura (não há API). i18n ×4.
- **Ícone oficial no overlay** (pedido do fundador): o badge do painel "App bloqueado" agora carrega o
  ícone real do app (`packageManager.getApplicationIcon`) no lugar do emoji 🛡️.
- TS + 21/21 + Kotlin OK. APK **`wityu-20260726-shieldproc.apk`** (= `wityu-latest.apk`).

### ✅ QA automatizada no emulador (2026-07-26) — verificada por adb, sem depender do device do fundador
Rodada no AVD `wityu_test` (API 33) com build x86_64 à parte; a11y + usage habilitados via `adb settings`/
`appops`, estado de enforcement injetado direto em `shared_prefs/wityu_app_block_prefs.xml` (`adb root`),
firewall total com só o WardYou na whitelist. Resultados **observados**:
1. **Escudo em processo próprio sobe sozinho**: ao religar o a11y service, `ps` mostra
   `com.wityu.app:shield` — iniciado pelo `onServiceConnected`, sem o JS rodar.
2. **Sobrevive à morte do processo principal** (`kill -9` no `com.wityu.app`, equivalente ao "fechar
   todos"): o pid do `:shield` permanece o MESMO; o processo principal é ressuscitado pelo sistema.
3. **Bloqueio + overlay**: abrir o Chrome → foreground volta pro launcher E o painel "App blocked"
   aparece por cima, **sem abrir o WardYou** — com o **ícone oficial** (screenshot conferido).
4. **Bloqueio persiste após o kill**: com o app "fechado", abrir o Chrome de novo → bloqueado igual.
5. **Notificação "Proteção ativa"** (id 4211) presente antes e depois do kill.
Limite conhecido: o emulador é AOSP, não reproduz os task killers da MIUI/HyperOS — os passos de
blindagem (autostart, travar nos recentes, bateria) seguem necessários no aparelho real.

## 🔒 Proteção contra desinstalação — Device Admin (2026-07-26, rodada 9)
**Brecha achada pelo fundador no device**: mesmo com Configurações bloqueadas, a criança segura o ícone do
WardYou no launcher e toca **"Desinstalar"** — o menu é desenhado pelo LAUNCHER (whitelisted como essencial),
então o AccessibilityService nunca vê troca de app e não bloqueia. Uma desinstalação derruba todas as
camadas de uma vez. Fix canônico (mesmo dos concorrentes): **Device Admin**.
- `AppBlockDeviceAdminReceiver` + `res/xml/app_block_device_admin.xml`: enquanto o admin está ativo, o
  **Android recusa a desinstalação** ("app é administrador do dispositivo"). Políticas **mínimas** —
  só `force-lock`; **sem wipe-data, sem controle de senha** (nada que possa brickar o aparelho da criança,
  e defensável no review da Play).
- `onDisableRequested` mostra aviso do sistema; `onDisabled` grava flag em prefs → o **heartbeat** envia
  `adminDisabled` → API dispara push **high-priority** "⚠️ Proteção contra desinstalação removida" +
  realtime aos tutores (sem throttle — a flag já é one-shot no device; audit `ParentalProtectionDisabled`
  com `reason: deviceAdminDisabled`). Ou seja: desativar o admin **não é silencioso**.
- **Bônus antifurto**: `lockScreen` agora tem 2 caminhos — ação global de acessibilidade (API 28+) e
  **`DevicePolicyManager.lockNow()`** via a política force-lock (funciona também em Android < 9 e sem
  acessibilidade). `canLockScreen` reflete os dois.
- **Passo 0 do guia de blindagem** ("Impedir desinstalação", com check ao vivo) — posto **primeiro** por ser
  o buraco mais largo; card do ChildHome também cobra. i18n ×4 (JS) + strings nativas pt/en/es/fr.
- TS mobile+api OK, 28/28 testes. APK **`wityu-20260726-antiuninstall.apk`** (= `wityu-latest.apk`) +
  **API redeployada** (health 200) — ambos no ar. ⚠️ Limite honesto: Device Admin **impede desinstalar**, mas o usuário
  ainda pode desativá-lo em Ajustes → Segurança (multi-passo, com aviso, e o responsável é avisado na hora).
  Blindagem absoluta exigiria **Device Owner** (provisionamento via ADB/QR num aparelho resetado) — próximo
  nível, se o fundador quiser.

## 🎉 CONFIRMADO EM DEVICE + proteção agora sobrevive ao app fechado (2026-07-25, rodada 8)
**Fundador validou no Redmi**: bloqueio + roteamento + tela "App bloqueado / pedir liberação" funcionaram
**perfeitamente, sem abrir o WardYou** — o fluxo arquitetural pedido está entregue e verificado em campo.
**Novo achado dele**: ao FECHAR o WardYou, a proteção parava e os apps bloqueados voltavam a abrir.
Causa raiz: o escudo (FGS que segura o processo) só era iniciado **pelo JS** (`setEnforcementState`) —
app fechado ⇒ ninguém religa ⇒ a MIUI mata o processo ⇒ o AccessibilityService cai junto. Fix em 4 camadas,
todas independentes do app RN estar vivo:
1. **AccessibilityService vira o dono do keep-alive**: `onServiceConnected` inicia escudo + watchdog se há
   política ativa (o service é bound pelo SO e volta sozinho, então é o lugar certo — antes dependia do JS).
2. **`android:stopWithTask="false"`** no `AppBlockShieldService` + `onTaskRemoved` que se re-arma: **fechar o
   app (swipe dos recentes) não derruba mais o serviço**.
3. **Watchdog `AppBlockWatchdog` (AlarmManager, 15 min, one-shot re-armado)**: o alarme vive no SISTEMA, então
   sobrevive à morte do processo — dispara, acorda o processo, religa o escudo (`setExactAndAllowWhileIdle`
   com fallback inexato p/ Android 12+ sem SCHEDULE_EXACT_ALARM). Receiver também trata QUICKBOOT_POWERON.
4. **Auto-cura no evento de acessibilidade** (throttle 60s): se o killer parou escudo/watchdog mas o service
   segue vivo, religa os dois na próxima interação — custo zero com o telefone parado.
   Watchdog é cancelado quando a proteção é desligada (sem gastar bateria à toa).
Nota: o estado em prefs é default-deny (`blockAll` + whitelist), então mesmo com o JS morto o cache mantém
o bloqueio correto — o que faltava era só o processo continuar vivo. Kotlin compila limpo.

**+ Regras temporais movidas pro nativo** (achado ao revisar o código, não pelo teste): a decisão do JS é
um **snapshot**; com o app fechado ninguém recomputava, então (a) o **horário de sono nunca começava** a
bloquear e (b) uma **liberação temporária nunca expirava** — a criança ficaria com acesso permanente ao app
liberado "por 1h" se o WardYou não fosse reaberto (buraco real de segurança). Agora o `syncEnforcement` envia
junto `hardBlockWindowsJson` (`[{s,e,d}]` sono + schedules blockAll) e `tempAllowsJson` (`{pkg: epochMs}`),
e `AppBlockTimeRules` reavalia **a cada troca de app** contra o relógio do aparelho (mesma regra
Monday-bit0/overnight do `enforcementLogic.ts`; whitelist colapsa no hard block; temp allow ativo fura o
hard block, temp expirado deixa de valer). A lógica pura e seus 21 testes ficaram **intactos** — só o
plumbing de plataforma mudou. TS + 21/21 OK.
APK final da rodada: **`wityu-20260725-bg-timerules.apk`** (= `wityu-latest.apk`) — persistência do escudo
+ regras temporais nativas juntos. Substitui o `wityu-20260725-background.apk`.
APK **`wityu-20260725-background.apk`** (= `wityu-latest.apk`). ⬜ Validar em device: bloqueio persistindo
com o WardYou fechado (swipe dos recentes) e depois de ~20 min parado.

## ✅ Overlay antes do HOME (2026-07-25, rodada 7) — corrige race de transição na MIUI
Melhoria fundamentada (não chute): a ordem era `GLOBAL_ACTION_HOME` → depois overlay. Ir pra Home inicia
uma transição de janela, e adicionar janela DURANTE a transição é o que gera `BadTokenException` /
overlay descartado na MIUI/HyperOS — provável causa se o painel não aparecer. Invertido: **overlay
primeiro** (anexa sobre a janela ainda estável do app bloqueado), **depois HOME** como backstop, via
callback `onShown` que roda sempre (sucesso ou falha do add) → o kick pra Home nunca depende do overlay
renderizar, então enforcement não regride. Backstop guardado (roda 1x). Kotlin compila. Aditivo.
APK **`wityu-20260725-overlay5-order.apk`** (= `wityu-latest.apk`) — reúne rodadas 1-7 do dia.

## ✅ Full-screen intent como 3º caminho do overlay (2026-07-25, rodada 6) — UI do background garantida
Belt-and-suspenders final pró-reteste MIUI/HyperOS: se **ambos** os overlays (a11y + app-overlay) forem
suprimidos pelo OEM, o `AppBlockOverlay` dispara um **full-screen-intent notification** (mecanismo de
chamada recebida — `CATEGORY_CALL` + `setFullScreenIntent(pi, true)`) apontando pro deep link
`wityu://blocked` → a tela aparece **sozinha, do background**, que é o que OEMs permitem (diferente do
`startActivity` puro que falhou nas 1ªs tentativas). Perm `USE_FULL_SCREEN_INTENT` no manifest;
diagnóstico reconhece `fullscreen-intent` como sucesso. Aditivo — não toca no kick pra Home. TS+Kotlin OK.
APK **`wityu-20260725-overlay4-fsi.apk`** (= `wityu-latest.apk`).

## ✅ Auto-diagnóstico do overlay (2026-07-25, rodada 5) — reteste vira sinal objetivo
Pra fechar o loop de "aparece no device?" sem depender de impressão visual: o `AppBlockOverlay` agora
grava em prefs QUAL caminho renderizou (`a11y-overlay`/`app-overlay`) ou o erro (`failed: <Exception>`)
a cada tentativa. Bridge `getLastOverlayResult()` + linha de diagnóstico na tela de blindagem
(`protection-setup`): depois de abrir um app bloqueado, o tutor vê "Tela de bloqueio testada e
funcionando ✓" ou o motivo da falha. Risco zero ao enforcement (só escreve string). i18n ×4
(`shieldSetup.diagOk/diagFail`). Typecheck + 21/21 + Kotlin compila limpo. APK
**`wityu-20260725-overlay3-diag.apk`** (= `wityu-latest.apk`).

## ✅ Overlay de bloqueio blindado p/ MIUI (2026-07-25, rodada 4) — fallback SYSTEM_ALERT_WINDOW
Preventivo pró-reteste (fundador está em Redmi/HyperOS, o OEM mais agressivo; a tela de bloqueio já
falhou 2x com deep link). O overlay de acessibilidade (`TYPE_ACCESSIBILITY_OVERLAY`, sem permissão)
continua sendo o caminho primário, mas ganhou **fallback**: se o `addView` falhar (OEM suprime o
overlay de a11y), tenta `TYPE_APPLICATION_OVERLAY` — que exige "sobrepor a outros apps"
(SYSTEM_ALERT_WINDOW), permissão que a MIUI expõe num toggle explícito. Entre os dois, o painel aparece
em qualquer aparelho.
- `AppBlockOverlay.show` monta a lista de tipos (a11y sempre; app-overlay só se `canDrawOverlays`) e
  tenta em ordem. Manifest do módulo ganhou `SYSTEM_ALERT_WINDOW`.
- Bridge nova: `canDrawOverlays()` + `requestOverlayPermission()` (abre
  `ACTION_MANAGE_OVERLAY_PERMISSION`).
- Guia de blindagem (`protection-setup.tsx`) ganhou o passo "Sobrepor a outros apps" (com check ao vivo);
  card de blindagem do ChildHome nag também se overlay off. i18n ×4 (`shieldSetup.overlay*`).
- Typecheck + 21/21. APK **`wityu-20260725-overlay2.apk`** (= `wityu-latest.apk`). ⚠️ 1º build falhou por
  faltar `import android.os.Build` no `AppBlockOverlay.kt` (tsc não pega Kotlin) — corrigido no 2º.

## ✅ Toggles otimistas em todo o app (2026-07-25, rodada 3) — fim do "todos os switches escurecem 2s"
Feedback do fundador: tocar num switch da tela de Apps escurecia **todos** os switches por ~2s. Causa:
`disabled={save.isPending}` em cada toggle + zero update otimista (UI só mudava na resposta do servidor).
Fix em duas camadas:
- **Componente `Toggle` (fix global)**: agora tem estado otimista interno — o knob vira **na hora** do
  toque e reconcilia com a prop `value` quando o servidor responde (limpa o override na mudança da prop;
  safety de 4s pra não travar se um save falhar e voltar ao mesmo valor). Vale pra QUALQUER chamador,
  com ou sem update otimista no hook.
- **Removido `disabled={...isPending}`** de todos os toggles (apps, política, sono, bloqueios, zonas
  ×3, consentimentos, notificações, perfil) — só sobrou `disabled` em gates legítimos (consentsLoading,
  antifurto não-hidratado, botão de conceder consentimento).
- **`useSaveAppRules` com update otimista de cache** (`onMutate`/`onError` rollback/`onSettled`): como o
  PUT substitui o conjunto todo, a projeção dos inputs no cache é exata — a lista reflete a mudança
  instantânea, servidor confirma depois.
- Typecheck + 21/21. APK **`wityu-20260725-overlay.apk`** (= `wityu-latest.apk`) reúne rodadas 1-3 do dia
  (escudo + overlay nativo + toggles otimistos).

## ✅ Overlay nativo de bloqueio + "Proteção ativada" + barra viva (2026-07-25, rodada 2) — pós-2º teste
2º teste em device: kick-out perfeito (<1s), MAS a tela de bloqueio via deep link **só aparecia ao abrir
o WardYou depois** — MIUI engole `startActivity` de background (silencioso, sem exception). Fix
arquitetural definitivo + 2 pedidos de UX do fundador:
- **Overlay de acessibilidade** (`AppBlockOverlay.kt`, `TYPE_ACCESSIBILITY_OVERLAY`): o próprio service
  desenha o painel "App bloqueado" **na hora do kick** — esse tipo de janela **não precisa de permissão
  nenhuma** e é imune às restrições de background-activity-launch (o pop-up permission da MIUI vira
  irrelevante). UI 100% programática (sem tema/AppCompat no service), cores da marca, strings nativas
  pt (default) + values-en/es/fr. Botões: **Pedir liberação** e **Pedir mais tempo** (chips 15/30/60) →
  gravam na fila `pending_requests` do SharedPreferences (cap 20) + `AppBlockEventBus.poke()`;
  confirmação "Pedido enviado! ✓" e auto-dismiss (30s idle / 2,5s pós-ação). Deep link/rota
  `app/blocked.tsx` continua existindo como fallback, mas o fluxo principal é o overlay.
- **Ponte fila→API** (`useAppBlockRequests`, montado no AuthGate): drena a fila e POSTa
  (`request-app-access` / `extra-time/request`) com a sessão da criança — dispara no poke (instantâneo
  com o processo vivo via escudo FGS), no mount e a cada 60s; falha de rede → retry na próxima janela.
- **Card "Proteção ativada" NÃO-clicável** no ChildHome (accessibility+usage on): vira status verde com
  escudo ✓ — sem atalho de volta pras configurações onde a criança poderia caçar o desligar (pedido
  explícito do fundador; tamper alert continua cobrindo o caso de desligarem por fora).
- **Barra de progresso viva**: `used = max(server, UsageStats local)` recalculado a cada tick de 60s
  (mesmo filtro do reportUsage — WardYou não consome budget); countdown do header idem (display only —
  o enforcement continua usando o remaining do servidor).
- Typecheck + 21/21 mobile. Sem mudança de API nesta rodada (a rodada 1 do dia já subiu os endpoints).

## ✅ Escudo protetor v1 + tela de bloqueio + mapa expandido (2026-07-25) — pós-1º teste em device real
**1º teste em device real do modo criança (Redmi/MIUI): o firewall FUNCIONOU** — bloqueou tudo — mas
depois "liberou sozinho": comportamento clássico da MIUI de matar o processo e desligar a chave de
Acessibilidade. Rodada fecha os dois pedidos do fundador ("tela dizendo que está bloqueado com pedido
de liberação/tempo" e "nunca parar em background") + mapa da família expandível:
- **Tela de bloqueio** (`app/blocked.tsx`): o AccessibilityService, além do kick pra Home (garantido),
  lança `wityu://blocked?pkg&label` (debounce 5s/pkg, try/catch — MIUI sem permissão de pop-up só faz
  o kick). Tela mostra "«app» não está liberado" + **Pedir liberação** (novo
  `POST /parental/request-app-access` → push+realtime aos tutores, throttle 5min/app em memória, audit
  46) + **Pedir mais tempo** (15/30/60, fluxo extra-time existente) + voltar. i18n ×4.
- **Escudo persistente**: `AppBlockShieldService` (FGS `specialUse`, notificação MIN "Proteção WardYou
  ativa", START_STICKY) ligado/desligado pelo próprio `setEnforcementState`; `AppBlockBootReceiver`
  (BOOT_COMPLETED/MY_PACKAGE_REPLACED) religa após reboot/update. Mantém o processo em prioridade de
  foreground → MIUI para de matar o service.
- **Blindagem guiada** (`app/protection-setup.tsx` + card no ChildHome): isenção de bateria (dialog do
  sistema, com check real `isIgnoringBatteryOptimizations`), autostart do OEM (intents MIUI/Huawei/
  Oppo/Vivo com fallback) e pop-up em background (MIUI). Card aparece só em OEM agressivo/sem isenção;
  flag `wityu_shield_setup_done` no storage. Novas perms: FOREGROUND_SERVICE(_SPECIAL_USE),
  RECEIVE_BOOT_COMPLETED, REQUEST_IGNORE_BATTERY_OPTIMIZATIONS (manifest do módulo).
- **Tamper alert**: heartbeat detecta transição HasAccessibility true→false com política ativa → push
  high-priority "⚠️ Proteção desativada" + realtime `ChildProtectionChanged` aos tutores (throttle
  30min, audit 47). Cliente invalida `["parental","children"]`.
- **Mapa da família expandido** (`app/family-map.tsx`): tocar no preview do mapa na home abre
  fullscreen reutilizando `TripLiveMap` (pins de avatar, foco por membro) — módulo de trajetos **não
  foi tocado**, só importado. Preview ganhou `pointerEvents="none"` pro toque sempre expandir.
- Typecheck mobile+api OK, testes 28/28. **Typed routes**: rotas novas exigem regenerar
  `.expo/types/router.d.ts` — `expo start` rápido resolve (export web NÃO regenera).
- ⚠️ Validar em device: escudo sobrevivendo à MIUI (com blindagem feita), tela de bloqueio aparecendo
  (precisa da permissão de pop-up em background na MIUI), push de pedido de liberação chegando no tutor.

## ✅ Build p/ teste do modo criança em device real (2026-07-25)
APK **`wityu-20260725-childmode.apk`** (= `wityu-latest.apk`) gerado e subido no Blob (SAS 7 dias) para o
fundador instalar no telefone da criança e validar o firewall/kick-out real — **nenhuma mudança de código**
desde 16/07 (rebuild só-JS do mesmo fonte, mesmo `android/`); auditoria pré-build reconfirmou o circuito
completo: lista de apps instalados → `/parental/my-apps` → allowlist do tutor → enforcement no device
(6 mecanismos: firewall default-deny, tempo/app, limite global, liberar por N horas, pausa remota, sono/janelas).
⚠️ Toolchain: `node.exe` sumiu de `C:\Program Files\nodejs` (instalação quebrada — npm ficou, binário não);
resolvido com **Node portátil 22.14.0 em `C:\Android\node`** (sem admin, mesmo padrão do resto do toolchain).
Gradle precisa dele no PATH: `export PATH="/c/Android/node:$PATH"` antes do `gradlew.bat`.

## ✅ Sessão persistente + trava biométrica + 2 fixes de UX (2026-07-16)
Quatro itens numa rodada (APK **`wityu-20260716-biometric.apk`** = `wityu-latest.apk`, com pacote
nativo novo → prebuild + build completo; API redeployada pelo item 1):
1. **Logout automático "depois de um tempo" — RESOLVIDO**. Causa raiz: refresh token é **uso único
   rotacionado**, mas agora há vários refrescadores independentes (app + tasks headless de trajeto FGS,
   parental-sync, trip-resume). Quando um rotaciona, os outros ficam com o token revogado → 401 →
   `clear()` → deslogado no meio do uso. Fix em duas camadas:
   - **Server** (`authService.refresh`): **janela de tolerância de 60s** — um token revogado MAS
     recém-rotacionado (`ReplacedByTokenHash` setado, revogado ≤60s) é aceito e emite um token novo, em
     vez de falhar. Fora da janela = reuso genuíno → rejeita.
   - **Cliente** (`api/client.doRefresh` + `session.reloadFromStorage`): refresca a partir do token mais
     fresco do **storage** (uma task de background pode tê-lo rotacionado lá); se ainda assim for
     rejeitado, relê o storage e tenta de novo antes de desistir; erros de rede **nunca** deslogam.
2. **Trava biométrica estilo WhatsApp** (`expo-local-authentication`): `useAppLock` (enabled persistido,
   locked em runtime) + `AppLockGate` no root (tela cheia sobre o app; trava no cold start e a cada
   background→foreground; **nunca** na tela de login — gated em `status==="authenticated"`). Toggle em
   Ajustes → Segurança (só aparece se há digital/rosto cadastrado; ligar/desligar exige biometria).
   `services/auth/biometrics.ts` é wrapper best-effort lazy (web = no-op).
3. **SOS/antifurto com biometria**: overlay do alarme ganhou botão "Desligar com a digital"; e o Modo
   Guarda agora **arma sem exigir PIN** quando há biometria (a digital do dono desliga o alarme) — PIN
   vira opcional (fallback). i18n ×4.
4. **Ícone do WardYou nas notificações**: `notification-icon.png` (escudo monocromático) plugado no
   `expo-notifications` → some o círculo cinza genérico na barra de status/bandeja (vale p/ a
   notificação fixa do trajeto E todos os pushes), tingido com a cor da marca.
5. **Flash "Unmatched Route" pós-Google SSO**: criadas `app/auth/callback.tsx` (spinner "Entrando…"
   enquanto o AuthGate assume) e `app/+not-found.tsx` (Redirect p/ "/") — nunca mais mostra o 404 do
   Expo Router.

## ✅ Modo viajante — gap de SOS fechado (2026-07-16)
Auditoria do modo viajante: onboarding "Sou viajante" + TravelerHome + stack de trajetos já estavam
prontos. **Gap achado e corrigido**: o SOS só notificava a FAMÍLIA — um viajante sem família acionava
SOS e **ninguém era avisado**, e companheiros de trajeto fora da família nunca recebiam nada, apesar de
`ReceiveSosAlerts` ser coletado no aceite do convite (e nunca usado). Fix **aditivo em
`routes/sos.ts`** (nenhum arquivo do módulo de trajetos congelado foi tocado): após o fluxo de família,
o SOS agora também emite realtime `SosTriggered` + push high-priority "🆘 SOS no trajeto ({nome})" para
os membros ativos de todos os trajetos ativos do acionador que optaram por `ReceiveSosAlerts`,
deduplicado contra os destinatários da família. Sem mudança no cliente (handler `SosTriggered` já
vibra/invalida por usuário) — **só redeploy da API, sem APK novo**.

## ✅ Modo idoso v2 (2026-07-16) — scheduler, lembretes, alerta de inatividade, adesão de medicação
A base (check-in 1-toque, CRUD de medicações, home simplificada) já existia mas era 100% pull — o
cuidador nunca era avisado de nada e não havia NENHUM mecanismo de horário na API. Fechado agora:
- **Scheduler in-process** (`apps/api/src/scheduler.ts`, tick 60s, iniciado no server.ts;
  `ELDER_SCHEDULER=off` desliga; dedupe em memória por dia — single-container, sem lock distribuído):
  1. **Lembrete de remédio**: push high-priority ao idoso em cada horário configurado (`Times` CSV,
     `DaysOfWeek` 0 = todo dia, senão bitmask Seg-bit0).
  2. **Lembrete de check-in** (`ELDER_CHECKIN_REMINDER`, default 09:00 local): push ao idoso se ainda
     não fez check-in hoje.
  3. **Alerta de inatividade** (`ELDER_INACTIVITY_ALERT`, default 14:00 local): idoso AINDA sem
     check-in → push high-priority + realtime `ElderInactivityAlert` aos cuidadores ("Que tal ligar?").
- **Fuso local de verdade** (`lib/localTime.ts`, `ELDER_TZ` default America/Sao_Paulo, via Intl/ICU):
  "hoje" do check-in deixou de ser UTC (check-in às 22h BRT contava no dia errado).
- **Push no check-in**: cuidador recebe "💚 {nome} confirmou que está bem hoje" (antes só realtime).
- **Adesão de medicação ("Tomei")**: mesma estratégia schema-frozen do check-in — cada dose confirmada
  é um `audit_logs` (Action `ElderMedicationTaken`=45, MetadataJson {medicationId,time,name}),
  idempotente por (med,horário,dia). Rotas novas: `POST /elder/medications/:id/taken`,
  `GET /elder/adherence/my`, `GET /elder/:id/adherence`, `GET /elder/:id/check-in/history?days=N`.
  Realtime `ElderMedicationTaken` para o cuidador.
- **ElderHome**: cada dose de hoje ganhou botão grande **"Tomei"** (verde, vira ✓ "Sua família foi
  avisada"); i18n ×4.
- **Tela do cuidador** (`elder/[elderUserId].tsx`): cards novos — **bateria do aparelho** (ícone
  vermelho ≤20%) + **visto por último** (dados que já existiam no DTO e nunca eram renderizados),
  **remédios de hoje** (chips ✓/pendente por dose) e **check-ins dos últimos 7 dias**.
- Pendências conhecidas (registradas, não implementadas): detecção de queda (diferencial estratégico,
  ARQUITETURA-AGENTES), fonte ampliada dedicada, idoso como perfil gerenciado sem login,
  `family_elder_settings` (toggles legados) continua não exposto.
- APK **`wityu-20260716-elder2.apk`** (= `wityu-latest.apk`) + API redeployada juntos.

## ✅ Controle parental v2 "Kids360, só que melhor" (2026-07-16) — apps instalados, liberar por horas, pausa temporizada, sync em segundos
Pedido do fundador: tutor vê os apps instalados no aparelho da criança e configura bloqueio total OU
libera apps por um período de horas. **Módulo de trajetos congelado (não foi tocado).**
- **Estados temporizados SEM tocar no schema legado** (`parentalService.ts`): o prazo viaja codificado
  no `AppCategory` varchar(40) como `"Categoria|until:<epochSec>"`; decodificação SÓ no service — os
  clientes recebem `allowedUntil`/`pausedUntil` limpos. Pausa temporizada usa uma linha sentinela
  oculta em `app_rules` (`__wityu.pause`), com **lazy-expire** em qualquer leitura (sem scheduler).
  Sentinelas são filtradas de toda listagem e protegidas do replace-set do PUT rules; `upsertAppRules`
  re-codifica o prazo sobrevivente (o guardião faz round-trip da categoria decodificada).
- **Novos recursos API**: `POST .../apps/:pkg/temporary-allow {hours: 0..24}` (0 limpa);
  `remote-action` aceita `durationMinutes` (pausa auto-expira); `mapRule` expõe `configured`
  (UpdatedByUserId ≠ criança = tutor já decidiu — a descoberta do device grava o id da criança);
  ações de auditoria 43/44.
- **Sync em segundos, não 60s**: `notifyChildPolicyChanged` (9 mutações: policy, rules, temp-allow,
  remote-action, websites, sleep, block-schedules ×3) → realtime `ParentalPolicyChanged` + **FCM
  data-only `parental-sync`** → no device da criança: handler realtime chama `fullParentalSync` na hora
  (app aberto) e a task headless de push (`pushBackgroundTask`) hidrata a sessão Zustand e re-sincroniza
  **com o app morto**. Tutor pausa → aparelho da criança obedece em segundos.
- **Fix de segurança no enforcement** (`enforcementLogic.ts` + 5 testes novos, 21/21): pausa/sono/
  janela/limite estourado agora **colapsam a whitelist para só o WardYou** — antes, apps liberados
  continuavam funcionando durante a pausa (o service nativo deixa whitelisted passar pelo blockAll).
  A liberação temporária (`allowedUntil`) é a ÚNICA que atravessa o hard-block (válvula de escape:
  "pausa tudo mas deixa o WhatsApp por 1h") e ignora o limite diário por-app enquanto ativa.
- **UI do tutor**: `apps.tsx` com 3 seções — "Novos no aparelho" (badge decidir, borda azul; =
  `!configured`), "Liberados" (inclui temporários com "Liberado até HH:MM") e "Bloqueados" — + botão
  relógio por app (modal 1/2/4/8h, remover liberação). Detalhe da criança: **pausar por 30min/1h/2h/
  indefinido** com countdown "Pausado até HH:MM". i18n ×4.
- **Criança**: `reportInstalledApps` também a cada 15 min com o app aberto (era só no cold open).
- APK **`wityu-20260716-parental2.apk`** (= `wityu-latest.apk`) + API redeployada juntos.
- ⚠️ Validação em device pendente: kick-out real do AccessibilityService (bridge JS→nativo só passou a
  funcionar hoje — ver achado do stub), temp-allow ponta-a-ponta, pausa expirar sozinha no aparelho.

## ✅ Eventos de trajeto ponta-a-ponta + retomada por push (2026-07-16) — "sem precisar abrir o app"
Fecha o gap "o aparelho do membro só fica sabendo do trajeto quando abre o app". API + cliente:
- **API (`routes/trips.ts` + `lib/fcm.ts` + helper `notifyTripMembers`)**:
  - Aceite de convite → realtime `TravelMembersChanged` a todos os membros + push "«nome» entrou no
    trajeto" aos demais. Encerrar/deletar/sair → `TravelClosed`/`TravelMembersChanged` + push "Trajeto
    encerrado" (delete AGUARDA o snapshot dos membros antes do cascade).
  - **Nudge de retomada**: no `GET /:id/map`, membro com ShareLiveLocation cujo último fix passou de
    2min (ou nunca postou) recebe **FCM data-only high-priority** `{type:"trip-resume"}` (throttle
    5min/usuário, Map em memória). `fcm.ts` ganhou `dataOnly` (sem bloco notification, priority high).
- **Cliente**:
  - `useRealtimeSync`: `TravelMembersChanged`/`TravelClosed` → invalidate `["trips"]` → o
    `useTripLocationBroadcast` liga/desliga a transmissão na hora com o app aberto/em background.
  - **Task headless de push** (`pushBackgroundTask.native.ts`, registrada via
    `Notifications.registerTaskAsync` no `usePushRegistration`): data push `trip-resume` → 
    `resumeTripTrackingFromPush()` (`tripLocationTracking.native.ts`) re-busca `/travels` direto da API
    (com refresh de token), regrava a lista e religa o serviço de localização — **com o app morto, sem
    interação**. Sem prompt de permissão (checa `getForegroundPermissionsAsync` silencioso); textos da
    notificação fixos em pt (i18next não existe no contexto headless).
  - Resultado: alguém abrindo o mapa do trajeto "acorda" qualquer membro que parou de transmitir.
- APK **`wityu-20260716-tripevents.apk`** (= `wityu-latest.apk`) + API redeployada juntos.

## 🔴→✅ Regressão "mapa vazio em trajeto novo" (2026-07-16) — corrida no task + camadas de resiliência
Fundador encerrou "Dubai" e criou "Tokio" em seguida → NINGUÉM postava posição no trajeto novo (mapa
"nenhum membro compartilhou posição", app aberto). **Causa raiz (corrida antiga, exposta pelo fluxo
encerrar→criar):** o tick do task headless que ainda processava a lista antiga recebia **410** do
trajeto encerrado e escrevia de volta seu snapshot obsoleto (geralmente `[]`) — **sobrescrevendo o
trajeto novo** que o hook tinha acabado de gravar — e chamava `stopTripLocationTracking()`, matando o
serviço. Sem posição até reabrir o app. Fixes em camadas (`tripLocationTracking.native.ts` +
`useTripLocationBroadcast.ts` + `locationService.ts`):
1. **Task nunca mais clobbera**: ao dropar trajetos 403/410, relê a lista ATUAL do storage e remove só
   os dropados; só para o serviço se o resultado ficar vazio.
2. **Retry no start**: `startLocationUpdatesAsync` com 1 retry (1,5s) — nunca morre calado no 1º soluço.
3. **Poster de primeiro plano em TODAS as plataformas** (antes era só web): watch 5s + POST a cada 10s
   enquanto o app está ativo → primeiro pin do trajeto novo em segundos + posições fluindo mesmo se o
   serviço do SO morrer. Duplicata com o serviço é inofensiva (mapa mostra o fix mais novo).
APK: **`wityu-20260716-livetrack2.apk`** (= `wityu-latest.apk`), substitui o `livetrack`.

## ✅ Rastreamento ao vivo "estilo Uber" (2026-07-15, madrugada) — cadência 45s → 10s
Fundador: posição dos viajantes precisa acompanhar o deslocamento como no Uber. Mudanças:
- **Emissor** (`tripLocationTracking.native.ts`): `timeInterval` 45s → **10s** (High accuracy,
  `distanceInterval: 0` heartbeat mantido, entrega imediata). Custo de bateria limitado à duração do
  trajeto. **Removido o guard "already started? return"** do `ensureTripLocationTracking` — ele fixava o
  aparelho pra sempre na cadência registrada pelo APK antigo; `startLocationUpdatesAsync` num task já
  ativo só troca as opções in-place, então agora todo open do app adota a cadência atual.
- **Receptor** (`useTripMap`): poll 20s → **10s** (o realtime `TravelLocationUpdated` continua chegando
  primeiro; o poll é rede de segurança). Servidor já emitia por POST — sem mudança de API.
- APK: **`wityu-20260716-livetrack.apk`** (= `wityu-latest.apk`). Pré-requisito no aparelho de CADA
  viajante: instalar o APK novo e abrir o app 1x (adota 10s) + aceitar a isenção de bateria.

## 🔴→✅ ACHADO CRÍTICO (2026-07-15, noite): stub do app-block empacotado em TODOS os APKs anteriores
Descoberto quando o card "Bloqueio de tela inativo" não fez nada ao tocar ("botão falso"): o
`modules/app-block/package.json` tinha **`"main": "index.ts"`** (com extensão explícita) — o Metro só
aplica o split por plataforma (`index.android.ts`) quando o main é **sem extensão**, então TODOS os
builds Android até aqui empacotaram o **stub no-op** (`index.ts`) no lugar do wrapper real. Ou seja:
**nenhuma chamada JS→nativo do app-block jamais rodou em device** — enforcement do modo criança
(setEnforcementState/usage/installed apps), acessibilidade e a trava antifurto eram todos no-op
silenciosos; o Kotlin sempre esteve correto e compilado no APK. Fixes:
- `"main": "index"` (sem extensão) no package.json do módulo → Metro resolve `index.android.ts` no
  Android (verificado via `expo export`: o bundle passou a conter o intent de acessibilidade).
- `openAccessibilitySettings()` ganhou fallback JS (`Linking.sendIntent("android.settings.
  ACCESSIBILITY_SETTINGS")` → `openSettings()`) pra nunca ser um botão morto.
- **Lição**: módulo local novo → conferir que o bundle contém o arquivo `.android.ts` (grep no export),
  e "validar em device" inclui validar que o JS chama o nativo de verdade.
- ⚠️ **Modo criança precisa de re-teste em device** agora que o bridge funciona de verdade.
- APK com o fix: **`wityu-20260715-appblock-bridge.apk`** (= `wityu-latest.apk`), o 3º e definitivo da
  noite — substitui `sosguard` e `pinfoto-lockwarn`.

## ✅ Hotfix pós-teste em device (2026-07-15, noite) — foto no pin (causa REAL) + aviso do bloqueio
O fundador instalou o `sosguard.apk` e reportou: foto AINDA branca no pin, e a chacoalhada disparou o
alarme mas **não travou a tela**. APK final: **`wityu-20260715-pinfoto-lockwarn.apk`** (= `wityu-latest.apk`).
1. **Foto no pin — causa raiz definitiva**: o `redraw()` não bastava porque o Fresco **nunca decodifica**
   a imagem dentro da subtree rasterizada do marker. O rnmaps tem o workaround interno
   `hackToHandleDraweeLifecycle` (attach manual do Drawee + recaptura no onFinalImageSet), mas ele SÓ
   checa o **filho direto** do `<Marker>` (`child instanceof DraweeView`) — nosso pin tinha a foto
   aninhada em 2 Views (padding→anel→Image), então o hack nunca engatava e TODA recaptura desenhava o
   círculo branco. **Fix (`AvatarMarker.native.tsx`)**: com foto, a `<Image>` (46px, anel via
   `borderWidth/borderColor`, `fadeDuration=0`) é agora o **filho direto** do Marker; sem foto, mantém o
   pin de iniciais custom (Text desenha síncrono, nunca teve o bug). Pin com foto perde o "rabinho" —
   aceito. Regra pra sempre: **imagem em marker do rnmaps = filho direto do Marker, nunca aninhada.**
2. **Trava não disparou**: era o serviço de acessibilidade desativado no aparelho — o prompt só
   aparecia no toggle de armar, e o fundador já estava armado desde antes do recurso existir. Fix:
   **card âmbar persistente** na tela SOS ("Bloqueio de tela inativo", `antifurto.lockDisabled*` i18n ×4)
   sempre que armado && Android && `!canLockScreen()`, re-checado no AppState active (volta das
   Settings); toque abre as configurações de acessibilidade. Obs. Android 13+: APK sideloaded pode exigir
   "Permitir configurações restritas" (Apps → WardYou → ⋮) antes de deixar ativar a acessibilidade.

## ✅ SOS/Antifurto (6ª rodada, 2026-07-15, parte 2) — título, vibração de alerta e trava real
**SHIPPED 2026-07-15**: APK `wityu-20260715-sosguard.apk` → **substituído na mesma noite pelo
`wityu-20260715-pinfoto-lockwarn.apk`** (hotfix acima) + API redeployada (canal `wityu_sos_v2` no ar,
health 200). Contém TODA a 6ª rodada: foto no pin, tracking em background endurecido, e os itens de
SOS/antifurto abaixo. Pedidos do fundador na mesma rodada:
1. **Título "SOS" removido** da tela (redundante com a tab bar + botão gigante) — `app/(tabs)/sos.tsx`.
2. **Vibração de atenção nos membros ao receber SOS** (estilo Uber "motorista chegando"):
   - App aberto: evento realtime `SosTriggered` agora dispara `Vibration.vibrate` com padrão longo
     (`useRealtimeSync.ts`).
   - App fechado: novo canal de notificação **`wityu_sos_v2`** com `vibrationPattern` longo + MAX +
     bypassDnd (`pushService.ts`) e `fcm.ts` (API) passa a enviar `channel_id: wityu_sos_v2`. Canal novo
     porque **canais Android são imutáveis** depois de criados — não dá pra editar o `wityu_sos` antigo
     (que fica registrado pra compatibilidade com a API antiga até o redeploy). ⚠️ **Redeploy da API deve
     sair junto com o APK novo** — se sair antes, os aparelhos com APK antigo recebem o push SOS no canal
     fallback (sem vibração forte/MAX).
3. **Modo Guarda — trava REAL da tela pós-arrancada** (Fase 2 do docs/antifurto.md, sem Device Admin):
   - `AppBlockAccessibilityService` agora guarda a instância viva (companion) e o `AppBlockModule` expõe
     `lockScreen()`/`canLockScreen()` via `performGlobalAction(GLOBAL_ACTION_LOCK_SCREEN)` (API 28+).
     Ladrão só desbloqueia com a digital/PIN do dono — apps bancários inacessíveis.
   - `AntifurtoAlarmOverlay`: sessão de áudio em **background** (`setAudioModeAsync
     shouldPlayInBackground` — plugin do expo-audio já registra o media-playback FGS) ANTES de tocar a
     sirene, e trava a tela ~1,2s após o disparo (só no caminho da arrancada — `lockOnActivate`; o hold
     manual nunca tranca o dono). **Sem** `setActiveForLockScreen` de propósito: os controles de mídia na
     lockscreen dariam um botão de pausa ao ladrão. A sirene segue tocando atrás da lockscreen; o dono
     desbloqueia e desativa com o PIN do WardYou no overlay.
   - Ao armar o Modo Guarda sem o serviço de acessibilidade ativo, um Alert oferece ativar
     (`antifurto.lockPrompt*`, i18n ×4) — arma mesmo sem, só sem a trava.
   - Limites honestos: ladrão ainda pode desligar o aparelho ou abaixar o volume físico; sirene em
     background pode ser suspensa pelo OS após ~3min (limitação documentada do expo-audio sem lockscreen
     controls) — o SOS já saiu nesse ponto.

## ✅ Bugs de device (6ª rodada, 2026-07-15) — foto branca no pin + tracking morrendo ao fechar o app
Reportados pelo fundador em aparelho real (viagem "Dubai" com 2 membros). **Requer APK novo** (adicionou
`expo-battery` + `expo-intent-launcher` + permissão no manifest), mas o build fica pra depois — há mais
bugs a corrigir nesta rodada antes de gerar.
1. **Foto do perfil em BRANCO no pin do mapa** (chips embaixo mostravam a foto; o pin não). Causa raiz
   encontrada no código nativo do react-native-maps 1.27.2 (Fabric/New Architecture): o marker só
   re-rasteriza a view filha quando uma *prop do Marker* muda (contador nativo `updated`); o load
   assíncrono da foto (Fresco) nunca bumpa esse contador, então o bitmap fica congelado no círculo
   branco capturado antes do decode — e o toggle de `tracksViewChanges` não força recaptura (o tracker
   nativo se auto-desarma com `updated == 0` sem avisar o JS; re-armar true→true nem gera chamada
   nativa). **Fix (`AvatarMarker.native.tsx`)**: comando imperativo `Marker.redraw()` (recaptura
   incondicional do bitmap) disparado em 0/250/900ms após `onLoad` da foto e após qualquer mudança
   visível (coordenada, ring), + `fadeDuration={0}` na `Image` do pin (`MapAvatarMarker.tsx`) pra não
   congelar a foto no meio do fade de 300ms do Android. Iniciais continuam como fallback.
2. **Tatiane parava de enviar localização ao fechar o app** (com "Permitir o tempo todo" concedido).
   Três correções em camadas:
   - **Kill-switch real no cold start** (`useTripLocationBroadcast.ts`): com a query de viagens ainda
     pendente, `trips` era `[]` e o efeito chamava `stopTripLocationTracking()` — matando o foreground
     service legítimo da sessão anterior a CADA abertura do app; se a query falhasse (rede) ou o app
     fosse fechado antes dela resolver, o tracking morria de vez. Agora o efeito só age quando
     `tripsQuery.isSuccess` (estado *conhecido*).
   - **`Accuracy.Balanced` → `Accuracy.High`** (`tripLocationTracking.native.ts`): fixes "balanced" são
     throttled/pulados sob Doze em vários OEMs com a tela desligada; prioridade alta mantém o pipeline
     de GPS ativo pro foreground service (custo de bateria limitado à duração da viagem).
   - **Isenção de otimização de bateria**: OEMs agressivos (Xiaomi/MIUI etc.) matam o foreground service
     de apps otimizados ao deslizar o app pra fora dos recentes. Ao iniciar tracking, o app agora checa
     `Battery.isBatteryOptimizationEnabledAsync()` e mostra (1x por install) o diálogo do sistema
     `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` via `expo-intent-launcher`. Permissão adicionada em
     `app.config.ts` (`android.permissions`) e no `AndroidManifest.xml` já gerado.
   - **Ressalva que continua**: em MIUI, "Início automático" (autostart) é um toggle separado que não dá
     pra pedir via API — se o aparelho da Tatiane for Xiaomi, ativar manualmente em
     Configurações → Apps → WardYou → Início automático.

## ✅ Correções de UI pró-Play-Store (5ª rodada, 2026-07-10) — 4 bugs de device, todos verificados
Reportados pelo fundador testando no celular; todos corrigidos **na raiz do componente compartilhado**
(não remendo por tela) e confirmados no emulador em pt:
1. **Splash com tema de cor errado** → `app.config.ts` splash `backgroundColor` `#0B1F33` (navy) →
   `#F4F7F8` (token `background`), pra fluir sem "salto" pra primeira tela. Requereu `expo prebuild`
   (regenera `colors.xml` `splashscreen_background`). Launcher icon segue navy de propósito.
2. **Botão "Entrar com código" (trajetos) estourando** → causa: botão de altura fixa (`h-12`) com texto
   longo quebrando em 2 linhas e vazando. Fix: (a) `Button` agora `numberOfLines={1}` (previne a classe
   inteira do bug); (b) os dois botões de trajeto empilhados full-width em vez de lado-a-lado (robusto
   pra pt/es/fr — labels longos sempre cabem). `app/(tabs)/trips.tsx`.
3. **Botão Cancelar do bottom-sheet cortado (Acompanhamento rápido e outros)** → causa: modais usavam
   `pb-8` fixo sem safe-area, a barra de gestos cobria o último botão. Fix: `useSafeAreaInsets().bottom`
   no padding inferior de **todos** os bottom-sheets: `CreateTripModal`, `InputModal`, `RoleSelectModal`,
   `Select`. Também trocado `bg-black/40` → token `bg-overlay` nesses + `ChildHome` (consistência).
4. **Botão SOS precisava clicar mais abaixo + tamanho diferente** → causa: `-mt-6` levantava o círculo,
   mas no Android a área tocável não sobe junto (o próprio comentário admitia). Fix: SOS virou um item
   normal da barra (`BottomNav.tsx`) — mesmo tamanho de ícone/toque dos outros, só tint vermelho pra se
   destacar. Área de toque = área visível, resolvido de vez.

**Checklist de prontidão pra Play Store** criado em `docs/ARQUITETURA-AGENTES.md §8` (safe-areas, área de
toque = visível, texto em botão de altura fixa, tokens de cor, transições de tema, estados de erro) — a
lição de por que esses passaram: QA anterior testava *fluxos*, não *pixel-perfeição em device*.

## QA no emulador Android (2026-07-10, 1ª rodada real via adb)
Login → onboarding (papel tutor) → Home → Settings → Consent center → Notifications → Privacy & data →
Family (criar família) → Trips → Parental control, tudo dirigido via `adb shell input tap/text` +
`adb exec-out screencap`, conta de teste `qa-tutor@test.local` (limpa ao final via `delete-users.mjs`).
- **✅ Confirmado funcionando**: login (a API está saudável; a latência do emulador é alta, ~500ms de RTT
  — dar uns bons 10-15s antes de concluir "travou"), fix do card de perfil (navega), fix do card Premium
  ("Coming soon"), toggle de consentimento (Share location → muda estado real no backend e reflete na
  Home), registro de push token (Notifications on = ✅ após conceder), export de dados (abre o Share sheet
  nativo com o JSON real), criar família (fluxo completo, Home reflete "1 membro compartilhando" depois).
- **🐛 Bug real encontrado e CORRIGIDO**: `profile.tsx` usa `t(\`profile.roles.${appProfile}\`)`, mas os 4
  locales só tinham `child/elder/guardian/member` — faltavam `onboarding` e `pending` (2 estados legítimos
  e testados de `deriveAppProfile`, ver `apps/api/src/services/profileService.ts`). Qualquer conta nova
  (ou com convite pendente) via a chave crua `profile.roles.onboarding` no próprio perfil. Corrigido nos
  4 idiomas.
- **Nota de processo pro `qa-device`**: cuidado ao converter coordenada de screenshot pra `adb tap` — a
  imagem exibida vem em 900×2000 mas o device é 1080×2400 (fator **1.2**); esquecer de multiplicar faz o
  toque cair no elemento errado (aconteceu 3x nesta rodada — pareceu "botão não responde" quando na
  verdade era erro de coordenada).
- **Ainda não coberto** (nesta 1ª parte): SOS de verdade (só a tela, não o hold-to-trigger), Google
  Sign-In nativo. **Cobertos na 3ª/4ª parte abaixo**: child real, SOS hold real, modo viajante.

## 🔴 SOS — hold-to-trigger e "Send location" (3ª rodada de QA, 2026-07-10)
Testei o botão físico "HOLD FOR SOS" de verdade — não um tap, um **hold simulado via
`adb shell input swipe X Y X Y <duração>`** (mesmo ponto, sem deslocamento) já que o componente
(`HoldButton.tsx`) exige 1500ms de pressão contínua via Reanimated. Descobertas:
- **✅ O hold funciona corretamente** (confirmei via bounds exatos do `uiautomator dump` — sem erro de
  coordenada) e o endpoint `POST /api/v1/sos` funciona perfeitamente.
- **✅ Sem "Send location": 100% confiável.** Segurar o botão sempre criou o evento, mostrou "SOS active"
  + "Emergency alert sent to your family" + botão "Cancel SOS" funcionando.
- **🔴 Com "Send location" ligado: falha de forma reproduzível** (~15-20s depois, "Couldn't send the
  alert. Please try again."). Isolei a causa: `fireSos()` chama `getCurrentPosition()` antes de disparar
  o SOS, e essa chamada trava/falha. **Não é falta de permissão** — confirmei via
  `dumpsys package com.wityu.app` que `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` e
  `ACCESS_BACKGROUND_LOCATION` estão `granted=true`. Mesmo configurando um GPS falso no emulador
  (`adb emu geo fix`), a captura continuou falhando — **pode ser limitação de GPS simulado do emulador
  (precisa validar em aparelho real)**, mas se reproduzir em device real, é um bug sério: o SOS com
  localização (o caso de uso mais importante) fica bloqueado esperando um GPS fix que talvez nunca chegue,
  ao invés de ter um timeout curto e degradar com gracia (mandar sem localização em vez de falhar tudo).
  **Recomendação** (`native-enforcement`/`backend-api`, não aplicada): usar `maximumAge`+timeout curto em
  `getCurrentPositionAsync`, e se falhar, mandar o SOS mesmo assim sem coordenadas (nunca bloquear o
  alerta de emergência por causa do GPS).

## ✅ Modo viajante — rastreamento em background (CORRIGIDO 2026-07-11)
**Causa raiz confirmada em aparelho real (fundador + 2º viajante):** funcionava com o app aberto, mas ao
**fechar o app** o viajante aparecia **offline** para os demais — mesmo com o Android autorizado a
"Permitir sempre". O culpado é exatamente o suspeito da QA abaixo: `distanceInterval: 20` em
`startLocationUpdatesAsync`. Isso é um **filtro de deslocamento**, não um heartbeat — um aparelho parado
(no bolso, app fechado) não gera **nenhum** fix, então a janela de frescor do servidor expira e os
companheiros veem "offline" embora o serviço esteja vivo e o compartilhamento autorizado.
**Correções (`tripLocationTracking.native.ts` + `routes/trips.ts`):**
- `distanceInterval: 0` + `timeInterval: 45_000` + `deferredUpdatesInterval: 0` → heartbeat por **tempo**
  (entrega imediata, sem batching em background), mantendo o viajante online mesmo parado.
- `ONLINE_WINDOW_MS` 5min → **10min** no servidor, pra tolerar o throttling agressivo de OEMs (MIUI/EMUI)
  no background. O "Visto às HH:MM" continua sempre visível, então staleness real fica evidente.
- **Ainda depende do usuário em OEMs agressivos (Xiaomi/MIUI):** se o SO **matar** o foreground service ao
  remover dos recentes, nenhum ajuste de código revive o processo — precisa de **autostart + desativar
  otimização de bateria** pro WardYou no aparelho. (Candidato a follow-up: nudge in-app / exceção de bateria.)

### ✅ Foto do perfil no mapa (mesma rodada, 2026-07-11)
O pin do mapa já mostrava a foto; faltava consistência e uma forma de **definir** a foto. Agora:
- **Foto exibida em todo lugar** do modo trajeto: pin (já ok), **chips do mapa** e **lista de membros**
  do detalhe da viagem (antes só iniciais). Cai pra iniciais quando não há foto.
- **Definir foto no perfil**: `app/profile.tsx` avatar clicável (badge de câmera) → `expo-image-picker`
  + `expo-image-manipulator` reduz pra 256px JPEG e envia como **data URI** (sem blob storage) via novo
  `PUT /api/v1/profile/me/avatar` (`profileService.updateMyAvatar`, cap ~400KB). Foto do Google continua
  entrando automática no primeiro login (`findOrCreateExternalUser`), sem sobrescrever foto manual.
- **Requer APK novo**: adicionou módulos nativos (`expo-image-picker/manipulator`) + plugin → `expo
  prebuild` + gradle. A mudança de background location e o endpoint de avatar também exigem redeploy da API.

### (histórico) 4ª rodada de QA, 2026-07-10
Pergunta do fundador: "com o WardYou fechado, ainda envia localização?" Testei via "Quick tracking" (Trips):
iniciei o rastreamento, **confirmei a notificação real do foreground service** ("WardYou — Shared trip
active — Sharing your location with the trip group") na bandeja, pressionei **Home** (não force-stop) e
aguardei ~100s monitorando `GET /api/v1/travels/:id/map`.
- **✅ A infraestrutura de background funciona**: o log confirma
  `TaskService: Registered task 'wityu-trip-location-broadcast'` e o serviço em primeiro plano
  sobrevive ao backgrounding (notificação persistente confirmada).
- **🔴 Mas a localização nunca chegou.** O log mostra a tarefa disparando **uma única vez**, exatamente no
  momento em que a viagem começou — e nunca mais, mesmo simulando "movimento" (múltiplos
  `adb emu geo fix` com coordenadas ligeiramente diferentes a cada ~20s). `latitude`/`longitude`
  continuaram `null` na API o tempo todo.
- **Mesma ressalva do SOS**: pode ser o emulador não gerando atualizações periódicas de GPS simulado
  (comum — `geo fix` às vezes só entrega UM fix por chamada, diferente de um GPS real que amostra
  continuamente). **Precisa validação em aparelho real andando de verdade** para confirmar se é limitação
  do emulador ou um bug real do `expo-location`/`startLocationUpdatesAsync` (`timeInterval: 30_000`,
  `distanceInterval: 20` em `tripLocationTracking.native.ts`) parando de reportar após o primeiro tick.
- **Como o fundador valida em device real**: iniciar "Quick tracking", fechar o app (Home, não
  "remover dos recentes" — teste esse caso também separadamente, já que `onTaskRemoved` pode se comportar
  diferente), andar/dirigir por alguns minutos, e checar no mapa da viagem (por outro membro, ou o próprio
  "Trip map") se a posição atualiza ao longo do tempo.

## 🔴 Achado crítico (2ª parte da rodada de QA) — candidato a causa raiz do bug #1
Criei conta guardian + child de verdade via API (família, convite, aprovação com `role=child` — confirmado
`appProfile: "child"` no servidor), logei como a criança no emulador: **`ChildHome` renderiza certo**
("Screen time today", "Earn more time", nav de 4 abas), e o card **"Turn on full protection" não faz
nada** ao tocar — sem crash, sem log, `topResumedActivity` confirmado via `dumpsys` continua
`com.wityu.app/.MainActivity` (a tela de Accessibility do Android nunca abre). Isolei que:
- O toque acerta o botão exatamente (bounds via `uiautomator dump`: `[46,349][1034,568]`, centro
  `(540,458)` — bati nesse ponto).
- O app **não travou** (naveguei pra outra aba depois, funcionou normal).
- O mesmíssimo intent (`android.settings.ACCESSIBILITY_SETTINGS`) **abre perfeitamente** via
  `adb shell am start` direto (bypassa o app).
- **Hipótese forte**: Android 13+ tem a proteção **"Restricted settings"**, que bloqueia silenciosamente
  o atalho direto pra tela de Accessibility/Notification Listener quando o app foi **instalado via
  sideload** (exatamente como o app é instalado hoje — `adb install` / APK baixado do Blob, não Play
  Store). Não achei log confirmando 100% (pode ser silencioso por design), mas o padrão de sintoma bate
  exatamente com esse mecanismo documentado do Android.
- **Se confirmado, isso explica o bug #1 inteiro**: a lógica de bloqueio (`AppBlockAccessibilityService`)
  pode estar 100% correta, mas **ninguém nunca consegue ativar a permissão de Accessibility pelo botão do
  app** — o usuário precisaria descobrir sozinho o caminho manual (Ajustes → Apps → WardYou → menu de 3
  pontos → "Permitir configurações restritas" → só then Ajustes → Acessibilidade). Isso é péssima UX e
  provavelmente a razão de "a proteção não funciona" nunca ter sido validada com sucesso em campo.
- **Verificação que só o fundador pode fazer no aparelho real**: abrir Ajustes Android → Apps → WardYou →
  procurar um aviso "Configurações restritas" ou o menu de 3 pontos com "Permitir configurações
  restritas". Se existir, confirma a hipótese.
- **Correção recomendada** (`native-enforcement`, não aplicada ainda — precisa decisão/teste): (1)
  envolver `openAccessibilitySettings`/`openUsageAccessSettings` em try/catch no Kotlin + logar a falha;
  (2) se a tela não abrir, mostrar um modal com o passo a passo manual (Ajustes → Apps → WardYou → permitir
  configurações restritas → Acessibilidade) em vez de falhar em silêncio; (3) considerar publicar na Play
  Store (mesmo em teste fechado) pra remover a flag de "sideload" e destravar o atalho direto — allowlist
  de sideload não é flexível o bastante pra um app de segurança familiar.

Reconstrução do **WardYou** (segurança/proteção familiar) em **React Native + Expo**, descartando o cliente
MAUI e **mantendo o Postgres de produção no Azure** (schema introspectado, a API **não roda migrations**).
Monorepo npm workspaces: `apps/mobile` (Expo SDK 56) + `apps/api` (Node/Fastify/Prisma — "Caminho B").
API em produção: **`https://wityu-api-96164.azurewebsites.net`**. Gate automatizado: `tsc` + `node --test`
(CI em `.github/workflows/ci.yml`). Detalhes de arquitetura no `CLAUDE.md`; domínio auditado no `SCAN_MAUI.md`.

O que está **pronto e validado** (não mexer sem motivo): auth (PBKDF2 compatível com .NET), família/convites/
aprovação, consentimentos + gating do mapa, localização/mapa, zonas, **controle parental** (policy/apps/
schedules/uso/sites/pausa/tarefas), **elder** (medicação + check-in diário), devices, auditoria/privacidade,
realtime (Socket.IO), trajetos + mapa ao vivo, onboarding por perfil (tutor/criança/idoso/viajante) +
pending-approval, antifurto Fase 1, **push FCM** e **AccessibilityService** (código; ver ressalvas abaixo).

---

## Modo criança — modelo FIREWALL / default-deny (completo; só falta validar em device)

**Modelo (2026-07-10, estilo Kids360):** tudo **bloqueado por padrão**; o responsável **libera** só os apps
que quiser, com **tempo por app** opcional. `computeEnforcementState({firewall:true})` → `blockAll=true` de
base + whitelist = apps liberados (`isWhitelisted`) que ainda não estouraram o `dailyLimitMinutes` (usa
`usageByPackage` real). O `AccessibilityService` chuta pra Home qualquer app fora da whitelist. **Ícones NÃO
somem** (impossível pra app não-launcher/não-device-owner) — mas o app abre e volta pra Home no ato = inutilizável.
- **Native seguro (crítico):** o service SEMPRE permite launcher + dialer + Settings + systemui + WardYou
  (`essentialAllow()` resolve via PackageManager) — senão o "mandar pra Home" faria loop infinito e travaria o telefone.
  **Fix 2026-07-10 (2ª rodada):** o Settings nunca era de fato resolvido/adicionado (só o comentário prometia) —
  em modo firewall, abrir Configurações no aparelho da criança seria chutado pra Home, impedindo corrigir
  permissões depois de ativar a proteção. Corrigido via `Intent(Settings.ACTION_SETTINGS)`, mesmo padrão
  robusto (a fabricante) já usado pro launcher/dialer.
- **Lista de apps exata:** o device da criança reporta os apps instalados (`getInstalledAppsJson` via
  `queryIntentActivities LAUNCHER`, precisa `QUERY_ALL_PACKAGES`) → `POST /parental/my-apps` faz upsert de
  `app_rules` (cria os que faltam como NÃO-liberados, sem clobbering do que o pai já configurou). Roda 1x ao abrir o ChildHome.
- **Tela do tutor** (`app/parental/[childUserId]/apps.tsx`): agora é **allowlist** — grupos "Liberados"/"Bloqueados",
  toggle = permitir, tocar num liberado define o tempo/dia. `AppRuleInput` ganhou `isWhitelisted`+`dailyLimitMinutes`.

**Já verificado antes (segue valendo):** ✅ criança online (heartbeat), ✅ política nasce enabled, ✅ localização
auto-liberada ao aprovar, ✅ UsageStats reporta uso real (limite diário global também enforça). Testes: 16/16.

**Só falta (device-only, VOCÊ valida):** ⬜ o **kick-out real** num aparelho (firewall bloqueando tudo menos o
liberado, essentials continuando usáveis, sem loop) — lógica compila + manifest ok, mas nunca bloqueou de fato
aqui; ⬜ `getInstalledApps`/`UsageStats` lendo certo (precisam das permissões concedidas); ⬜ sensibilidade do
antifurto; ⬜ dependentes aprovados ANTES de 2026-07-10 → reaprovar pro auto-consent de localização.

Arquivos: `apps/mobile/modules/app-block/` (nativo: Accessibility + UsageStats + InstalledApps + launcher-safe),
`apps/mobile/src/features/parental/{enforcement,enforcementLogic}.ts`, `.../home/ChildHome.tsx`,
`app/parental/[childUserId]/apps.tsx`, `apps/api/src/services/parentalService.ts` (`reportInstalledApps`).

## Leitura de interface Kids360 → WardYou (2026-07-10, 3ª rodada)
- **Artefato**: comparação visual de 9 padrões (onboarding emocional, priming de permissão, mapa em
  cartões flutuantes, disciplina de cor semântica, tarefas gamificadas, modais bottom-sheet, seletor
  tátil de horário, selo de autoridade honesto, upsell espalhado) com evidência real das 32 telas do
  Kids360 em `kids360/` + oportunidade concreta pro WardYou, dono e prioridade cada um. Link só nesta
  sessão (artifact privado) — regenerar via mesmo prompt se precisar do link de novo.
- **✅ CORRIGIDO — cor de marca não batia com a logo real.** `tokens.js` usava um teal (`brand.500 =
  #0D5C63`) só, enquanto a logo/ícone reais (`Image/wardyou-logo.png`, `WardYou-icon.png`, e o próprio
  `assets/android-icon-foreground.png` já shipado) são azul. Amostrado por pixel do ícone real:
  `#1875BE` (azul principal) + `#77CCDE` (azul claro secundário) — não chutado. Nova escala `brand`
  em `tokens.js` construída sobre esses 2 valores reais; `Button.tsx` (ghost variant) e o
  `expo-notifications` color em `app.config.ts` também trocados; `expo prebuild` rerodado (regenera
  `android/.../colors.xml` com `notification_icon_color` novo — o pin de CMake 3.30.5 sobrevive, como
  esperado). O SVG do logo (`src/assets/brand-logos.ts`, já usado em `Logo` nas telas de auth/onboarding)
  **já estava com as cores certas** — o descompasso era só na paleta de UI (botões/navegação/estado ativo),
  não no logo em si.

## Time de agentes & estratégia (2026-07-10, 2 rodadas)
- **[docs/ARQUITETURA-AGENTES.md](docs/ARQUITETURA-AGENTES.md)**: doc mestre com missão "estado da arte",
  análise competitiva **pesquisada de verdade** (Kids360, Qustodio, Bark, Family Link, Life360), o time de
  8 agentes especialistas (`.claude/agents/`), o triage dos bugs de campo → dono, e o roadmap priorizado.
- **Bug #2 (criar tarefa não notificava a criança) — CORRIGIDO e deployado em prod.** `createTask` agora
  emite realtime `TaskCreated` + push "Nova tarefa 🎯"; cliente invalida `my-tasks` ao vivo + toque na
  notificação abre `/tasks`.
- **Bug #3 (push de aprovação não chega ao pai) — caminho de código verificado ÍNTEGRO** ponta a ponta.
  Causa provável = runtime: em `pushService.ts:24` (mobile), permissão de notificação não `granted` →
  token vira null silencioso, sem push e sem aviso na UI (Android 13+ exige `POST_NOTIFICATIONS` runtime).
  Verificar no banco se `devices` do pai tem `PushToken` não-nulo.
- **Bug #1 (proteção do modo criança) — 1 fix real aplicado** (Settings essentials, ver acima) + 1 gap de
  design documentado (não corrigido, decisão de produto): em modo firewall, os block-schedules por
  categoria (Jogos/Social/Vídeo) não afetam apps já na whitelist — a whitelist ignora o agendamento.
  Ainda falta validar o kick-out real em aparelho.
- **Bug #4 (errinhos de front) — auditoria completa rodada, 10 achados priorizados, os de severidade alta
  corrigidos:** card de perfil em Settings sem `onPress` (agora navega pra `/profile`); card "Premium" sem
  `onPress` (agora mostra alerta "Em breve" com as chaves i18n que já existiam prontas); chave `common.back`
  usada mas inexistente nos locales (adicionada nos 4 idiomas); export de dados no **web** só fazia
  `console.log` em vez de entregar o arquivo (agora baixa um `.json` de verdade via Blob); `accessibilityLabel`
  ausente em ~10 botões de ação destrutiva (excluir/aprovar/rejeitar/adicionar) em `parental/`, `family.tsx`,
  `elder/[elderUserId].tsx`, `zones/index.tsx`.
  **Achado sistêmico NÃO corrigido (precisa de decisão de design, não é fix pontual):** nenhuma tela trata
  `isError` do TanStack Query — quando uma query falha após as 2 tentativas, o `ActivityIndicator` **gira
  para sempre** sem mensagem de erro nem retry, em praticamente todas as telas com dado remoto. É o
  próximo item de maior prioridade do `mobile-ui`.
  Achados de baixa severidade (documentados, não corrigidos: token `overlay` do design system nunca usado,
  `color="#FFFFFF"` hardcoded em ~9 lugares em vez do token semântico, placeholders não traduzidos,
  flash de lista vazia antes do carregamento) — ver histórico do agente para a lista completa.

## ⬜ Outras pendências de produto
- **Pagamentos/assinaturas** (card "Premium" é placeholder) — escolher Stripe/RevenueCat + contas de loja. Decisão sua.
- **Legal/LGPD** — `docs/PRIVACY.md`/`TERMS.md` são rascunhos, precisam de revisão jurídica.
- **Antifurto Fase 2** (nativo) — Device Admin `lockNow()` + foreground service p/ monitorar em background. Não iniciado.
- **Deep links** — falta hospedar `apple-app-site-association` + `assetlinks.json` em `app.wityu.com`.
- **`family_elder_settings`** — toggles nunca expostos na UI (não gatilham nada ainda; evitar UI morta).
- **Manutenção do banco** — trajetos vencidos + extra-time já fecham lazy-on-read; `remote_commands` (que o
  worker .NET expirava) **não é usado no stack Node** → não há o que manter. Item efetivamente fechado.

## ⚠️ Segurança / infra
- **Firewall `AllowAzureServices` (0.0.0.0)** no Postgres `mvp-sf-pg-96164`: os 19 IPs de saída do App Service
  já estão liberados (`webapp-outbound-1..19`), mas a remoção da regra ampla + da `claude-introspect` **o usuário
  optou por manter por enquanto** (2026-07-09). Pra endurecer: remover as duas quando quiser.
- **Dev local fala direto com o banco de PRODUÇÃO** (`apps/api/.env`) — cuidado com escritas; ideal um staging.
- **Google OAuth** funciona mas em modo **Testing** (só *test users*) — publicar o consent screen pra liberar geral.
  Google sign-in **nativo** (client ids iOS/Android) e Facebook seguem não feitos.
- **Maps key web/iOS** ainda na chave legada (Android resolvido); rotacionar a legada.
- **`npm audit`**: sobra vulnerabilidade **moderada** só de ferramenta de build (`uuid`/`@expo/config-plugins`) —
  risco aceito (`audit fix --force` rebaixaria o Expo). O CVE crítico do `fast-jwt` já foi corrigido.

---

## Runbooks

### Deploy da API (autorização durável pra redeployar após mudança de backend)
```bash
# da raiz do repo. az.cmd: C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd (mudou de "(x86)" p/ Program Files em 2026-07; fora do PATH do Git Bash)
az acr build --no-logs -r wityuacr96164 -t wityu-api:latest -f apps/api/Dockerfile . \
  && az webapp restart -n wityu-api-96164 -g mvp-sf   # re-puxa :latest; swap ~45-60s
```
- ✅ **USE `--no-logs`** (confirmado 2026-07-12): sem ele o `az acr build` **crasha ao streamar o log**
  (`UnicodeEncodeError` do `✔` do `tsc` no console cp1252/cp850 do Windows) e **sai com exit 1 mesmo tendo
  publicado a imagem** — o que quebra qualquer `&& restart` e mascara o resultado real. `PYTHONIOENCODING=utf-8`
  **não resolve** (o env não chega no python do `az.cmd`). Com `--no-logs` o comando espera o build, pula o
  stream e retorna o **exit status real** — então `&& az webapp restart` só roda se o build realmente terminou.
- ⚠️ Se por algum motivo streamar sem `--no-logs`: `az acr task list-runs --top 1` pode mostrar "Succeeded" do
  run ANTERIOR se o novo não terminou — **esperar a conclusão** antes de reiniciar, senão serve imagem VELHA.
  `health:200` não garante swap concluído.
- ⚠️ comandos `az` com path com espaços quebram no Git Bash às vezes → usar **PowerShell** (`& "…\az.cmd" …`).
  App settings com valor contendo `()`/`;` (ex.: Key Vault reference) → passar via `--settings @arquivo.json`.

### APK Android (local, sem EAS)
```bash
cd apps/mobile && npx expo prebuild --platform android --no-install   # SÓ se mudou algo nativo (novo pacote nativo)
cd android && ./gradlew.bat :app:assembleRelease -PreactNativeArchitectures=arm64-v8a --no-daemon
# → app/build/outputs/apk/release/app-release.apk (~55MB, arm64, debug keystore)
```
- Rebuild **só-JS** (sem pacote nativo novo) dispensa o prebuild — só `assembleRelease`.
- ⚠️ **Mas `android/` e gerado e gitignored**: qualquer coisa de `app.config.ts` que vira recurso nativo
  (`name` → `strings.xml` `app_name`, scheme/host do manifest, icones) **so muda com `prebuild`**. Pego em
  2026-08-29: rebuild so-JS pos-rename saiu com `application-label:'Wityu'` no launcher. Conferir sempre com
  `aapt dump badging app-release.apk | grep application-label` antes de distribuir.
- **Fix Windows MAX_PATH (obrigatório, New Arch)**: `LongPathsEnabled=1` no registro (admin) **+** CMake `3.30.5`
  pinado em `apps/mobile/android/app/build.gradle`. Após prebuild, apagar `android/app/.cxx`. O pin sobrevive ao prebuild.
- **Distribuição**: Blob `mvpsfapk80840`/container `apk` (`allowBlobPublicAccess=false` → gerar SAS read-only de 7 dias).
  Convenção: `wityu-<YYYYMMDD>-<label>.apk` + sobrescrever `wityu-latest.apk`. Upload via `--account-key`.
- Toolchain portátil em `C:\Android` (JDK17, SDK 35, NDK 27, CMake 3.30.5); `JAVA_HOME=C:\Android\jdk17`, `ANDROID_HOME=C:\Android`.

### Push FCM — LIGADO e verificado em prod (2026-07-10)
- Servidor: `apps/api/src/lib/fcm.ts` (FCM HTTP v1 via `google-auth-library`, lê `FCM_SERVICE_ACCOUNT_JSON`) +
  `services/pushService.ts`. Dispara em join/aprovação/SOS/extra-time/tarefas (junto do realtime).
- Cliente: token **FCM cru** (`getDevicePushTokenAsync`), `usePushRegistration` no AuthGate.
- Credencial: Web App tem managed identity (`3847a63f-…`) com role **Key Vault Secrets User** em `wityu-kv-mvpsf`;
  app setting `FCM_SERVICE_ACCOUNT_JSON=@Microsoft.KeyVault(...SecretName=Fcm--ServiceAccountJson)`.
- **Verificar sem device**: registrar um device com token FCM falso, disparar um push, checar no banco se o
  `PushToken` virou NULL (só limpa se o envio FCM rodou e o Google rejeitou o token).

### e2e / limpeza de dados de teste
- Contas de teste usam sufixo `@test.local`. Limpar sempre com `node --env-file=.env scripts/cleanup-e2e-users.mjs`
  (rodar de `apps/api`). Scripts de e2e: `apps/api/scripts/e2e-{trips,kids}.mjs`.

## Conexões
- `apps/mobile/.env`: `EXPO_PUBLIC_API_BASE_URL` → Azure; `USE_MOCKS=false`; Maps key (legada); Google OAuth client id.
- `apps/api/.env`: `DATABASE_URL` (Postgres prod `safefamily` @ `mvp-sf-pg-96164`); `JWT_*`; Google OAuth id+secret.
- `apps/mobile/google-services.json` (FCM, projeto `wityu-499413`); Google OAuth web client `321122338266-je530…`.

## Notas técnicas (não regredir)
- `react` e `react-dom` **exatamente a mesma versão** (senão o web quebra).
- Tailwind `darkMode: "class"` obrigatório (NativeWind web); `.npmrc` com `legacy-peer-deps=true`.
- Reanimated 4 usa `react-native-worklets/plugin` no babel.
- Não rodar `expo export` junto com o dev server. `tsx watch` local quebra (esbuild bloqueado) → usar `tsc` build + `node`.
- Mobile: `*.test.ts` excluídos do `tsconfig.json` (senão `tsc` pede `@types/node` e colide com globais RN/DOM).
