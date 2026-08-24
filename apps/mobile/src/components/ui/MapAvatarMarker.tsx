import { useState } from "react";
import { Image, View } from "react-native";
import { colors } from "@/theme";
import { Text } from "./Text";
import { getInitials } from "./Avatar";

export interface MapAvatarMarkerProps {
  name: string;
  /** Profile photo; when present it replaces the initials on the pin. */
  photoUri?: string | null;
  /** The signed-in user gets a distinct (green) ring. */
  isMe?: boolean;
  /** Greyed ring when the member has no recent fix. */
  isOnline?: boolean;
  /** Fired once the pin has fully laid out / the photo loaded, so the parent
   *  <Marker> can stop re-snapshotting the view (tracksViewChanges → false). */
  onReady?: () => void;
}

const RING = 46;

/**
 * Custom map pin: a round avatar (profile photo or initials) with a colored
 * ring and a small tail — RN port of the MAUI native avatar marker. Padding
 * around the circle keeps Android from clipping the marker bitmap, and the
 * onReady/onLayout handshake lets the parent capture the fully-rendered view
 * before freezing it.
 */
export function MapAvatarMarker({ name, photoUri, isMe = false, isOnline = true, onReady }: MapAvatarMarkerProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const ringColor = isMe ? colors.safe[600] : isOnline ? colors.brand[500] : colors["ink-subtle"];
  const showPhoto = !!photoUri && !imgFailed;

  return (
    // Extra padding so the shadow/ring never touches the bitmap edge (Android
    // clips markers to the captured view bounds).
    <View style={{ paddingHorizontal: 6, paddingTop: 6, paddingBottom: 2, alignItems: "center" }}>
      <View
        onLayout={() => {
          // For the initials pin the view is ready as soon as it lays out; the
          // photo pin additionally waits for onLoad below.
          if (!photoUri) onReady?.();
        }}
        style={{
          width: RING,
          height: RING,
          borderRadius: RING / 2,
          borderWidth: 3,
          borderColor: ringColor,
          backgroundColor: showPhoto ? "#FFFFFF" : ringColor,
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          elevation: 5,
          shadowColor: "#000",
          shadowOpacity: 0.3,
          shadowRadius: 3,
          shadowOffset: { width: 0, height: 2 },
        }}
      >
        {showPhoto ? (
          <Image
            source={{ uri: photoUri! }}
            // No fade-in: the marker bitmap is captured right after onLoad, and
            // Android's default 300ms fade would freeze a semi-transparent photo.
            fadeDuration={0}
            onLoad={() => onReady?.()}
            onError={() => {
              setImgFailed(true);
              onReady?.();
            }}
            style={{ width: RING - 6, height: RING - 6, borderRadius: (RING - 6) / 2 }}
          />
        ) : (
          <Text variant="label" color="inverse">
            {getInitials(name)}
          </Text>
        )}
      </View>
      {/* Tail */}
      <View
        style={{
          width: 0,
          height: 0,
          marginTop: -2,
          borderLeftWidth: 6,
          borderRightWidth: 6,
          borderTopWidth: 9,
          borderLeftColor: "transparent",
          borderRightColor: "transparent",
          borderTopColor: ringColor,
        }}
      />
    </View>
  );
}
