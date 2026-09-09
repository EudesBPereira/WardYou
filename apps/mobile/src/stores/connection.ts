import { create } from "zustand";

interface ConnectionState {
  /** Alguma query falhou depois de esgotar as tentativas. */
  hasError: boolean;
  setHasError: (v: boolean) => void;
}

/**
 * Sinal global de "o servidor nao respondeu".
 *
 * Existe por causa de um comportamento do TanStack Query v5 que enganava o
 * usuario: quando uma query falha, `isLoading` volta a `false` e `data` fica
 * `undefined`, entao o default do destructuring (`= []`) assume e a tela
 * renderiza o **estado vazio**. Uma falha de rede virava "Nenhuma zona
 * cadastrada" ou "Nenhum membro na familia" — indistinguivel de nao ter dado.
 * Num app de seguranca familiar isso e pior do que travar: o responsavel pode
 * concluir que nao ha nada para ver quando na verdade nao houve resposta.
 */
export const useConnection = create<ConnectionState>((set) => ({
  hasError: false,
  setHasError: (v) => set((s) => (s.hasError === v ? s : { hasError: v })),
}));
