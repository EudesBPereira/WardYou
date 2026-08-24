import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "@/components/ui";
import { colors } from "@/theme";
import type { TripMapMemberDto } from "@/services/api/types";

export interface TripLiveMapProps {
  tripName: string;
  isActive: boolean;
  members: TripMapMemberDto[];
  onBack: () => void;
}

// Web fallback — the interactive fullscreen map is native-only (react-native-maps).
// The native implementation lives in TripLiveMap.native.tsx.
export function TripLiveMap({ tripName, members }: TripLiveMapProps) {
  const { t } = useTranslation();
  const located = members.filter((m) => m.latitude != null && m.longitude != null);
  return (
    <View className="flex-1 items-center justify-center gap-2 bg-surface-alt px-8">
      <Ionicons name="map" size={36} color={colors["ink-subtle"]} />
      <Text variant="title">{tripName}</Text>
      <Text variant="caption" color="muted" className="text-center">
        {t("trips.map.webUnavailable", { count: located.length })}
      </Text>
    </View>
  );
}
