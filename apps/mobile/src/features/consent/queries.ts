import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMocks } from "@/lib/env";
import { apiClient } from "@/services/api/client";

export type ConsentTypeName =
  | "LocationSharing"
  | "LiveLocation"
  | "DataAccess"
  | "Notifications"
  | "DeviceStatus"
  | "BatteryStatus"
  | "PreciseLocation"
  | "SosReceive";

// Only the consents that actually gate behaviour in the current backend are
// surfaced. LocationSharing (map/device visibility) + BatteryStatus (battery on
// map) drive real gating; SosReceive (family emergency alerts) and DataAccess
// (LGPD data processing) are kept for product/legal reasons. The dead ones
// (PreciseLocation → device-level, LiveLocation/DeviceStatus/Notifications →
// not ported to the Node stack) are hidden to avoid redundant, no-op switches.
export const CONSENT_TYPES: ConsentTypeName[] = [
  "LocationSharing",
  "BatteryStatus",
  "SosReceive",
  "DataAccess",
];

export interface ConsentDto {
  id: string;
  type: ConsentTypeName;
  version: string;
  isActive: boolean;
  grantedAt: string;
  revokedAt: string | null;
}

const CONSENT_VERSION = "1.0";

async function fetchConsents(): Promise<ConsentDto[]> {
  if (useMocks) return [];
  return apiClient.get<ConsentDto[]>("/api/v1/consents");
}

export function useConsents() {
  return useQuery({ queryKey: ["consents"], queryFn: fetchConsents });
}

export function useSetConsent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ type, active }: { type: ConsentTypeName; active: boolean }) =>
      active
        ? apiClient.post(`/api/v1/consents/${type}/accept`, { version: CONSENT_VERSION })
        : apiClient.post(`/api/v1/consents/${type}/revoke`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["consents"] });
      qc.invalidateQueries({ queryKey: ["family", "map"] });
    },
  });
}

// ── Family consents (admin grants on behalf of a member) ──────────────────
export interface FamilyConsentDto {
  id: string;
  type: ConsentTypeName;
  userId: string;
  isActive: boolean;
  grantedAt: string;
}

export function useFamilyConsents(familyId: string | undefined) {
  return useQuery({
    queryKey: ["family-consents", familyId],
    enabled: !!familyId && !useMocks,
    queryFn: () => apiClient.get<FamilyConsentDto[]>(`/api/v1/families/${familyId}/consents`),
  });
}

export function useGrantFamilyConsent(familyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, type }: { userId: string; type: ConsentTypeName }) =>
      apiClient.post(`/api/v1/families/${familyId}/members/${userId}/consent`, { type, version: CONSENT_VERSION }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["family-consents", familyId] });
      qc.invalidateQueries({ queryKey: ["family", "map"] });
    },
  });
}
