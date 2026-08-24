import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMocks } from "@/lib/env";
import { apiClient } from "@/services/api/client";

export interface ElderDto {
  memberId: string;
  userId: string;
  fullName: string;
  email: string | null;
  avatarUrl: string | null;
  role: "elder" | "member";
  batteryLevel: number | null;
  lastSeenAt: string | null;
}

export interface MedicationDto {
  id: string;
  elderUserId: string;
  name: string;
  dosage: string | null;
  times: string[];
  daysOfWeek: number;
  isActive: boolean;
}

export interface MedicationInput {
  name: string;
  dosage?: string;
  times: string[];
  daysOfWeek: number;
}

export function useElders() {
  return useQuery({
    queryKey: ["elder", "elders"],
    queryFn: () => (useMocks ? Promise.resolve<ElderDto[]>([]) : apiClient.get<ElderDto[]>("/api/v1/elder/elders")),
  });
}

/** The elder's own medication list (elder mode home). */
export function useMyMedications(enabled = true) {
  return useQuery({
    queryKey: ["elder", "medications", "my"],
    enabled: enabled && !useMocks,
    queryFn: () => apiClient.get<MedicationDto[]>("/api/v1/elder/medications/my"),
  });
}

export function useMedications(elderUserId: string | undefined) {
  return useQuery({
    queryKey: ["elder", "medications", elderUserId],
    enabled: !!elderUserId && !useMocks,
    queryFn: () => apiClient.get<MedicationDto[]>(`/api/v1/elder/${elderUserId}/medications`),
  });
}

/** Replace the elder's full medication list (the endpoint is an upsert/replace). */
export function useSaveMedications(elderUserId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (medications: MedicationInput[]) =>
      apiClient.put<MedicationDto[]>(`/api/v1/elder/${elderUserId}/medications`, { medications }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["elder", "medications", elderUserId] }),
  });
}

export interface CheckInStatusDto {
  lastCheckInAt: string | null;
  checkedInToday: boolean;
}

/** The elder's own check-in status (elder mode home). */
export function useMyCheckInStatus() {
  return useQuery({
    queryKey: ["elder", "check-in", "my"],
    enabled: !useMocks,
    queryFn: () => apiClient.get<CheckInStatusDto>("/api/v1/elder/check-in/my"),
  });
}

/** An elder's check-in status, seen by whoever manages them. */
export function useCheckInStatus(elderUserId: string | undefined) {
  return useQuery({
    queryKey: ["elder", "check-in", elderUserId],
    enabled: !!elderUserId && !useMocks,
    queryFn: () => apiClient.get<CheckInStatusDto>(`/api/v1/elder/${elderUserId}/check-in`),
  });
}

/** The elder confirms they're okay today; notifies whoever manages them. */
export function useCheckIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (note?: string) => apiClient.post<CheckInStatusDto>("/api/v1/elder/check-in", note ? { note } : undefined),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["elder", "check-in"] }),
  });
}

/** Check-in history (ISO timestamps, newest first) — caregiver view. */
export function useCheckInHistory(elderUserId: string | undefined, days = 7) {
  return useQuery({
    queryKey: ["elder", "check-in-history", elderUserId, days],
    enabled: !!elderUserId && !useMocks,
    queryFn: () => apiClient.get<string[]>(`/api/v1/elder/${elderUserId}/check-in/history?days=${days}`),
  });
}

// ── Medication adherence ("tomei") ─────────────────────────────────────────

export interface AdherenceEntryDto {
  medicationId: string;
  time: string;
  takenAt: string;
}

/** Today's confirmed doses — the elder's own (elder mode home). */
export function useMyAdherence(enabled = true) {
  return useQuery({
    queryKey: ["elder", "adherence", "my"],
    enabled: enabled && !useMocks,
    queryFn: () => apiClient.get<AdherenceEntryDto[]>("/api/v1/elder/adherence/my"),
  });
}

/** Today's confirmed doses of an elder — caregiver view. */
export function useAdherence(elderUserId: string | undefined) {
  return useQuery({
    queryKey: ["elder", "adherence", elderUserId],
    enabled: !!elderUserId && !useMocks,
    queryFn: () => apiClient.get<AdherenceEntryDto[]>(`/api/v1/elder/${elderUserId}/adherence`),
  });
}

/** The elder confirms one dose ("tomei"). Idempotent per (med, time, day). */
export function useMarkTaken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { medicationId: string; time: string }) =>
      apiClient.post<AdherenceEntryDto[]>(`/api/v1/elder/medications/${input.medicationId}/taken`, { time: input.time }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["elder", "adherence"] }),
  });
}
