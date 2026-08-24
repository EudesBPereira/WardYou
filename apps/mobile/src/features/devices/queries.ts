import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMocks } from "@/lib/env";
import { apiClient } from "@/services/api/client";

export interface DeviceDto {
  id: string;
  userId: string;
  deviceName: string;
  platform: string;
  isActive: boolean;
  sharePreciseLocation: boolean;
  isOnline: boolean;
  batteryLevel: number | null;
  latitude: number | null;
  longitude: number | null;
  lastSeenAt: string | null;
  locationCapturedAt: string | null;
}

export function useMyDevices() {
  return useQuery({
    queryKey: ["devices"],
    queryFn: () => (useMocks ? Promise.resolve<DeviceDto[]>([]) : apiClient.get<DeviceDto[]>("/api/v1/devices")),
  });
}

export function useCreateDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { deviceName: string; platform: string; sharePreciseLocation?: boolean }) =>
      apiClient.post<DeviceDto>("/api/v1/devices", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["devices"] }),
  });
}

export function useUpdateDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; deviceName: string; sharePreciseLocation: boolean; isActive: boolean }) =>
      apiClient.put<DeviceDto>(`/api/v1/devices/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["devices"] }),
  });
}

export function useDeleteDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.del(`/api/v1/devices/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["devices"] }),
  });
}

/** Register a device's push token (PUT /devices/push-token). */
export function useRegisterPushToken() {
  return useMutation({
    mutationFn: (input: { deviceId: string; pushToken: string; pushLanguage?: string }) =>
      apiClient.put("/api/v1/devices/push-token", input),
  });
}
