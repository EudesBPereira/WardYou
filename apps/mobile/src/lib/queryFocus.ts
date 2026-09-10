import { AppState, Platform } from "react-native";
import * as Network from "expo-network";
import { focusManager, onlineManager } from "@tanstack/react-query";

/**
 * Liga o TanStack Query ao ciclo de vida do app React Native.
 *
 * O TanStack foi desenhado para a web, onde ele escuta eventos do `window`
 * (`focus`, `online`, `offline`) que **nao existem** no React Native. Sem esta
 * ponte, `refetchOnWindowFocus` e `refetchOnReconnect` ficam ligados na config
 * mas nunca disparam — e o app parece "travado em dado velho" ate reiniciar.
 *
 * Foi o que aconteceu em QA (2026-09-09): o responsavel aprovou a entrada de um
 * membro e a tela dele continuou em "Conta em analise". O servidor tinha
 * emitido o evento corretamente; o aparelho e que estava com o socket morto
 * (app em segundo plano) e sem nenhum gatilho de refetch ao voltar.
 *
 * Chamar uma vez, no boot do app.
 */
export function wireQueryToAppLifecycle(): void {
  if (Platform.OS === "web") return;

  focusManager.setEventListener((handleFocus) => {
    const sub = AppState.addEventListener("change", (estado) => {
      handleFocus(estado === "active");
    });
    return () => sub.remove();
  });

  onlineManager.setEventListener((setOnline) => {
    let vivo = true;
    // expo-network nao expoe um listener estavel em todas as plataformas, entao
    // sondamos. 15s e barato e resolve o caso real: voltar de tunel/elevador e
    // as telas se recuperarem sozinhas em vez de ficarem em erro.
    const checar = async () => {
      try {
        const estado = await Network.getNetworkStateAsync();
        if (vivo) setOnline(!!(estado.isConnected && estado.isInternetReachable));
      } catch {
        /* melhor esforco: na duvida, nao derruba o estado online */
      }
    };
    void checar();
    const timer = setInterval(checar, 15_000);
    return () => {
      vivo = false;
      clearInterval(timer);
    };
  });
}
