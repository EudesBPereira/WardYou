import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMocks } from "@/lib/env";
import { apiClient } from "@/services/api/client";
import { useSession } from "@/stores/session";

/** Which experience the app renders. Derived server-side from family roles:
 *  child (most restricted, always wins) > elder > guardian/admin > member.
 *  `pending` (joined a family, awaiting an admin's approval + role) and
 *  `onboarding` (no family membership at all yet) never fall back to the full
 *  adult experience — see profileService.ts on the API. */
export type AppProfile = "child" | "elder" | "guardian" | "member" | "pending" | "onboarding";

export interface ProfileDto {
  userId: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
  appProfile: AppProfile;
  families: {
    familyId: string;
    familyName: string;
    role: string;
    membershipStatus: "pending" | "active";
  }[];
}

async function fetchMyProfile(): Promise<ProfileDto> {
  if (useMocks) {
    const s = useSession.getState().session;
    return {
      userId: s?.userId ?? "mock",
      fullName: s?.fullName ?? "Guardião",
      email: s?.email ?? "mock@wardyou.com",
      avatarUrl: null,
      appProfile: "guardian",
      families: [],
    };
  }
  return apiClient.get<ProfileDto>("/api/v1/profile/me");
}

/**
 * The profile drives the whole shell (tabs, home screen, settings), so cache
 * it aggressively; role changes invalidate via ["profile"] on realtime/family
 * mutations or at next app start.
 */
export function useMyProfile() {
  const status = useSession((s) => s.status);
  return useQuery({
    queryKey: ["profile", "me"],
    enabled: status === "authenticated",
    staleTime: 5 * 60_000,
    queryFn: fetchMyProfile,
  });
}

/**
 * Set (or clear, with null) the caller's profile photo. Updates the persisted
 * session avatar and invalidates the profile + trips caches so the new picture
 * shows up immediately on the profile screen and on every trip map/list.
 */
export function useUpdateAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (avatarUrl: string | null) =>
      apiClient.put<{ avatarUrl: string | null }>("/api/v1/profile/me/avatar", { avatarUrl }),
    onSuccess: async (res) => {
      await useSession.getState().setAvatarUrl(res.avatarUrl);
      qc.invalidateQueries({ queryKey: ["profile", "me"] });
      qc.invalidateQueries({ queryKey: ["trips"] });
    },
  });
}
