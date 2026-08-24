# Modo Antifurto (SOS "Detecção de arrancada e corrida") — Design

> Status: **Fase 1 implementada (2026-07-09)** — dissuasor 100% JS/Expo gerenciado,
> sem código nativo. `tsc` limpo; **não validado em device real** (nenhum
> físico/emulador disponível no ambiente onde foi implementado) — a sensibilidade
> do acelerômetro (`THRESHOLD_G` em `useRushDetection.ts`) é um palpite que
> precisa de calibração real antes de confiar nela. Fase 2 (Device Admin +
> foreground service) continua **planejada, nenhuma linha nativa escrita**.
>
> Arquivos: `src/stores/antifurto.ts` (armado/PIN/som, persistido via
> SecureStore), `src/features/sos/useRushDetection.ts` (acelerômetro,
> `expo-sensors`), `src/features/sos/AntifurtoAlarmOverlay.tsx` (tela cheia,
> sirene sintetizada em `assets/sounds/siren.wav` — gerada localmente, sem
> asset de terceiros — `expo-keep-awake`, checagem de rede via `expo-network`,
> saída só com PIN), wired em `app/(tabs)/sos.tsx` ("Modo Guarda" na tela de
> SOS). O botão "segurar" manual e a detecção de arrancada convergem no mesmo
> `fireSos()`; a overlay evita duplicar o POST quando já foi o hold button que
> disparou.

## 1. Problema / história de uso

Cenário de roubo "arrancada e corrida": alguém pega o telefone da mão da vítima e
sai correndo. Queremos que o aparelho, ao detectar esse padrão:

1. **Detecte** o movimento brusco (arrancada) / corrida.
2. **Dificulte o uso** do aparelho pelo ladrão (idealmente travar a tela).
3. **Continue rastreável** (garantir conectividade para reportar posição).
4. **Avise o contato de segurança** com as informações (posição, horário).

O envio ao contato por WhatsApp/SMS é **futuro**; hoje o SOS já notifica a família
em tempo real (SignalR) — ver §5.

## 2. Estado atual da tela de SOS (`app/(tabs)/sos.tsx`)

~~Tudo é UI local, sem efeito~~ — **desatualizado**. Estado em 2026-07-09: o
botão "segurar" já chama o backend de verdade (fix de 2026-07-06), `sendLocation`
e `soundMode` (renomeado internamente para `soundEnabled`, no store
`useAntifurtoStore`) controlam o payload e a sirene, e o "Modo Guarda" (Fase 1
deste documento) foi implementado — ver o bloco de status no topo do arquivo.

O backend **já existe e está pronto**: `POST /api/v1/sos`
(`apps/api/src/routes/sos.ts`), corpo:

```ts
{ familyId?: string, latitude?: number, longitude?: number, sendLocation: boolean }
```

Cria um `sos_events` (Status=Active), opcionalmente um `location_events`
(SourceType=Sos), e emite em tempo real para a família (`emitToFamily`).

## 3. Limites duros da plataforma (Android) — LER ANTES DE PROMETER

Estas são leis da plataforma, não limitações do nosso código:

### 3.1. Ligar a internet móvel: **IMPOSSÍVEL** para um app comum

Desde o Android 5 (Lollipop, 2014), apps de terceiros **não podem ligar/desligar
dados móveis**. `ConnectivityManager.setMobileDataEnabled()` foi removido; exige
`MODIFY_PHONE_STATE` (permissão *signature*/sistema) ou privilégio de operadora.
Um app instalado pela Play Store **não consegue forçar os dados móveis a ligar**.

**O que dá para fazer (substituto viável):**
- **Detectar** o estado de conexão (`expo-network` / `@react-native-community/netinfo`).
- Se estiver offline, **avisar** e **abrir a tela de Ajustes** de dados/rede
  (`Linking.sendIntent`/`startActivity` para `Settings.ACTION_DATA_ROAMING_SETTINGS`
  ou o painel de conectividade). A ação de ligar é **do usuário**.
- Documentar para o usuário, na configuração do recurso, que manter os dados
  ligados é pré-requisito do rastreamento.

### 3.2. Travar a tela "de verdade": exige **Device Admin (código nativo)**

Bloquear como o botão power (exigindo PIN) = `DevicePolicyManager.lockNow()`, que
requer:
- Um **módulo nativo** (não existe no Expo gerenciado; precisa de config plugin +
  build custom — já temos o pipeline de APK local, ver CLAUDE.md).
