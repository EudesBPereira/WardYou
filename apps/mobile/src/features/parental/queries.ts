import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMocks } from "@/lib/env";
import { apiClient } from "@/services/api/client";

export interface ChildDto {
  memberId: string;
  userId: string;
  fullName: string;
  email: string | null;
  avatarUrl: string | null;
  role: "child" | "member";
  isConnected: boolean;
  lastSeenAt: string | null;
  /** Estado REAL da protecao no aparelho da crianca, vindo do heartbeat.
   *  A API ja mandava estes dois desde sempre (parentalService: hasUsageAccess
   *  / hasAccessibility) e o cliente os DESCARTAVA: a lista do responsavel
   *  mostrava apenas "Conectado", entao o pai nao tinha como saber que o
   *  enforcement estava desligado no telefone do filho. */
  hasUsageAccess: boolean;
  hasAccessibility: boolean;
}

export interface PolicyDto {
  id: string;
  childUserId: string;
  managedByUserId: string;
  dailyScreenTimeLimitMinutes: number;
  isEnabled: boolean;
  blockAppInstall: boolean;
  entertainmentDailyLimitMinutes: number | null;
  isRemotelyPaused: boolean;
  /** Set when the remote pause was created with a duration — auto-lifts then. */
  pausedUntil?: string | null;
  blockedWebsites: string[];
}

export interface ExtraTimeDto {
  id: string;
  childUserId: string;
  requestedMinutes: number;
  status: string;
  requestedAt: string;
}

export interface TaskDto {
  id: string;
  childUserId: string;
  title: string;
  description: string | null;
  category: string;
  rewardMinutes: number;
  isActive: boolean;
}

export interface CompletionDto {
  id: string;
  childTaskId: string;
  childUserId: string;
  title: string;
  rewardMinutes: number;
  status: string;
  childNote: string | null;
  completedAt: string;
}

const empty = async <T>(): Promise<T[]> => [];

export function useChildren() {
  return useQuery({
    queryKey: ["parental", "children"],
    queryFn: () => (useMocks ? empty<ChildDto>() : apiClient.get<ChildDto[]>("/api/v1/parental/children")),
  });
}

export function usePolicy(childUserId: string | undefined) {
  return useQuery({
    queryKey: ["parental", "policy", childUserId],
    enabled: !!childUserId && !useMocks,
    queryFn: () => apiClient.get<PolicyDto>(`/api/v1/parental/children/${childUserId}/policy`),
  });
}

export function useUpsertPolicy(childUserId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { dailyScreenTimeLimitMinutes: number; isEnabled: boolean }) =>
      apiClient.put<PolicyDto>(`/api/v1/parental/children/${childUserId}/policy`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["parental", "policy", childUserId] }),
  });
}

// ── Pending requests for ONE child (extra time + app access) ──────────────
export interface AppAccessRequestDto {
  packageName: string;
  label: string;
  requestedAt: string;
}
export interface ChildRequestsDto {
  extraTime: ExtraTimeDto[];
  appAccess: AppAccessRequestDto[];
}

/** What this child is waiting on — drives the "Pendências" card on the
 *  guardian's screens. Polls modestly; realtime invalidates it on the spot. */
export function useChildRequests(childUserId: string | undefined) {
  return useQuery({
    queryKey: ["parental", "requests", childUserId],
    enabled: !!childUserId && !useMocks,
    refetchInterval: 60_000,
    queryFn: () => apiClient.get<ChildRequestsDto>(`/api/v1/parental/children/${childUserId}/requests`),
  });
}

/** Approve (optionally for N hours) or reject an app-access request. */
export function useDecideAppAccess(childUserId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ packageName, approve, hours }: { packageName: string; approve: boolean; hours?: number }) =>
      apiClient.post(`/api/v1/parental/children/${childUserId}/requests/app-access`, {
        packageName,
        approve,
        ...(hours ? { hours } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["parental", "requests", childUserId] });
      qc.invalidateQueries({ queryKey: ["parental", "apps", childUserId] });
    },
  });
}

export function usePendingExtraTime() {
  return useQuery({
    queryKey: ["parental", "extra-time", "pending"],
    queryFn: () =>
      useMocks ? empty<ExtraTimeDto>() : apiClient.get<ExtraTimeDto[]>("/api/v1/parental/extra-time/pending"),
  });
}

