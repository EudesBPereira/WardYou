import { useEffect, useRef, useState } from "react";
import { Image, Platform } from "react-native";
import { Marker, type MapMarker, type LatLng } from "react-native-maps";
import { colors } from "@/theme";
import { MapAvatarMarker } from "./MapAvatarMarker";

export interface AvatarMarkerProps {
  coordinate: LatLng;
  name: string;
  photoUri?: string | null;
  isMe?: boolean;
  isOnline?: boolean;
  title?: string;
  description?: string;
}

// How long to keep re-rasterizing the marker after something changed (or after
// the photo loads) before freezing the bitmap again.
const SETTLE_MS = 700;
const RING = 46;

/**
 * A react-native-maps <Marker> that renders the round avatar/photo pin.
 *
 * The photo MUST be a DIRECT child of <Marker>. On Android the marker is
 * rasterized into a bitmap, and Fresco (RN's Image backend) never loads inside
 * that offscreen subtree on its own — react-native-maps works around it with
 * `hackToHandleDraweeLifecycle` (manually attaching the Drawee controller and
 * re-capturing the icon when the final image lands), but that hack only checks
 * whether the marker's *direct* child is a DraweeView. With the photo nested
 * inside wrapper Views (the old pin layout) the hack never engaged, the image
 * never decoded, and every capture — regardless of `tracksViewChanges` or
 * `redraw()` — drew a permanently white circle.
 *
 * So: photo pins render the styled <Image> itself as the marker child (ring
 * via borderColor, no tail), and only the initials fallback keeps the custom
 * pin view (Text draws synchronously, so it never had the problem).
 *
 * Belt and braces on top (all Fabric-specific, see git history):
 * `tracksViewChanges` re-armed + settled on visible changes, and explicit
 * `redraw()` passes after the photo loads — the native `updated` counter only
 * moves on Marker prop changes, so nothing else forces a recapture.
 */
export function AvatarMarker({ coordinate, name, photoUri, isMe, isOnline = true, title, description }: AvatarMarkerProps) {
  const markerRef = useRef<MapMarker>(null);
  const [tracks, setTracks] = useState(true);
  const [imgFailed, setImgFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const redrawTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const settle = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setTracks(false), SETTLE_MS);
  };

  // Staggered so at least one pass runs after the image drawable is committed
  // and after any late marker re-creation (cheap: each is one bitmap capture).
  const forceRedraw = () => {
    if (Platform.OS !== "android") return;
    redrawTimers.current.forEach(clearTimeout);
    redrawTimers.current = [0, 250, 900].map((ms) =>
      setTimeout(() => markerRef.current?.redraw(), ms),
    );
  };

  const { latitude, longitude } = coordinate;
  useEffect(() => {
    setImgFailed(false);
  }, [photoUri]);
  useEffect(() => {
    setTracks(true);
    settle();
    forceRedraw();
    return () => {
      if (timer.current) clearTimeout(timer.current);
      redrawTimers.current.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoUri, imgFailed, latitude, longitude, isMe, isOnline]);

  const showPhoto = !!photoUri && !imgFailed;
  const ringColor = isMe ? colors.safe[600] : isOnline ? colors.brand[500] : colors["ink-subtle"];

  return (
    <Marker
      ref={markerRef}
      coordinate={coordinate}
      anchor={{ x: 0.5, y: 1 }}
      tracksViewChanges={tracks}
      title={title}
      description={description}
    >
      {showPhoto ? (
        <Image
          source={{ uri: photoUri! }}
          // No fade-in: a capture mid-fade would freeze a translucent photo.
          fadeDuration={0}
          onLoad={() => {
            settle();
            forceRedraw();
          }}
          onError={() => setImgFailed(true)}
          style={{
            width: RING,
            height: RING,
            borderRadius: RING / 2,
            borderWidth: 3,
            borderColor: ringColor,
            backgroundColor: "#FFFFFF",
          }}
        />
      ) : (
        <MapAvatarMarker
          name={name}
          photoUri={null}
          isMe={isMe}
          isOnline={isOnline}
          onReady={() => {
            settle();
            forceRedraw();
          }}
        />
      )}
    </Marker>
  );
}
