# WardYou — Arquitetura de Time de Agentes & Estratégia "Estado da Arte"

> **Documento mestre.** Define a missão, o time de agentes especialistas (cada um com escopo,
> responsabilidade e fronteiras), o mapa de bugs reportados em campo → dono responsável, e o
> roadmap para superar Kids360 e concorrentes. Mantido pelo **Arquiteto (lead)**.
> Última revisão: 2026-07-10.
>
> Ligado a: [SUMMARY.md](../SUMMARY.md) (o que está feito), [CLAUDE.md](../CLAUDE.md) (como o código
> funciona), [SCAN_MAUI.md](../SCAN_MAUI.md) (domínio herdado). Os agentes vivem em `.claude/agents/`.

---

## 1. Missão

Transformar o **WardYou** na plataforma de segurança/proteção familiar **estado da arte** — superando
Kids360, Qustodio, Bark, Google Family Link e Life360 — através de um **app único com papéis**
(tutor / criança / idoso / viajante), enforcement nativo real, e um ciclo de entrega
rápido (APK → blob → aparelho do fundador → feedback → correção).

O diferencial defensável já existe no produto: **um único app** para pais e filhos (Kids360 exige dois
apps + código de pareamento). A missão do time é tornar cada pilar **melhor** que a categoria, não só
paridade.

