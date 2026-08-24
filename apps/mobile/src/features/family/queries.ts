import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMocks } from "@/lib/env";
import { apiClient } from "@/services/api/client";
import type {
  CreateFamilyRequest,
  FamilyDto,
  FamilyInviteDto,
  FamilyMapMemberDto,
  FamilyMemberDto,
  FamilySummaryDto,
  MembershipStatus,
  RecordLocationRequest,
} from "@/services/api/types";
import { mockMembers, mockMemberCoords, type MockMember } from "@/lib/mockData";
import { getBatteryPercent, reverseGeocodeLabel } from "@/services/location/locationService";

/** View-model used by the Family screen: presentation fields + the membership
 *  state and ids needed for the approve/reject actions. */
export interface FamilyMemberVM extends MockMember {
  familyId: string;
  userId: string | null;
  avatarUrl: string | null;
  membershipStatus: MembershipStatus;
  /** The exact role name from the API (child/elder/member/guardian/admin) —
   *  unlike `role`, this isn't narrowed, so "member" stays "member". Used to
   *  show what a pending member declared they are at approval time. */
  declaredRole: string;
}

function mapDto(dto: FamilyMemberDto): FamilyMemberVM {
  return {
    id: dto.id,
    familyId: dto.familyId,
    userId: dto.userId ?? null,
    avatarUrl: dto.avatarUrl ?? null,
    membershipStatus: dto.membershipStatus,
    declaredRole: dto.role,
    name: dto.displayName,
    role: (dto.role === "guardian" || dto.role === "admin" || dto.role === "child" || dto.role === "elder"
      ? dto.role
      : "child") as MockMember["role"],
    status: dto.status,
    locationLabel: dto.lastLocationLabel ?? "—",
    battery: dto.batteryLevel ?? 0,
    lastSeen: dto.lastSeenAt ?? "",
  };
}

async function fetchMembers(): Promise<FamilyMemberVM[]> {
  if (useMocks) {
    // Mock data with a small delay to exercise loading states. Disable via
    // EXPO_PUBLIC_USE_MOCKS=false to hit the real API.
    await new Promise((r) => setTimeout(r, 300));
    return mockMembers.map((m) => ({ ...m, familyId: "mock", userId: null, avatarUrl: null, declaredRole: m.role, membershipStatus: "active" as MembershipStatus }));
  }
  const dtos = await apiClient.get<FamilyMemberDto[]>("/api/v1/families/members");
  return dtos.map(mapDto);
}

export function useFamilyMembers() {
  return useQuery({ queryKey: ["family", "members"], queryFn: fetchMembers });
}

/** Member view-model carrying their last known position for the map. */
export interface FamilyMapMemberVM extends FamilyMemberVM {
  latitude: number | null;
  longitude: number | null;
  canViewLocation: boolean;
  locationCapturedAt: string | null;
}

function mapMapDto(dto: FamilyMapMemberDto): FamilyMapMemberVM {
  return {
    ...mapDto(dto),
    latitude: dto.latitude ?? null,
    longitude: dto.longitude ?? null,
    canViewLocation: dto.canViewLocation,
    locationCapturedAt: dto.locationCapturedAt ?? null,
  };
}

async function fetchFamilyMap(): Promise<FamilyMapMemberVM[]> {
  if (useMocks) {
    await new Promise((r) => setTimeout(r, 300));
    return mockMembers.map((m, i) => ({
      ...m,
      familyId: "mock",
      userId: null,
      avatarUrl: null,
      declaredRole: m.role,
      membershipStatus: "active" as MembershipStatus,
      latitude: mockMemberCoords[i % mockMemberCoords.length].latitude,
      longitude: mockMemberCoords[i % mockMemberCoords.length].longitude,
      canViewLocation: true,
      locationCapturedAt: new Date().toISOString(),
    }));
  }
  const dtos = await apiClient.get<FamilyMapMemberDto[]>("/api/v1/families/map");
  return dtos.map(mapMapDto);
}

export function useFamilyMap() {
  return useQuery({ queryKey: ["family", "map"], queryFn: fetchFamilyMap });
}

