import { useCallback, useRef } from "react";
import { Pressable, View } from "react-native";
import MapView, { PROVIDER_GOOGLE } from "react-native-maps";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { colors } from "@/theme";
import type { MapPreviewProps } from "./MapPreview";
import { AvatarMarker } from "./AvatarMarker.native";

/** Padding around the pins when recentering on more than one. */
const FIT_PADDING = { top: 48, right: 48, bottom: 48, left: 48 };

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
  const { t } = useTranslation();
  const mapRef = useRef<MapView>(null);

  /**
   * Bring the camera back to the pin(s).
   *
   * An interactive preview (no `onPress`) sets only `initialRegion`, so the
   * camera never follows a refreshed position AND one drag leaves the person
   * you were looking for off-screen with no way back — the guardian's screen
   * for a child was exactly that: a map you could lose the child on. This is
   * the way back.
   */
  const recenter = useCallback(() => {
    const pins = markers.length > 0
      ? markers.map((m) => ({ latitude: m.latitude, longitude: m.longitude }))
      : [{ latitude, longitude }];
    if (pins.length === 1) {
      mapRef.current?.animateToRegion(
        { ...pins[0], latitudeDelta: 0.01, longitudeDelta: 0.01 },
        400,
      );
      return;
    }
    mapRef.current?.fitToCoordinates(pins, { edgePadding: FIT_PADDING, animated: true });
  }, [markers, latitude, longitude]);

  const map = (
    <MapView
      ref={mapRef}
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
    // Interactive preview: pan/zoom are enabled, so it needs a way home.
    return (
      <View className="overflow-hidden rounded-2xl" style={{ height }}>
        {map}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("map.recenter")}
          onPress={recenter}
          hitSlop={8}
          className="absolute bottom-3 right-3 h-11 w-11 items-center justify-center rounded-xl bg-white/95 shadow active:opacity-70"
        >
          <Ionicons name="locate" size={20} color={colors.brand[500]} />
        </Pressable>
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
