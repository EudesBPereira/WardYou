import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMocks } from "@/lib/env";
import { apiClient } from "@/services/api/client";

export interface ZoneDto {
  id: string;
  familyId: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  notifyOnEntry: boolean;
  notifyOnExit: boolean;
  isActive: boolean;
  createdAt: string;
  memberUserIds: string[];
}

export interface CreateZoneInput {
  familyId: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  notifyOnEntry?: boolean;
  notifyOnExit?: boolean;
}

async function fetchZones(familyId?: string): Promise<ZoneDto[]> {
  if (useMocks || !familyId) return [];
  return apiClient.get<ZoneDto[]>(`/api/v1/zones?familyId=${familyId}`);
}

export function useZones(familyId?: string) {
  return useQuery({ queryKey: ["zones", familyId], queryFn: () => fetchZones(familyId), enabled: !!familyId });
}

export function useCreateZone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateZoneInput) => apiClient.post<ZoneDto>("/api/v1/zones", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["zones"] }),
  });
}

export interface UpdateZoneInput extends CreateZoneInput {
  zoneId: string;
  memberUserIds?: string[];
}

export function useUpdateZone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ zoneId, ...body }: UpdateZoneInput) => apiClient.put<ZoneDto>(`/api/v1/zones/${zoneId}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["zones"] }),
  });
}

export function useDeleteZone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (zoneId: string) => apiClient.del(`/api/v1/zones/${zoneId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["zones"] }),
  });
}