export function useDecideExtraTime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, approve }: { requestId: string; approve: boolean }) =>
      apiClient.put(`/api/v1/parental/extra-time/${requestId}/${approve ? "approve" : "reject"}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["parental", "extra-time", "pending"] }),
  });
}

export function usePendingCompletions() {
  return useQuery({
    queryKey: ["parental", "completions", "pending"],
    queryFn: () =>
      useMocks ? empty<CompletionDto>() : apiClient.get<CompletionDto[]>("/api/v1/parental/tasks/completions/pending"),
  });
}

export function useDecideCompletion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ completionId, approve }: { completionId: string; approve: boolean }) =>
      apiClient.put(`/api/v1/parental/tasks/completions/${completionId}/${approve ? "approve" : "reject"}`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["parental", "completions", "pending"] }),
  });
}

export function useChildTasks(childUserId: string | undefined) {
  return useQuery({
    queryKey: ["parental", "tasks", childUserId],
    enabled: !!childUserId && !useMocks,
    queryFn: () => apiClient.get<TaskDto[]>(`/api/v1/parental/children/${childUserId}/tasks`),
  });
}

export function useCreateTask(childUserId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; rewardMinutes: number; category?: string }) =>
      apiClient.post<TaskDto>(`/api/v1/parental/children/${childUserId}/tasks`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["parental", "tasks", childUserId] }),
  });
}

export function useDeleteTask(childUserId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => apiClient.del(`/api/v1/parental/children/${childUserId}/tasks/${taskId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["parental", "tasks", childUserId] }),
  });
}

// ── Remote action ─────────────────────────────────────────────────────────
export function useRemoteAction(childUserId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { action: "Pause" | "Resume"; durationMinutes?: number }) =>
      apiClient.post<PolicyDto>(`/api/v1/parental/children/${childUserId}/remote-action`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["parental", "policy", childUserId] }),
  });
}

/** Kids360-style "liberar por N horas": one app usable for the next N hours
 *  without touching its permanent allow/block state. hours=0 clears it. */
export function useTemporaryAllow(childUserId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { appPackageName: string; hours: number }) =>
      apiClient.post<AppRuleDto>(
        `/api/v1/parental/children/${childUserId}/apps/${encodeURIComponent(input.appPackageName)}/temporary-allow`,
        { hours: input.hours },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["parental", "apps", childUserId] }),
  });
}

// ── App rules ─────────────────────────────────────────────────────────────
export interface AppRuleDto {
  id: string;
  appPackageName: string;
  appDisplayName: string;
  isBlocked: boolean;
  dailyLimitMinutes: number | null;
  isEmergencyAllowed: boolean;
  isWhitelisted: boolean;
  appCategory: string;
  /** Temporary allow deadline (ISO) — usable until then even if not allowed. */
  allowedUntil?: string | null;
  /** False = device-reported install the guardian hasn't decided on yet. */
  configured?: boolean;
}

export function useAppRules(childUserId: string | undefined) {
  return useQuery({
    queryKey: ["parental", "apps", childUserId],
    enabled: !!childUserId && !useMocks,
    queryFn: () => apiClient.get<AppRuleDto[]>(`/api/v1/parental/children/${childUserId}/apps`),
  });
}

export interface AppRuleInput {
  appPackageName: string;
  appDisplayName?: string;
  isBlocked: boolean;
  isWhitelisted?: boolean;
  dailyLimitMinutes?: number | null;
  appCategory?: string;
}