- O usuário conceder **"Administrador do dispositivo"** (permissão sensível;
  fluxo de consentimento explícito).
- Cuidado com **política da Play Store** (apps com Device Admin passam por revisão
  mais rígida).

**Screen pinning** real (impedir sair do app) = `startLockTask()` só é
irrestrito com **Device Owner** (provisionamento corporativo) — inviável para app
de consumo. Sem isso, o pinning pede confirmação do usuário e é dispensável.

### 3.3. Detecção em background: exige **foreground service (nativo)**

O acelerômetro (`expo-sensors`) roda enquanto o **app está em foreground**. Para
monitorar com a **tela apagada / app fechado**, precisa de um **foreground
service** persistente (notificação fixa) — código nativo. Além disso, o
acelerômetro **não existe no preview web** (só valida no APK real).

## 4. Plano por fases

### Fase 1 — Dissuasor + SOS real (JS/Expo gerenciado, roda no APK atual)

Sem código nativo. Entrega valor real e é 100% no nosso stack.

- **Wire do SOS real**: botão "segurar" → `POST /api/v1/sos` com `sendLocation` +
  `getCurrentPosition()`. Toggle *Enviar localização* passa a controlar o payload;
  *Modo sonoro* toca sirene.
- **Armar o antifurto**: toggle liga um "modo guarda". Persistir a config
  (SecureStore).
- **Detecção de movimento**: `expo-sensors` `Accelerometer` — disparar quando a
  magnitude da aceleração ultrapassa um limiar (arrancada) e/ou movimento
  sustentado (corrida). Limiar configurável (reaproveitar a ideia de sensibilidade
  do legado .NET, ver SCAN_MAUI).
- **Tela de alarme (dissuasor)** ao disparar:
  - Overlay em **tela cheia**, vermelho, não-dispensável (bloqueia o back).
  - **Mantém a tela ligada** (`expo-keep-awake`).
  - **Sirene** alta (`expo-audio` + asset de som).
  - Só **sai com PIN** (definido pelo usuário na config).
  - **Dispara o SOS** ao backend (posição + família).
  - **Checa conectividade** (`expo-network`); se offline, avisa e oferece abrir
    Ajustes (ver §3.1) — nunca alega ter ligado os dados.
- **Ícone**: trocar `car-sport` por algo coerente (corrida/furto).
- **Honestidade na UI**: deixar claro que é um alarme/dissuasor com o app aberto,
  **não** uma trava de aparelho.

**Pacotes a adicionar (Fase 1):** `expo-sensors`, `expo-audio` (ou `expo-av`),
`expo-network`, `expo-keep-awake`. Todos gerenciados; entram no APK via prebuild.
Sem impacto no preview web além de o acelerômetro não disparar lá (o disparo
manual "segurar" funciona no web).

### Fase 2 — Trava real + background (nativo, build custom)

Etapa nativa dedicada (afeta o build do APK):

- **Device Admin** + `lockNow()` para travar a tela de verdade (com fluxo de
  concessão da permissão de Administrador do dispositivo).
- **Foreground service** para monitorar movimento com a tela apagada / app em
  background.
- (Opcional) screen pinning com confirmação.

## 5. Notificar o contato de segurança

- **Hoje**: `POST /api/v1/sos` já emite `emitToFamily` (SignalR) → membros da
  família recebem em tempo real no app.
- **Futuro** (a decidir): push (FCM — pipeline já existe no backend), **SMS** e
  **WhatsApp**. WhatsApp exige API oficial (Cloud API / provedor) e template
  aprovado; SMS exige gateway (Twilio/afins). Fora do escopo inicial.

## 6. O que este recurso NÃO vai alegar fazer

- **Não liga a internet móvel** (impossível — §3.1). Só detecta e orienta.
- **Não trava o aparelho de verdade na Fase 1** (só dissuade — §3.2).
- **Não monitora com o app fechado na Fase 1** (só em foreground — §3.3).

## 7. Decisões em aberto

- Limiar/curva de sensibilidade do acelerômetro (arrancada vs corrida vs falso
  positivo ao guardar no bolso).
- PIN próprio do antifurto vs reutilizar autenticação da conta.
- Ir para a Fase 2 (Device Admin) — vale o custo nativo + revisão da Play Store?
- Canais de notificação do contato de segurança (push/SMS/WhatsApp) e ordem.
