import { useMemo } from "react";
import { View, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { colors } from "@/theme";
import { useSession } from "@/stores/session";
import { useFamilyMap } from "@/features/family/queries";
import { TripLiveMap } from "@/features/trips/TripLiveMap";
import type { TripMapMemberDto } from "@/services/api/types";

/**
 * Fullscreen live map of the FAMILY — opened by tapping the map preview on the
 * home tab, mirroring the traveler-mode expanded map. Reuses TripLiveMap
 * (avatar pins, focus chips, center-all camera) by adapting the family-map
 * members to its member shape; data stays fresh via the ["family","map"] query
 * that realtime (ZoneTransition/SOS) and location reports already invalidate.
 */
export default function FamilyFullMapScreen() {
  const { t } = useTranslation();
  const session = useSession((s) => s.session);
  const { data: members, isLoading } = useFamilyMap();

  const mapMembers = useMemo<TripMapMemberDto[]>(
    () =>
      (members ?? []).map((m) => ({
        userId: m.userId ?? m.id,
        fullName: m.name,
        avatarUrl: m.avatarUrl,
        isMe: !!m.userId && m.userId === session?.userId,
        isCreator: false,
        isOnline: m.status === "online",
        canViewLocation: m.canViewLocation,
        latitude: m.latitude,
        longitude: m.longitude,
        batteryLevel: m.battery,
        capturedAt: m.locationCapturedAt,
      })),
    [members, session?.userId],
  );

  if (isLoading && !members) {
    return (
      <View className="flex-1 items-center justify-center bg-surface">
        <ActivityIndicator color={colors.brand[500]} />
      </View>
    );
  }

  return (
    <TripLiveMap
      tripName={t("home.mapTitle")}
      isActive
      members={mapMembers}
      onBack={() => router.back()}
    />
  );
}
