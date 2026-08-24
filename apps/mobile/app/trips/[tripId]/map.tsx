import { View, ActivityIndicator } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { colors } from "@/theme";
import { useTrip, useTripMap } from "@/features/trips/queries";
import { TripLiveMap } from "@/features/trips/TripLiveMap";

/** Fullscreen live map of a trip — data keeps flowing via the 20s poll plus
 *  the TravelLocationUpdated realtime invalidation; the map component owns
 *  camera/gestures (avatar pins, focus member, center all). */
export default function TripFullMapScreen() {
  const { t } = useTranslation();
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const { data: trip } = useTrip(tripId);
  const isActive = trip?.isActive ?? false;
  const { data: map, isLoading } = useTripMap(tripId, isActive);

  if (isLoading || !map) {
    return (
      <View className="flex-1 items-center justify-center bg-surface">
        <ActivityIndicator color={colors.brand[500]} />
      </View>
    );
  }

  return (
    <TripLiveMap
      tripName={map.name ?? trip?.name ?? t("trips.title")}
      isActive={isActive}
      members={map.members}
      onBack={() => router.back()}
    />
  );
}
