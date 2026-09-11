// Child-side hooks: what the child's own device reads and does (status of the
// day, extra-time requests, tasks to earn screen time, heartbeat). The parent
// management hooks live in queries.ts.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";
import { useMocks } from "@/lib/env";
import { apiClient } from "@/services/api/client";
import { useSession } from "@/stores/session";
import { getAccessibilityStatus, isUsageAccessEnabled } from "./enforcement";
import { consumeAdminDisabledFlag } from "@modules/app-block";
import { getBatteryPercent } from "@/services/location/locationService";
import type { TaskDto, CompletionDto } from "./queries";

export interface MyParentalStatusDto {
  hasPolicy: boolean;
  isEnabled?: boolean;
  isPaused?: boolean;
  dailyLimitMinutes?: number;
  extraMinutesToday?: number;
  usedMinutesToday?: number;
  remainingMinutes?: number;
  blockedAppsCount?: number;
  blockedWebsitesCount?: number;
  pendingExtraRequest?: { id: string; requestedMinutes: number; expiresAt: string } | null;
  sleep?: { isEnabled: boolean; startTime: string; endTime: string; daysOfWeek: number } | null;
}

export function useMyParentalStatus(enabled = true) {
  return useQuery({
    queryKey: ["parental", "my-status"],
    enabled: enabled && !useMocks,
    refetchInterval: 60_000,
    queryFn: () => apiClient.get<MyParentalStatusDto>("/api/v1/parental/my-status"),
  });
}

export function useRequestExtraTime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (requestedMinutes: number) => {
      const childUserId = useSession.getState().session?.userId;
      return apiClient.post("/api/v1/parental/extra-time/request", { childUserId, requestedMinutes });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["parental", "my-status"] }),
  });
}

/** Blocked screen: ask the guardian to allow a specific app (push nudge — the
 *  guardian decides on their apps screen; server throttles repeats to 5 min). */
export function useRequestAppAccess() {
  return useMutation({
    mutationFn: ({ packageName, label }: { packageName: string; label?: string }) =>
      apiClient.post("/api/v1/parental/request-app-access", { packageName, label }),
  });
}

export interface MyTasksDto {
  tasks: TaskDto[];
  completions: (CompletionDto & { parentNote: string | null; childTaskId: string })[];
}

export function useMyTasks(enabled = true) {
  return useQuery({
    queryKey: ["parental", "my-tasks"],
    enabled: enabled && !useMocks,
    queryFn: () => apiClient.get<MyTasksDto>("/api/v1/parental/tasks/my"),
  });
}

export function useCompleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, childNote }: { taskId: string; childNote?: string }) =>
      apiClient.post("/api/v1/parental/tasks/complete", { taskId, childNote }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["parental", "my-tasks"] }),
  });
}

/** Best-effort presence ping from the child's device. `hasAccessibility`
 *  reflects whether the AccessibilityService (real on-device app blocking) is
 *  actually enabled in Android settings; `adminDisabled` reports (once) that
 *  the uninstall protection was switched off — the tamper the guardian most
 *  needs to hear about, since it precedes uninstalling WardYou entirely. */
export function useHeartbeat() {
  return useMutation({
    mutationFn: async () => {
      // Battery rides along with the heartbeat (every 60s) — far fresher than
      // the location report, and it's what the guardian's screen shows.
      const batteryLevel = await getBatteryPercent();
      // `unknown` is OMITTED, not sent as `false`. A false `false` here is not
      // a cosmetic bug: the server compares it against the last heartbeat and
      // pushes "a proteção do seu filho caiu" to the guardian (see
      // parentalService.reportHeartbeat → alertProtectionDisabled). Waking a
      // parent over a measurement we could not make is how a real alert stops
      // being believed. The server keeps the previous known value when the
      // field is absent.
      const accessibility = getAccessibilityStatus();
      return apiClient.post("/api/v1/parental/heartbeat", {
        hasUsageAccess: isUsageAccessEnabled(),
        ...(accessibility === "unknown" ? {} : { hasAccessibility: accessibility === "running" }),
        adminDisabled: consumeAdminDisabledFlag(),
        ...(batteryLevel != null ? { batteryLevel } : {}),
        // Was a hardcoded "rn-dev" placeholder — every heartbeat ever sent
        // reported that literal string as the child device's app version,
        // regardless of what build was actually running. Harmless today (no
        // guardian UI reads AppVersion yet), but it's exactly the
        // "asserts a fact it never checked" pattern this audit is looking
        // for, and it'll actively mislead support/guardian tooling the
        // moment someone surfaces this field.
        appVersion: Constants.expoConfig?.version ?? "unknown",
      });
    },
  });
}
