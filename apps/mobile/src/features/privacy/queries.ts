import { useMutation, useQuery } from "@tanstack/react-query";
import { useMocks } from "@/lib/env";
import { apiClient } from "@/services/api/client";

export interface PrivacySummaryDto {
  devices: number;
  locationEvents: number;
  userConsents: number;
  familyConsents: number;
  sosEvents: number;
  familyMemberships: number;
  auditLogs: number;
  tasks: number;
}

export interface AuditLogDto {
  id: string;
  actorUserId: string;
  targetUserId: string | null;
  action: string;
  sourceType: string;
  familyId: string | null;
  createdAt: string;
  metadata: unknown;
}

export interface AuditPage {
  items: AuditLogDto[];
  page: number;
  pageSize: number;
  total: number;
}

export function usePrivacySummary() {
  return useQuery({
    queryKey: ["privacy", "summary"],
    enabled: !useMocks,
    queryFn: () => apiClient.get<PrivacySummaryDto>("/api/v1/privacy/summary"),
  });
}

export function useMyActions() {
  return useQuery({
    queryKey: ["audit", "actions"],
    enabled: !useMocks,
    queryFn: () => apiClient.get<AuditPage>("/api/v1/audit/actions?pageSize=30"),
  });
}

export function useExportData() {
  return useMutation({ mutationFn: () => apiClient.post<unknown>("/api/v1/privacy/export", {}) });
}

export function useRevokeAllConsents() {
  return useMutation({
    mutationFn: () => apiClient.post<{ revokedUserConsents: number; revokedFamilyConsents: number }>("/api/v1/privacy/revoke-all-consents", {}),
  });
}

export function useRequestDeletion() {
  return useMutation({ mutationFn: () => apiClient.post<{ requested: boolean }>("/api/v1/privacy/delete-account-request", {}) });
}
