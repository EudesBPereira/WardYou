import type { TaskDto, CompletionDto } from "./queries";

/**
 * Uma tarefa esta disponivel pra concluir agora?
 *
 * Espelha `isTaskAlreadyCredited` de apps/api/src/services/parentalService.ts
 * (a fonte de verdade — quem de fato bloqueia um reenvio e o 409 do servidor
 * em POST /tasks/complete). Isto e so o sinal de UI, extraido pra um modulo
 * so depois de aparecer DUAS vezes com a mesma logica reimplementada torto:
 *
 *  - app/(tabs)/tasks.tsx: uma tarefa nao-recorrente ja aprovada continuava
 *    mostrando "Concluí!" -- a crianca tocava, o servidor recusava (409,
 *    confirmado em log), e a tela nao mudava nada, sem nenhum aviso.
 *  - src/features/home/ChildHome.tsx: o card "Ganhe mais tempo" contava essa
 *    MESMA tarefa ja paga como "tarefa disponivel, +30min pra ganhar" --
 *    achado de QA 2026-09-11, depois do primeiro fix acima.
 *
 * Dia local do APARELHO (nao o "meio-dia da familia" que o servidor usa) —
 * imprecisao aceitavel perto da meia-noite: isto so decide o que MOSTRAR, o
 * servidor continua sendo quem decide de verdade.
 */
export function isTaskAvailable(
  task: TaskDto,
  completions: CompletionDto[],
  now: Date = new Date(),
): boolean {
  const forThisTask = completions.filter((c) => c.childTaskId === task.id);
  if (forThisTask.some((c) => c.status === "PendingApproval")) return false;
  const approvedDates = forThisTask
    .filter((c) => c.status === "Approved" && c.reviewedAt)
    .map((c) => new Date(c.reviewedAt as string));
  if (approvedDates.length === 0) return true;
  if (!task.isRecurring) return false; // pago uma vez, para sempre
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60_000);
  return !approvedDates.some((d) => d >= today && d < tomorrow); // ja pago hoje?
}
