import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/theme";
import { Text } from "./Text";

export interface MapMarker {
  id: string;
  latitude: number;
  longitude: number;
  label?: string;
  /** Profile photo; shown on the pin instead of initials when present. */
  photoUri?: string | null;
  /** Distinct pin for the signed-in user. */
  isMe?: boolean;
  /** Greyed-out pin when the member has no recent fix. */
  isOnline?: boolean;
}

export interface MapPreviewProps {
  latitude: number;
  longitude: number;
  height?: number;
  markers?: MapMarker[];
  /** When set, the preview is a static thumbnail that opens something bigger. */
  onPress?: () => void;
}

// Web (and TypeScript) implementation. `react-native-maps` does not run on web,
// so we render a styled placeholder. Wire @vis.gl/react-google-maps here once
// EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY is provided. The native map lives in
// MapPreview.native.tsx (Metro resolves it on device).
export function MapPreview({ height = 200, markers = [], onPress }: MapPreviewProps) {
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      className="items-center justify-center overflow-hidden rounded-2xl bg-surface-alt"
      style={{ height }}
    >
      <Ionicons name="map" size={28} color={colors["ink-subtle"]} />
      <Text variant="caption" color="muted" className="mt-2">
        Map preview (web)
      </Text>
      {markers.length > 0 ? (
        <Text variant="caption" color="subtle">
          {markers.length} marker{markers.length > 1 ? "s" : ""}
        </Text>
      ) : null}
    </Pressable>
  );
}
