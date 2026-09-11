import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMocks } from "@/lib/env";
import { apiClient } from "@/services/api/client";
import { formatDateTime } from "@/lib/formatTime";
import i18n from "@/i18n";
import type {
  CreateTripRequest,
  TripDto,
  TripInviteDto,
  TripMapDto,
  TripMemberDto,
  UpdateTripRequest,
} from "@/services/api/types";
import { mockTrips, mockMembers, mockMemberCoords, type MockTrip } from "@/lib/mockData";

function mapDto(dto: TripDto): MockTrip {
  return {
    id: dto.id,
    name: dto.name,
    type: dto.type,
    status: dto.isActive ? "active" : "closed",
    memberCount: dto.memberCount,
    // Achado de QA 2026-09-11: `toLocaleString([], ...)` usa o idioma do
    // SISTEMA, nao o do app -- ver formatDateTime em src/lib/formatTime.ts
    // para o caso mais grave (closedLabel abaixo, sem opcoes nenhuma).
    endsLabel: dto.isActive
      ? new Date(dto.endsAt).toLocaleString(i18n.language, {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
      : undefined,
    closedLabel: dto.closedAt ? formatDateTime(dto.closedAt) : undefined,
  };
}

async function fetchTrips(): Promise<MockTrip[]> {
  if (useMocks) {
    await new Promise((r) => setTimeout(r, 300));
    return mockTrips;
  }
  const dtos = await apiClient.get<TripDto[]>("/api/v1/travels");
  return dtos.map(mapDto);
}

export function useTrips(enabled = true) {
  return useQuery({ queryKey: ["trips"], queryFn: fetchTrips, enabled });
}

export function useCreateTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: CreateTripRequest) => apiClient.post<TripDto>("/api/v1/travels", req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trips"] });
    },
  });
}

export function useTrip(tripId: string | undefined) {
  return useQuery({
    queryKey: ["trips", tripId],
    enabled: !!tripId,
    queryFn: async (): Promise<TripDto | undefined> => {
      if (useMocks) {
        const m = mockTrips.find((tr) => tr.id === tripId);
        if (!m) return undefined;
        return {
          id: m.id,
          name: m.name,
          type: m.type,
          isActive: m.status === "active",
          startsAt: new Date().toISOString(),
          endsAt: new Date(Date.now() + 3600_000).toISOString(),
          memberCount: m.memberCount,
          closedAt: null,
        };
      }
      return apiClient.get<TripDto>(`/api/v1/travels/${tripId}`);
    },
  });
}

export function useTripMembers(tripId: string | undefined) {
  return useQuery({
    queryKey: ["trips", tripId, "members"],
    enabled: !!tripId,
    queryFn: async (): Promise<TripMemberDto[]> => {
      if (useMocks) {
        return mockMembers.slice(0, 3).map((m, i) => ({
          id: m.id,
          userId: m.id,
          fullName: m.name,
          isCreator: i === 0,
          isMe: i === 0,
          shareLiveLocation: true,
          shareBatteryStatus: i !== 2,
          receiveSosAlerts: true,
          joinedAt: new Date().toISOString(),
        }));
      }
      return apiClient.get<TripMemberDto[]>(`/api/v1/travels/${tripId}/members`);
    },
  });
}

/** Trip map with the latest position per member. Polls while mounted so the
 *  markers move even without a realtime event (which also invalidates this).
 *  10s matches the senders' live cadence — realtime usually lands first, the
 *  poll is the safety net when the socket is down. */
export function useTripMap(tripId: string | undefined, active = true) {
  return useQuery({
    queryKey: ["trips", tripId, "map"],
    enabled: !!tripId,
    refetchInterval: active ? 10_000 : false,
    queryFn: async (): Promise<TripMapDto | undefined> => {
      if (useMocks) {
        const m = mockTrips.find((tr) => tr.id === tripId);
        if (!m) return undefined;
        return {
          travelGroupId: m.id,
          name: m.name,
          startsAt: new Date().toISOString(),
          endsAt: new Date(Date.now() + 3600_000).toISOString(),
          isActive: m.status === "active",
          allowMembersToSeeEachOther: true,
          createdByUserId: mockMembers[0]?.id ?? "me",
          members: mockMembers.slice(0, 3).map((mm, i) => ({
            userId: mm.id,
            fullName: mm.name,
            avatarUrl: null,
            isMe: i === 0,
            isCreator: i === 0,
            isOnline: i !== 2,
            canViewLocation: true,
            latitude: mockMemberCoords[i % mockMemberCoords.length].latitude,
            longitude: mockMemberCoords[i % mockMemberCoords.length].longitude,
            batteryLevel: mm.battery,
            capturedAt: new Date().toISOString(),
          })),
        };
      }
      return apiClient.get<TripMapDto>(`/api/v1/travels/${tripId}/map`);
    },
  });
}

export function useUpdateTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tripId, ...req }: UpdateTripRequest & { tripId: string }) =>
      apiClient.put<TripDto>(`/api/v1/travels/${tripId}`, req),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["trips"] });
      qc.invalidateQueries({ queryKey: ["trips", vars.tripId] });
    },
  });
}

export function useCloseTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tripId: string) => apiClient.post<TripDto>(`/api/v1/travels/${tripId}/close`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trips"] });
    },
  });
}

/** Permanently delete a trip (creator only) — removes it from history. */
export function useDeleteTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tripId: string) => apiClient.del(`/api/v1/travels/${tripId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trips"] });
    },
  });
}

export function useLeaveTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tripId: string) => apiClient.post(`/api/v1/travels/${tripId}/leave`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trips"] });
    },
  });
}

/** Create a shareable invite for a trip (creator only). */
export function useTripInvite() {
  return useMutation({
    mutationFn: (tripId: string) => apiClient.post<TripInviteDto>(`/api/v1/travels/${tripId}/invites`),
  });
}

export function useJoinTrip() {
  const qc = useQueryClient();
  return useMutation({
    // Accept a travel invite code. Server adds the user as an active member.
    mutationFn: (inviteCode: string) =>
      apiClient.post(`/api/v1/travels/invites/${encodeURIComponent(inviteCode)}/accept`, {
        shareLiveLocation: true,
        shareBatteryStatus: true,
        receiveSosAlerts: true,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trips"] });
    },
  });
}
