import { useEffect, useRef, useState } from "react";
import { AppState, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { Text, Button } from "@/components/ui";
import { colors } from "@/theme";
import { useSession } from "@/stores/session";
import { useAppLock, consumeRelockSuppression } from "@/stores/appLock";
import { useMyProfile } from "@/features/profile/queries";
import { authenticateBiometric, cancelBiometricPrompt, hasDeviceAuth } from "@/services/auth/biometrics";

/**
 * WhatsApp-style biometric lock. Wraps the app: while authenticated and the
 * lock is enabled, a full-screen shield covers everything until the owner
 * passes biometrics. Re-locks whenever the app returns from the background.
 * Never arms on the login screen (gated on session status), so a logged-out
 * user is never asked for a fingerprint.
 */
export function AppLockGate({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const authed = useSession((s) => s.status === "authenticated");
  const { enabled, hydrated, locked, lock, unlock } = useAppLock();
  const [prompting, setPrompting] = useState(false);
  const appState = useRef(AppState.currentState);

  // Um aparelho SEM biometria e SEM bloqueio de tela nao tem como autenticar
  // ninguem: `authenticateBiometric` sempre falha. Como o app lock passou a vir
  // LIGADO por padrao, armar nesse aparelho trancaria o usuario para fora do app
  // PARA SEMPRE — inclusive de Ajustes, que fica atras do proprio bloqueio.
  // `null` = ainda verificando; nao arma ate saber.
  const [podeAutenticar, setPodeAutenticar] = useState<boolean | null>(null);
  useEffect(() => {
    hasDeviceAuth().then(setPodeAutenticar);
  }, []);

  // O app da CRIANCA nunca se autotranca.
  //
  // Decisao do fundador em 2026-09-11, depois de ver na pratica: a crianca abria
  // o proprio app e batia numa tela pedindo digital. O app dela existe para ela
  // ver tarefas, progresso e tempo restante -- trancar isso atras de biometria
  // transforma o app num app que a dona nao consegue usar.
  //
  // Nao abre buraco de seguranca: o que precisava de protecao no aparelho da
  // crianca nunca foi a ABERTURA do app, e sim as acoes sensiveis (desligar
  // protecao, mexer em limites), que passam por `confirmSensitive` uma a uma.
  // O bloqueio de tela inteira aqui sempre foi para o aparelho do responsavel,
  // onde o risco e a crianca pegar o telefone do pai.
  //
  // Enquanto o perfil ainda nao carregou, NAO arma: um falso bloqueio na cara
  // da crianca e pior que a fracao de segundo em que o aparelho do responsavel
  // fica destravado no arranque -- ali a defesa real continua sendo o
  // `confirmSensitive` de cada acao.
  const { data: profile } = useMyProfile();
  const perfilCrianca = profile?.appProfile === "child";

  const active = authed && hydrated && enabled && podeAutenticar === true && !perfilCrianca && !!profile;
  // Espelho em ref para o listener de AppState (montado uma vez) enxergar o
  // valor atual em vez do capturado no primeiro render.
  const activeRef = useRef(active);
  activeRef.current = active;

  // Re-lock on every background → foreground transition (like WhatsApp).
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      const prev = appState.current;
      appState.current = next;
      if (next === "active" && prev.match(/inactive|background/) && useAppLock.getState().enabled) {
        // A native share sheet / export flow just backgrounded us on purpose —
        // see suppressNextRelock() in stores/appLock.ts. Consume it and skip
        // this one re-lock instead of demanding biometrics again.
        if (consumeRelockSuppression()) return;
        // Se JA estava trancado, `lock()` nao muda estado nenhum e o efeito de
        // auto-prompt abaixo nao dispara -- era assim que se voltava ao app e
        // encontrava a tela de bloqueio parada, sem prompt nenhum. Pedir de
        // novo aqui e o que torna "sair e voltar" um caminho de recuperacao.
        // `promptUnlock` ja se protege sozinho quando o portao esta inativo;
        // `lock()` continua valendo em qualquer caso, pois so marca o estado --
        // quem decide mostrar algo e `active` no render.
        if (useAppLock.getState().locked) void promptUnlockRef.current();
        else lock();
      }
    });
    return () => sub.remove();
  }, [lock]);

  // Gera um id por tentativa. Uma tentativa PENDURADA que resolve tarde
  // demais (ver cancelBiometricPrompt abaixo) nao pode pisar no estado de
  // uma tentativa mais nova via seu proprio `finally`/resultado.
  const promptAttemptRef = useRef(0);

  const promptUnlock = async (origem: "auto" | "usuario" = "auto") => {
    // `activeRef`, nao `active`: este metodo e chamado de dentro do listener de
    // AppState, que e montado UMA vez e captura o valor do primeiro render.
    //
    // Sem esta guarda o app da CRIANCA -- onde o portao esta desligado de
    // proposito e nenhuma tela de bloqueio existe -- disparava o prompt de
    // biometria do sistema a cada volta ao primeiro plano: `locked` nasce true
    // no store e nunca e limpo quando o portao esta inativo, entao o ramo de
    // retentativa abaixo pedia digital sem NADA por tras. Visto em campo em
    // 2026-09-11, no Redmi.
    if (!activeRef.current) return;
    // A guarda de "ja estou pedindo" vale SO para a tentativa automatica.
    //
    // Um toque explicito no botao nunca pode ser descartado: se a pessoa esta
    // tocando, e exatamente porque a tentativa anterior nao funcionou. Quando
    // o prompt do SO nao sobe, a promessa fica pendurada ate o teto de tempo,
    // e aplicar a guarda aqui deixava o botao VIVO E INERTE por ate um minuto
    // -- medido no aparelho em 2026-09-11: o mesmo toque, no mesmo ponto, nao
    // fazia nada e passados 70s abria o prompt normalmente. Era esse o
    // "nao abre a opcao de desbloquear" relatado pelo fundador.
    if (origem === "auto" && prompting) return;
    const myAttempt = ++promptAttemptRef.current;
    // COMPLEMENTO 2026-09-11 (achado de QA em outro aparelho, POCO, resume
    // "morno" via monkey/intent do launcher): a correcao acima (bypassar a
    // guarda para toque manual) deixa o toque sempre CHAMAR de novo, mas sem
    // isto ele chama authenticateAsync() uma SEGUNDA vez com a tentativa
    // anterior ainda pendurada por baixo -- comportamento indefinido do lado
    // nativo (o Android nao promete o que acontece com dois authenticate()
    // simultaneos). Cancelar a pendurada primeiro garante uma chamada nativa
    // limpa a cada toque, e o id de tentativa acima impede que o resultado
    // (tardio) da cancelada derrube o estado da nova.
    if (prompting) cancelBiometricPrompt();
    setPrompting(true);
    try {
      const ok = await authenticateBiometric(t("appLock.prompt"));
      if (myAttempt !== promptAttemptRef.current) return; // resultado tardio de uma tentativa ja substituida
      if (ok) unlock();
    } finally {
      // `finally`: se authenticateBiometric lancar, `prompting` ficaria true
      // para sempre e a tela de bloqueio viraria uma prisao -- ver o
      // comentario do botao, abaixo. So a tentativa MAIS RECENTE limpa o
      // estado (ver promptAttemptRef acima).
      if (myAttempt === promptAttemptRef.current) setPrompting(false);
    }
  };
  const promptUnlockRef = useRef(promptUnlock);
  promptUnlockRef.current = promptUnlock;

  // Auto-prompt assim que o bloqueio fica visivel.
  //
  // O atraso nao e estetico: o BiometricPrompt do Android NAO sobe se a
  // activity ainda nao estiver resumed, e quando ele nao sobe a promessa nunca
  // resolve. O AppState "active" do React Native chega antes disso em alguns
  // aparelhos (visto no POCO em 2026-09-11), entao pedir no mesmo tick e pedir
  // cedo demais.
  useEffect(() => {
    if (!(active && locked)) return;
    // 600ms, nao 250: o BiometricPrompt do Android nao sobe enquanto a
    // activity nao estiver resumed, e no POCO 250ms ainda era cedo demais --
    // a primeira tentativa se perdia e so o toque manual resolvia.
    const id = setTimeout(() => void promptUnlockRef.current("auto"), 600);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, locked]);

  return (
    <View style={{ flex: 1 }}>
      {children}
      {active && locked ? (
        <View className="absolute inset-0 items-center justify-center gap-6 bg-night-500 px-8">
          <View className="h-24 w-24 items-center justify-center rounded-full bg-white/10">
            <Ionicons name="finger-print" size={52} color="#FFFFFF" />
          </View>
          <View className="items-center gap-2">
            <Text variant="h2" color="inverse" className="text-center">
              {t("appLock.title")}
            </Text>
            <Text variant="body" color="inverse" className="text-center opacity-80">
              {t("appLock.body")}
            </Text>
          </View>
          {/* Sem `loading={prompting}` DE PROPOSITO. O Button desabilita quando
              loading e true (isDisabled = disabled || loading), e este e o
              UNICO caminho de volta para dentro do app: se o prompt do SO nao
              subir, um botao desabilitado tranca o dono para fora ate ele
              forcar a parada do app. Foi exatamente o que aconteceu no POCO em
              2026-09-11 -- "WardYou bloqueado" com spinner eterno e nenhum
              BiometricPrompt no logcat. O feedback visual aqui e o proprio
              prompt do sistema; a guarda `prompting` dentro de promptUnlock ja
              evita prompt duplicado. */}
          <Button
            label={t("appLock.unlock")}
            icon="finger-print"
            onPress={() => void promptUnlock("usuario")}
            fullWidth={false}
          />
        </View>
      ) : null}
    </View>
  );
}