### Princípio operacional (como o fundador trabalha)
O fundador gera APK, sobe no blob, instala no telefone e **reporta problemas reais de campo**
("no modo criança a proteção não funciona", "criei tarefa e a criança não recebeu push", "ela
concluiu e eu não recebi pra aprovar", "errinho de front"). O time é otimizado para **fechar esse laço
rápido**: reproduzir → localizar no código → corrigir → reempacotar → validar em aparelho.

---

## 2. Análise competitiva → o que precisamos para o estado da arte

> Tabela atualizada em 2026-07-10 com pesquisa real (`product-intel`) sobre Kids360, Qustodio, Bark,
> Google Family Link e Life360 — não é mais só inferência.

| Pilar | Estado WardYou | Kids360 | Qustodio | Bark | Family Link | Life360 |
|---|---|---|---|---|---|---|
| **Bloqueio de apps** | Firewall default-deny + whitelist + tempo/app (código pronto, kick-out **não validado em device real**) | Bloqueio individual/categoria + "always allowed" | Bloqueio app/categoria multiplataforma | Foco em monitorar, não bloquear | Aprovação obrigatória de instalação + bloqueio total | — |
| **Alerta de app novo instalado** | **Não tem** | **Tem** (feature nomeada, citada na imprensa) | Exige aprovação prévia | — | Bloqueia instalação por padrão | — |
| **Tempo de tela** | Limite diário via UsageStats (enforça) + schedules + sleep | Limites por dia da semana | Limites diários + "Pause internet" 1-clique | — | School Time + Downtime | — |
| **Geofence / zonas** | Zonas existem, **sem push de entrada/saída** | Alerta de chegada em local salvo | "My Places" (plano pago) | — | — | **Place Alerts** ilimitados (maduro) |
| **Relatórios de uso** | UsageStats reporta uso (resumo genérico) | Timeline por app | Dashboard "polido" + monitor de redes sociais/YouTube separado | Feed de alertas, não dashboard | Dashboard com screen time | Driving reports |
| **Monitoramento de mensagens/redes sociais** | **Não tem** | **Não tem** (lacuna admitida) | **Tem** (WhatsApp, Instagram, SMS) | **Tem** — core do produto, 30+ apps | Não | — |
| **IA p/ risco (bullying, autolesão, aliciamento)** | **Não tem** | **Não tem** | **Tem** (SmartAlerts, 20+ categorias) | **Tem** — core do produto | Não | Não |
| **Tarefas & recompensas** | Tarefas → aprovação → crédito de tempo (**push da criação — corrigido nesta rodada**) | Tem (+ 4.400 desafios prontos) | Não é foco | Não | Não | Não |
| **SOS / emergência** | SOS + realtime + contexto | Não | Não | Não | Não | SOS + **Crash Detection automático** (acelerômetro) + despacho real |
| **Idoso / elder care** | Medicação + check-in diário, **sem detecção de queda** | Não tem (100% kids) | Não tem | Não tem | Não tem | Não tem — **WardYou pode liderar aqui** |
| **Antifurto** | Fase 1, sem Device Admin lockNow | Bloqueio de device | Não é foco | Não | Não | **Stolen Phone Protection** com reembolso monetário (monetização) |
| **Onboarding** | App único por papel, sem pairing code (**vantagem mantida**) | 2 apps + pairing code | 1 app, iOS limitado | 2 apps em alguns planos | 1 conta supervisionada | 1 app |
| **Monetização** | Não implementada | Freemium ~US$5-10/mês ou anual | Freemium, só anual, ~US$8/mês | Freemium US$5-14/mês | Grátis | Freemium em camadas |

**Leitura estratégica (atualizada com a pesquisa):** o maior gap estrutural não é feature — é o par
**"IA de risco em mensagens" (Bark/Qustodio)**, onde a categoria toda já avançou e o WardYou ainda não
tem nada. Isso é mais estratégico a médio prazo que paridade de bloqueio. No curto prazo, os itens de
menor esforço/maior visibilidade são **push de geofence** e **alerta de app novo instalado** — ambos
triviais de implementar dado que a infraestrutura (zonas, `reportInstalledApps`) já existe.

### Lista priorizada de features para "estado da arte" (pesquisa `product-intel`, 2026-07-10)
1. **Alertas de IA para risco em mensagens/redes sociais** (bullying, autolesão, aliciamento) — maior
   diferencial estrutural do setor; Bark e Qustodio já transformaram isso no ponto #1 de venda.
2. **Push de entrada/saída de geofence** — todos os concorrentes têm; infra de zonas já existe no WardYou.
3. **Alerta de "novo app instalado"** — complementa o firewall default-deny já existente.
4. **Botão "pausar internet" de 1 toque** — baixo esforço, alto valor percebido (Qustodio tem até no plano grátis).
5. **Antifurto completo** (Device Admin `lockNow`) — Life360 monetiza isso diretamente; Fase 1 já existe.
6. **Detecção de queda para idosos** (acelerômetro, padrão técnico do "Crash Detection" da Life360
   adaptado) — nenhum concorrente cobre elder care; é onde o WardYou pode ser líder de categoria.
7. **Relatórios de uso por categoria** (YouTube/redes sociais isolados) — padrão Qustodio.
8. **Monetização freemium em camadas** — todos os concorrentes usam grátis + 1-2 planos pagos anuais.

---

## 3. O time de agentes

Cada agente é um especialista com escopo fechado, arquivos-âncora e fronteiras explícitas (o que **não**
faz). O **Arquiteto (lead)** — este é o meu papel — orquestra, prioriza o roadmap, faz o triage dos bugs
de campo, delega ao dono certo e mantém `SUMMARY.md` + este documento. Os agentes só são acionados sob
pedido do fundador (não são disparados automaticamente).

| Agente | Especialidade | Dono de |
|---|---|---|
| `backend-api` | API Node/Fastify/Prisma | Endpoints, services, regras de negócio, wiring de push/realtime no servidor |
| `mobile-ui` | RN/Expo, design system, i18n | Telas, navegação, "errinhos de front", 4 idiomas, tokens "Guardião Sereno" |
| `native-enforcement` | Android nativo (Kotlin/Java) | AccessibilityService, UsageStats, app-block, antifurto, Device Admin |
| `push-realtime` | FCM + Socket.IO | Entrega de notificação ponta a ponta, deep links, registro de token |
| `qa-device` | QA / validação em aparelho | Reproduzir bugs de campo, checklist, e2e, testes `node --test` |
| `devops-release` | Deploy & empacotamento | ACR build, webapp restart, build de APK, blob + SAS |
| `security-privacy` | Segurança & LGPD | Auth PBKDF2, gating de consentimento, hardening, privacidade/LGPD |
| `product-intel` | Inteligência competitiva | Análise de concorrentes, roadmap de features, monetização |

### Regras de colaboração
1. **Bug de campo entra pelo Arquiteto** → triage → agente dono (ver §4). Bugs que cruzam camadas
   (ex.: push que não chega) começam pelo `qa-device` (isola a camada) e vão pro dono.
2. **Uma mudança, um dono.** Se toca API + mobile, o Arquiteto sequencia (backend primeiro, contrato
   estável, depois mobile).
3. **Nada regride o que está validado** (ver lista "pronto e validado" no SUMMARY). Auth, gating,
   formatos PBKDF2/refresh-token são **load-bearing** — só o `security-privacy` mexe, com plano.
4. **Toda string de UI em 4 idiomas** (pt/en/es/fr) — invariante do `mobile-ui`.
5. **API não roda migrations** — schema é do banco introspectado. Mudança de schema é decisão do
   `backend-api` + `security-privacy`, nunca `prisma migrate`.
6. **Fechar o laço em aparelho.** Correção de camada nativa/push só é "feita" quando `qa-device`
   define como o fundador valida no telefone.

---

## 4. Triage dos bugs de campo reportados (2026-07-10, atualizado após 2ª rodada)

| # | Sintoma reportado | Diagnóstico (nível de código) | Camada / Dono | Status |
|---|---|---|---|---|
| 1 | "No modo criança a proteção não funciona" | Kick-out nativo nunca validado em device real. **Achado na revisão de código desta rodada**: o comentário do arquivo prometia que "Settings" nunca seria bloqueado, mas o pacote nunca era resolvido/adicionado aos essentials — em modo firewall, abrir Configurações no aparelho da criança seria chutado pra Home, impedindo corrigir permissões depois de ativar o bloqueio. **CORRIGIDO** (resolve via `Intent(Settings.ACTION_SETTINGS)`, mesmo padrão do launcher/dialer, robusto a skins de fabricante). Também documentado um gap de design (não corrigido — decisão de produto): em modo firewall, os block-schedules por categoria (Jogos/Social/Vídeo) **não têm efeito sobre apps já whitelisted** — a whitelist ignora completamente o agendamento de categoria. | Nativo Android / `native-enforcement` | Fix de Settings aplicado + rebuild; **ainda falta validar o kick-out real em aparelho** (`qa-device`) |
| 2 | "Crio tarefa e a criança não recebe push de nova tarefa" | **BUG confirmado**: `createTask` não dispara `emitToUser` nem `pushToUser` (ao contrário de submit/approve) | API / `backend-api` | **CORRIGIDO e deployado em produção** (health-checked) |
| 3 | "Criança conclui e eu não recebo pra aprovar (mas tem pendente)" | Caminho de código **verificado íntegro ponta a ponta** (servidor manda `notification`+`data`+`channel_id`; cliente cria os canais `default`/`wityu_sos` e registra o token). Achado concreto: em `pushService.ts:24` (mobile), se a permissão de notificação não for `granted`, o token vira **null silencioso** — sem push e sem aviso na UI (Android 13+ exige `POST_NOTIFICATIONS` runtime). | Push+Device / `push-realtime` + `qa-device` | **Não é bug de código.** Verificar no banco se `devices` do pai tem `PushToken` não-nulo — se nulo, é permissão negada no aparelho |
| 4 | "Errinhos de front end" | Auditoria de frontend disparada nesta rodada (agente `mobile-ui`, ver §7) | Mobile / `mobile-ui` | Em andamento — achados serão consolidados aqui |

**Ação desta rodada (2ª):** aplicado o fix nativo do #1 (Settings essentials) + rebuild do APK;
auditoria de frontend disparada para o #4; pesquisa de mercado feita para orientar o roadmap;
LGPD/Termos reforçados com achados de concorrentes. Ver §7 para o registro completo.

---

## 5. Roadmap para "estado da arte" (ordem de prioridade)

**Onda 1 — Confiabilidade (destrava a percepção "funciona melhor que Kids360")**
1. Fechar loop de tarefas ponta a ponta (push criação + conclusão + aprovação) — `backend-api` + `push-realtime`.
2. Validar kick-out nativo em aparelho real; garantir essentials sem loop — `native-enforcement` + `qa-device`.
3. Garantir entrega de push em background/app fechado (canais Android, prioridade) — `push-realtime`.

**Onda 2 — Paridade+ com a categoria**
4. Geofence com push de entrada/saída de zona — `backend-api` + `native-enforcement`.
5. Dashboard de uso semanal + alerta de app novo instalado — `mobile-ui` + `backend-api`.
6. Filtro web por categoria + SafeSearch — `native-enforcement`.

**Onda 3 — Diferenciais de estado da arte**
7. Gamificação de tarefas (streaks, metas) — `product-intel` + `mobile-ui`.
8. Elder care: alerta de inatividade / detecção de queda — `native-enforcement` + `backend-api`.
9. Antifurto Fase 2: Device Admin `lockNow` + foreground service — `native-enforcement`.
10. Monetização (Stripe/RevenueCat) + LGPD finalizada — `product-intel` + `security-privacy`.

**Externo (fundador/negócio, fora do código):** Google OAuth público, contas de loja, revisão jurídica
LGPD, chaves de Maps rotacionadas, staging separado da produção.

---

## 6. Como o fundador aciona o time

- **"Reportei um bug X"** → o Arquiteto faz o triage (§4) e chama o dono.
- **"Quero a feature Y do Kids360"** → `product-intel` avalia + o Arquiteto sequencia.
- **"Gera um APK novo"** → `devops-release` empacota + sobe no blob (runbook no SUMMARY).
- **"Isso funciona no aparelho?"** → `qa-device` dá o roteiro de validação.

Os agentes ficam em `.claude/agents/`. Para invocar um explicitamente, o fundador pode pedir pelo nome
(ex.: "usa o native-enforcement pra isso").

---

## 7. Registro de trabalho — 2ª rodada (2026-07-10)

Todos os agentes trabalharam nesta rodada, com resultado concreto (não só análise):

- **`backend-api`**: fix do bug #2 (push de nova tarefa) já deployado em produção (rodada anterior).
- **`product-intel`**: pesquisa real de mercado (WebSearch/WebFetch) em Kids360, Qustodio, Bark, Family
  Link e Life360 — tabela competitiva e lista priorizada em §2 totalmente reescritas com dados concretos
  (não mais só inferência). Maior achado estratégico: **detecção de risco por IA em mensagens/redes
  sociais** é o gap estrutural mais relevante da categoria, à frente de qualquer feature de bloqueio.
- **`security-privacy`**: `docs/PRIVACY.md` e `docs/TERMS.md` reforçados com achados de benchmark (prazos
  de retenção da Bark/Qustodio, consentimento parental verificável, transferência internacional Azure/FCM,
  decisões automatizadas, nota sobre app único incluindo a própria criança como usuária). Continuam
  precisando de revisão jurídica antes de publicar — os `[colchetes]` (CNPJ, DPO) são do fundador.
- **`native-enforcement`**: revisão de código encontrou e corrigiu um bug real (Settings nunca estava nos
  essentials, apesar do comentário prometer isso) + documentou um gap de design (block-schedules por
  categoria ignorados sob whitelist do firewall) para decisão do fundador.
- **`mobile-ui`**: auditoria completa de frontend (i18n, UI morta, design system, loading/erro, navegação,
  acessibilidade) com 10 achados priorizados; os de severidade alta e média de baixo risco foram corrigidos
  nesta mesma rodada (ver SUMMARY.md para a lista). O achado sistêmico (falta de tratamento de `isError` em
  toda tela) foi deliberadamente **não** corrigido às pressas — é um padrão a decidir e aplicar de forma
  consistente, não um remendo por tela.
- **`devops-release`**: APK reempacotado com o fix nativo + todas as correções de frontend, subido ao Blob
  (ver SUMMARY.md para o nome/link mais recente).
- **`qa-device`**: ainda sem trabalho de campo nesta rodada — depende do fundador validar o novo APK no
  aparelho (kick-out do modo firewall, push de aprovação, permissão de notificação).

**Pendências que continuam precisando do fundador:** validar em aparelho real (#1 e #3), decidir o que
fazer com o gap de block-schedule vs. whitelist, decidir prazo de retenção de dados e mecanismo de
consentimento parental para o jurídico revisar, e priorizar qual item da lista de §2 atacar em seguida.

---

## 8. Checklist de prontidão pra Play Store (novo — 2026-07-10, lição da 5ª rodada)

**Por que este checklist existe:** o fundador reportou 4 bugs visuais que eu (Arquiteto) deixei passar —
splash com tema de cor errado, botão "Entrar com código" estourando o campo (texto longo vazando de um
botão de altura fixa), botão Cancelar do bottom-sheet cortado pela barra de gestos, e o botão SOS com a
área de toque deslocada (círculo levantado com `-mt-6` cuja área tocável não sobe junto no Android). **A
lição:** o QA das rodadas anteriores testou *fluxos* ("o botão funciona?"), não *pixel-perfeição em
device real* ("o botão está no lugar certo, cabe, e é tocável onde se vê?"). Antes de qualquer submissão à
loja, `mobile-ui` + `qa-device` rodam este checklist **em aparelho real** (não só emulador — safe-areas e
áreas de toque diferem):

1. **Safe-areas**: todo bottom-sheet/modal com botão no rodapé usa `useSafeAreaInsets().bottom` no padding
   inferior (senão a barra de gestos corta o último botão). Padrão aplicado em `InputModal`, `Select`,
   `CreateTripModal`, `RoleSelectModal`. **Qualquer modal novo deve seguir isso.**
2. **Área de toque = área visível**: nada de `-mt`/overflow que desloque o alvo do que se vê (foi a causa
   do SOS). No Android, filho que transborda o pai não é tocável no transbordo. Alvos ≥ 44dp.
3. **Texto em botão de altura fixa**: `Button` usa `numberOfLines={1}` — texto nunca vaza verticalmente.
   Rótulos que não cabem lado-a-lado → empilhar full-width (foi o fix dos botões de trajeto); testar
   sempre no idioma **mais longo** (FR costuma ser o pior).
4. **Cores do design system**: sem hex hardcoded onde há token (`bg-overlay` em vez de `bg-black/40`,
   `ink-inverse` em vez de `#FFFFFF`); splash/ícone/notificação coerentes com a marca azul.
5. **Transições de tema**: splash → primeira tela sem "salto" de cor (splash agora `#F4F7F8` = `background`).
6. **Estados vazios/erro**: toda tela com dado remoto trata `isError` (pendência sistêmica ainda aberta —
   ver auditoria de frontend no SUMMARY; é o maior débito de polish restante pra loja).