export function useSaveAppRules(childUserId: string) {
  const qc = useQueryClient();
  const key = ["parental", "apps", childUserId];
  return useMutation({
    mutationFn: (rules: AppRuleInput[]) =>
      apiClient.put<AppRuleDto[]>(`/api/v1/parental/children/${childUserId}/apps/rules`, { rules }),
    // Optimistic: flip the cached rows instantly so a toggle feels like a
    // switch, not a 2s round trip (the PUT replaces the whole rule set, so
    // projecting the inputs onto the cache is exact, not a guess). Server
    // truth still lands via the settled invalidation; errors roll back.
    onMutate: async (rules) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<AppRuleDto[]>(key);
      if (previous) {
        const byPkg = new Map(rules.map((r) => [r.appPackageName.toLowerCase(), r]));
        const next: AppRuleDto[] = previous
          .filter((d) => byPkg.has(d.appPackageName.toLowerCase()))
          .map((d) => {
            const input = byPkg.get(d.appPackageName.toLowerCase())!;
            return {
              ...d,
              appDisplayName: input.appDisplayName ?? d.appDisplayName,
              isBlocked: input.isBlocked,
              isWhitelisted: input.isWhitelisted ?? false,
              dailyLimitMinutes: input.dailyLimitMinutes ?? null,
              appCategory: input.appCategory ?? d.appCategory,
              configured: true,
            };
          });
        for (const input of rules) {
          if (!previous.some((d) => d.appPackageName.toLowerCase() === input.appPackageName.toLowerCase())) {
            next.push({
              id: `optimistic-${input.appPackageName}`,
              appPackageName: input.appPackageName,
              appDisplayName: input.appDisplayName ?? input.appPackageName,
              isBlocked: input.isBlocked,
              isWhitelisted: input.isWhitelisted ?? false,
              dailyLimitMinutes: input.dailyLimitMinutes ?? null,
              isEmergencyAllowed: false,
              appCategory: input.appCategory ?? "Other",
              allowedUntil: null,
              configured: true,
            });
          }
        }
        qc.setQueryData(key, next);
      }
      return { previous };
    },
    onError: (_err, _rules, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}

// ── Sleep schedule ────────────────────────────────────────────────────────
export interface SleepDto {
  id: string | null;
  isEnabled: boolean;
  startTime: string;
  endTime: string;
  daysOfWeek: number;
}

export function useSleepSchedule(childUserId: string | undefined) {
  return useQuery({
    queryKey: ["parental", "sleep", childUserId],
    enabled: !!childUserId && !useMocks,
    queryFn: () => apiClient.get<SleepDto>(`/api/v1/parental/children/${childUserId}/sleep-schedule`),
  });
}

export function useSaveSleepSchedule(childUserId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<SleepDto, "id">) =>
      apiClient.put<SleepDto>(`/api/v1/parental/children/${childUserId}/sleep-schedule`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["parental", "sleep", childUserId] }),
  });
}

// ── Block schedules ───────────────────────────────────────────────────────
export interface BlockDto {
  id: string;
  name: string;
  isEnabled: boolean;
  startTime: string;
  endTime: string;
  daysOfWeek: number;
  blockAll: boolean;
  blockGames: boolean;
  blockSocial: boolean;
  blockVideo: boolean;
}

export function useBlockSchedules(childUserId: string | undefined) {
  return useQuery({
    queryKey: ["parental", "blocks", childUserId],
    enabled: !!childUserId && !useMocks,
    queryFn: () => apiClient.get<BlockDto[]>(`/api/v1/parental/children/${childUserId}/block-schedules`),
  });
}

export function useSaveBlockSchedule(childUserId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: Omit<BlockDto, "id"> & { id?: string }) =>
      id
        ? apiClient.put<BlockDto>(`/api/v1/parental/children/${childUserId}/block-schedules/${id}`, input)
        : apiClient.post<BlockDto>(`/api/v1/parental/children/${childUserId}/block-schedules`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["parental", "blocks", childUserId] }),
  });
}

export function useDeleteBlockSchedule(childUserId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.del(`/api/v1/parental/children/${childUserId}/block-schedules/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["parental", "blocks", childUserId] }),
  });
}

// ── Usage overview ────────────────────────────────────────────────────────
export interface UsageOverviewDto {
  todayMinutes: number;
  windowTotalMinutes: number;
  dailyAverageMinutes: number;
  days: { date: string; totalMinutes: number }[];
  topApps: { appPackageName: string; appDisplayName: string; totalMinutes: number }[];
}

export function useUsageOverview(childUserId: string | undefined, days = 7) {
  return useQuery({
    queryKey: ["parental", "usage", childUserId, days],
    enabled: !!childUserId && !useMocks,
    queryFn: () =>
      apiClient.get<UsageOverviewDto>(`/api/v1/parental/children/${childUserId}/usage-summary/overview?days=${days}`),
  });
}

// ── Blocked websites (part of policy) ─────────────────────────────────────
export function useSaveBlockedWebsites(childUserId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (domains: string[]) =>
      apiClient.put<PolicyDto>(`/api/v1/parental/children/${childUserId}/blocked-websites`, { domains }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["parental", "policy", childUserId] }),
  });
}
