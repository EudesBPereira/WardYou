import { Pressable, View } from "react-native";
import MapView, { PROVIDER_GOOGLE } from "react-native-maps";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/theme";
import type { MapPreviewProps } from "./MapPreview";
import { AvatarMarker } from "./AvatarMarker.native";

// Native implementation (Android/iOS) using react-native-maps with the Google
// provider. Requires the native Maps API keys in app.config.ts. Members render
// as round avatar pins (initials) instead of the stock red pin.
export function MapPreview({
  latitude,
  longitude,
  height = 200,
  markers = [],
  onPress,
}: MapPreviewProps) {
  const map = (
    <MapView
      provider={PROVIDER_GOOGLE}
      style={{ flex: 1 }}
      // A tappable preview is a static thumbnail — interaction happens on the
      // fullscreen map it opens.
      scrollEnabled={!onPress}
      zoomEnabled={!onPress}
      rotateEnabled={!onPress}
      pitchEnabled={!onPress}
      toolbarEnabled={false}
      initialRegion={{
        latitude,
        longitude,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      }}
    >
      {markers.map((m) => (
        <AvatarMarker
          key={m.id}
          coordinate={{ latitude: m.latitude, longitude: m.longitude }}
          title={m.label}
          name={m.label ?? "?"}
          photoUri={m.photoUri}
          isMe={m.isMe}
          isOnline={m.isOnline ?? true}
        />
      ))}
    </MapView>
  );

  if (!onPress) {
    return (
      <View className="overflow-hidden rounded-2xl" style={{ height }}>
        {map}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="overflow-hidden rounded-2xl active:opacity-90"
      style={{ height }}
    >
      {map}
      {/* Expand affordance */}
      <View className="absolute right-3 top-3 h-9 w-9 items-center justify-center rounded-xl bg-white/90 shadow">
        <Ionicons name="expand" size={18} color={colors.ink} />
      </View>
      {/* Transparent layer so the Pressable receives the tap, not the map */}
      <View className="absolute inset-0" />
    </Pressable>
  );
}
