import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { diagnosticar, type Problema } from "@/features/protection/diagnostics";

/** Problemas que afetam SER ACOMPANHADO nesta viagem. Os demais que o
 *  diagnostico devolve (bateria, push, acessibilidade...) tem o painel deles;
 *  repetir aqui transformaria o aviso de viagem numa segunda lista generica. */
const IDS_RELEVANTES = [
  "locationPermission",
  "locationServices",
  "locationBackground",
  "tripTracking",
  "network",
] as const;

/**
 * Re-medicao PERIODICA, nao so ao voltar do segundo plano.
 *
 * Achado de QA 2026-09-11, medido ao vivo no Redmi: com a viagem aberta na
 * tela, o GPS do sistema foi desligado (`location_mode -> 0`) e NENHUM aviso
 * apareceu -- o card media uma vez na montagem e depois so em
 * `AppState === "active"`, ou seja, so ao voltar do segundo plano. Mas o caso
 * mais comum de todos e exatamente esse: a pessoa puxa o painel de atalhos,
 * toca em "Localizacao" para poupar bateria, e volta pro app sem nunca
 * sair dele -- nao ha transicao de AppState nenhuma, e a tela seguia exibindo
 * a medicao de quando o GPS ainda estava ligado.
 *
 * Amostragem em vez de um receptor nativo de PROVIDERS_CHANGED: o receptor
 * seria exato, mas cobre so UM dos sinais (o GPS do sistema) -- permissao
 * revogada e tarefa de rastreamento morta continuariam precisando de
 * amostragem, e ele custaria codigo nativo novo + build novo. Todas as
 * medicoes aqui sao chamadas nativas baratas, sem rede (a unica excecao e o
 * teste de conectividade, que tambem e local), entao 15s e barato.
 */
const INTERVALO_MS = 15_000;

export interface TripSharingHealth {
  /** Problemas relevantes para o compartilhamento desta viagem, na ordem de
   *  resolucao. Vazio = nada a avisar. */
  problemas: Problema[];
  /** Algo IMPEDE o compartilhamento agora (nao apenas o degrada). */
  critico: boolean;
  /**
   * A posicao esta realmente sendo compartilhada agora?
   *
   * `false` so quando ha problema CRITICO: `locationBackground` (permissao
   * "so enquanto usa o app") degrada, mas com o app aberto -- que e
   * exatamente quando a pessoa esta olhando esta tela -- a transmissao
   * funciona de verdade, e chamar isso de "nao transmitindo" seria a mentira
   * oposta. `null` enquanto a primeira medicao nao terminou: nao afirma nem
   * que esta, nem que nao esta.
   */
  transmitindo: boolean | null;
}

export function useTripSharingHealth(ativa: boolean): TripSharingHealth {
  const [problemas, setProblemas] = useState<Problema[] | null>(null);

  const medir = useCallback(() => {
    if (!ativa) {
      setProblemas(null);
      return;
    }
    diagnosticar({ emViagem: true })
      .then((d) =>
        setProblemas(
          d.problemas.filter((p) => (IDS_RELEVANTES as readonly string[]).includes(p.id)),
        ),
      )
      .catch(() => setProblemas(null));
  }, [ativa]);

  useEffect(() => {
    medir();
    if (!ativa) return;
    const timer = setInterval(medir, INTERVALO_MS);
    // Ao voltar do segundo plano tambem: resolver uma permissao ou religar o
    // GPS acontece FORA do app, e esperar ate 15s pelo proximo tick deixaria
    // o aviso de pe depois de resolvido.
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") medir();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [medir, ativa]);

  const critico = (problemas ?? []).some((p) => p.severidade === "critica");
  return {
    problemas: problemas ?? [],
    critico,
    transmitindo: problemas === null ? null : !critico,
  };
}
