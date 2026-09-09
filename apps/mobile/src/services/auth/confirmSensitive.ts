import { authenticateBiometric, hasDeviceAuth } from "./biometrics";

/**
 * Step-up de autenticacao para acoes que DESLIGAM protecao.
 *
 * Por que existe: ate 2026-09-09 o `authenticateBiometric` era chamado em
 * apenas tres lugares (destrancar o app, ligar/desligar o proprio app lock, e
 * calar o alarme de furto). Desligar a protecao parental, desarmar o Modo
 * Guarda, remover um membro da familia ou sair da conta nao pediam nada.
 *
 * O cenario que isso permitia e o mais banal de todos num app de familia: a
 * crianca pega o telefone do responsavel — desbloqueado, ou com o app ja
 * aberto — e desliga tudo. O app lock nao cobre isso, porque ele so re-tranca
 * quando o app volta do background.
 *
 * Regra de escape: num aparelho SEM biometria e SEM bloqueio de tela nao ha
 * como distinguir dono de terceiro, e exigir autenticacao trancaria o dono para
 * fora das proprias configuracoes. Nesse caso a acao passa. Nao e uma brecha
 * que valha fechar: quem nao tem bloqueio de tela ja entrega o aparelho inteiro
 * a quem o pegar.
 *
 * @returns `true` se pode prosseguir (autenticou, ou o aparelho nao tem como
 *          autenticar); `false` se o usuario falhou ou cancelou.
 */
export async function confirmSensitive(promptMessage: string): Promise<boolean> {
  if (!(await hasDeviceAuth())) return true;
  return authenticateBiometric(promptMessage);
}