/** Report the device's current position to the backend (presence + map).
 *  Enriches every report with the battery level and a reverse-geocoded place
 *  label (both best-effort) — the "Bateria"/"Último lugar" columns had no
 *  writer at all before, which is why they always read "—". Done here so all
 *  three callers (home, child, elder) benefit without repeating themselves. */
export function useReportLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (req: RecordLocationRequest) => {
      const [batteryLevel, locationLabel] = await Promise.all([
        req.batteryLevel !== undefined ? Promise.resolve(req.batteryLevel) : getBatteryPercent(),
        reverseGeocodeLabel({ latitude: req.latitude, longitude: req.longitude }),
      ]);
      return apiClient.post("/api/v1/locations", {
        ...req,
        ...(batteryLevel != null ? { batteryLevel } : {}),
        ...(locationLabel ? { locationLabel } : {}),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["family"] });
    },
  });
}

/** Guardian sets (or clears, with null) a member's photo — the child's own
 *  device rarely does it, and the face is what the guardian's screens show. */
export function useSetMemberAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      familyId,
      memberId,
      avatarUrl,
    }: {
      familyId: string;
      memberId: string;
      avatarUrl: string | null;
    }) => apiClient.put(`/api/v1/families/${familyId}/members/${memberId}/avatar`, { avatarUrl }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["family"] }),
  });
}

export function useApproveMember() {
  const qc = useQueryClient();
  return useMutation({
    // `role` (child/elder/member/guardian) sets the member's app experience at
    // approval time; omitted keeps the role they joined with.
    mutationFn: ({ familyId, memberId, role }: { familyId: string; memberId: string; role?: string }) =>
      apiClient.post(`/api/v1/families/${familyId}/members/${memberId}/approve`, role ? { role } : undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["family"] });
    },
  });
}

/** Change an active member's role (admin only). */
export function useSetMemberRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ familyId, memberId, role }: { familyId: string; memberId: string; role: string }) =>
      apiClient.put(`/api/v1/families/${familyId}/members/${memberId}/role`, { role }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["family"] });
      qc.invalidateQueries({ queryKey: ["profile"] });
    },
  });
}

export function useRejectMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ familyId, memberId }: { familyId: string; memberId: string }) =>
      apiClient.post(`/api/v1/families/${familyId}/members/${memberId}/reject`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["family"] });
    },
  });
}

async function fetchMyFamilies(): Promise<FamilySummaryDto[]> {
  if (useMocks) return [];
  return apiClient.get<FamilySummaryDto[]>("/api/v1/families");
}

export function useMyFamilies() {
  return useQuery({ queryKey: ["family", "list"], queryFn: fetchMyFamilies });
}

export function useCreateFamily() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: CreateFamilyRequest) => apiClient.post<FamilyDto>("/api/v1/families", req),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["family"] });
      // Creating a family makes the caller its admin — refetch so onboarding's
      // "member with zero memberships" profile flips to "guardian" right away.
      qc.invalidateQueries({ queryKey: ["profile"] });
    },
  });
}

/** Fetch (creating if needed) the shareable invite for a family. */
export function useFamilyInvite() {
  return useMutation({
    mutationFn: (familyId: string) =>
      apiClient.get<FamilyInviteDto>(`/api/v1/families/${familyId}/invites/current`),
  });
}

export function useJoinFamily() {
  const qc = useQueryClient();
  return useMutation({
    // `role` carries the declared intent from onboarding (child/elder) so the
    // pending membership already knows who this is — the admin then just
    // accepts/rejects instead of re-picking the role.
    mutationFn: ({ inviteCode, role }: { inviteCode: string; role?: string }) =>
      apiClient.post<FamilyMemberDto>("/api/v1/families/join", role ? { inviteCode, role } : { inviteCode }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["family"] });
      // Joining creates a pending membership — refetch so a zero-membership
      // ("onboarding") profile flips to "pending" and the waiting screen shows.
      qc.invalidateQueries({ queryKey: ["profile"] });
    },
  });
}
