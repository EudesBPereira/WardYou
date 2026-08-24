import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMocks } from "@/lib/env";
import { apiClient } from "@/services/api/client";
import type { SosEventDto, TriggerSosRequest } from "@/services/api/types";

/** The user's currently active SOS events (for showing an "active" banner). */
export function useActiveSos() {
  return useQuery({
    queryKey: ["sos", "active"],
    enabled: !useMocks,
    queryFn: () => apiClient.get<SosEventDto[]>("/api/v1/sos/active"),
  });
}

/** Trigger an SOS. Optionally attaches the current position and a family. */
export function useTriggerSos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: TriggerSosRequest) => apiClient.post<SosEventDto>("/api/v1/sos", req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sos"] });
    },
  });
}

/** Close an active SOS event. */
export function useCloseSos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sosId: string) => apiClient.put<SosEventDto>(`/api/v1/sos/${sosId}/close`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sos"] });
    },
  });
}
