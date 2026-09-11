import { useEffect, useMemo, useRef } from "react";
import { Image, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MapView, { PROVIDER_GOOGLE, type LatLng } from "react-native-maps";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { Badge, Text } from "@/components/ui";
import { AvatarMarker } from "@/components/ui/AvatarMarker.native";
import { getInitials } from "@/components/ui/Avatar";
import { colors } from "@/theme";
import type { TripMapMemberDto } from "@/services/api/types";
import type { TripLiveMapProps } from "./TripLiveMap";
import { formatSeenAt } from "@/lib/formatTime";

// São Paulo — neutral start before anyone has a fix (same as the MAUI page).
const FALLBACK_REGION = {
  latitude: -23.5505,
  longitude: -46.6333,
  latitudeDelta: 0.09,
  longitudeDelta: 0.09,
};
const FIT_PADDING = { top: 120, right: 60, bottom: 240, left: 60 };

// Bug de campo #5: a bare time-of-day read as an impossible future timestamp
// for a stale, previous-day fix. formatSeenAt adds the date when it isn't
// today.
const fmtTime = formatSeenAt;

/**
 * Fullscreen live trip map — RN port of the MAUI TravelMapPage: avatar pins,
 * floating trip header, horizontal member chips (tap to focus), "center all"
 * and auto-fit when positions first arrive. Data (poll + realtime) comes from
 * the parent screen; this component owns only the camera and gestures.
 */
export function TripLiveMap({ tripName, isActive, members, onBack }: TripLiveMapProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const didFitRef = useRef(false);

  const located = useMemo(
    () => members.filter((m): m is TripMapMemberDto & { latitude: number; longitude: number } =>
      m.latitude != null && m.longitude != null),
    [members],
  );
  const coordinates: LatLng[] = located.map((m) => ({ latitude: m.latitude, longitude: m.longitude }));

  const fitAll = (animated = true) => {
    if (coordinates.length === 0) return;
    if (coordinates.length === 1) {
      mapRef.current?.animateCamera({ center: coordinates[0], zoom: 16 }, { duration: animated ? 500 : 0 });
      return;
    }
    mapRef.current?.fitToCoordinates(coordinates, { edgePadding: FIT_PADDING, animated });
  };

  // Auto-frame everyone the first time positions arrive.
  useEffect(() => {
    if (didFitRef.current || coordinates.length === 0) return;
    didFitRef.current = true;
    const timer = setTimeout(() => fitAll(false), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coordinates.length]);

  const focusMember = (m: TripMapMemberDto) => {
    if (m.latitude == null || m.longitude == null) return;
    mapRef.current?.animateCamera(
      { center: { latitude: m.latitude, longitude: m.longitude }, zoom: 16.5 },
      { duration: 450 },
    );
  };

  return (
    <View className="flex-1 bg-surface">
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={{ flex: 1 }}
        initialRegion={
          coordinates[0]
            ? { ...coordinates[0], latitudeDelta: 0.02, longitudeDelta: 0.02 }
            : FALLBACK_REGION
        }
        toolbarEnabled={false}
        showsCompass
        showsTraffic={false}
      >
        {located.map((m) => (
          <AvatarMarker
            key={m.userId}
            coordinate={{ latitude: m.latitude, longitude: m.longitude }}
            name={m.fullName}
            photoUri={m.avatarUrl}
            isMe={m.isMe}
            isOnline={m.isOnline}
            title={m.isMe ? t("trips.detail.you", { name: m.fullName }) : m.fullName}
            description={
              (m.capturedAt ? t("trips.detail.lastSeen", { time: fmtTime(m.capturedAt) }) : "") +
              (m.batteryLevel != null ? ` · ${m.batteryLevel}%` : "")
            }
          />
        ))}
      </MapView>

      {/* Floating header: back + trip name + live badge */}
      <View
        className="absolute left-4 right-4 flex-row items-center gap-3"
        style={{ top: insets.top + 8 }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("common.back")}
          onPress={onBack}
          className="h-11 w-11 items-center justify-center rounded-full bg-white shadow active:opacity-80"
        >
          <Ionicons name="chevron-back" size={22} color={colors.ink} />
        </Pressable>
        <View className="flex-1 flex-row items-center gap-2 rounded-2xl bg-white/95 px-4 py-2.5 shadow">
          <View className="flex-1">
            <Text variant="title" numberOfLines={1}>
              {tripName}
            </Text>
            <Text variant="caption" color="muted">
              {t("trips.members", { count: members.length })}
            </Text>
          </View>
          {isActive ? <Badge label={t("trips.detail.live")} tone="safe" /> : null}
        </View>
      </View>

      {/* Bottom panel: member chips + center-all (port of the MAUI bottom bar) */}
      <View
        className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-white/95 px-4 pt-4 shadow-lg"
        style={{ paddingBottom: insets.bottom + 12 }}
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2.5 pr-2">
          {members.map((m) => {
            const hasFix = m.latitude != null && m.longitude != null;
            const seen = m.capturedAt
              ? t("trips.detail.lastSeen", { time: fmtTime(m.capturedAt) })
              : m.canViewLocation
                ? t("trips.detail.noFix")
                : t("trips.detail.locationHidden");
            return (
              <Pressable
                key={m.userId}
                accessibilityRole="button"
                disabled={!hasFix}
                onPress={() => focusMember(m)}
                className={`flex-row items-center gap-2.5 rounded-2xl border border-border px-3 py-2 active:opacity-70 ${
                  hasFix ? "bg-surface" : "bg-surface-alt opacity-60"
                }`}
              >
                {(() => {
                  const ring = m.isMe
                    ? colors.safe[600]
                    : m.isOnline
                      ? colors.brand[500]
                      : colors["ink-subtle"];
                  // Photo (from profile or Google) when we have one; the colored
                  // ring still carries the me/online cue. Falls back to initials.
                  return m.avatarUrl ? (
                    <Image
                      source={{ uri: m.avatarUrl }}
                      accessibilityLabel={m.fullName}
                      className="h-9 w-9 rounded-full"
                      style={{ borderWidth: 2, borderColor: ring }}
                    />
                  ) : (
                    <View
                      className="h-9 w-9 items-center justify-center rounded-full"
                      style={{ backgroundColor: ring }}
                    >
                      <Text variant="label" color="inverse">
                        {getInitials(m.fullName)}
                      </Text>
                    </View>
                  );
                })()}
                <View style={{ maxWidth: 140 }}>
                  <Text variant="label" numberOfLines={1}>
                    {m.isMe ? t("trips.detail.you", { name: m.fullName }) : m.fullName}
                  </Text>
                  <Text variant="caption" color="muted" numberOfLines={1}>
                    {seen}
                    {m.batteryLevel != null ? ` · ${m.batteryLevel}%` : ""}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>

        <Pressable
          accessibilityRole="button"
          onPress={() => fitAll()}
          disabled={coordinates.length === 0}
          className={`mt-3 flex-row items-center justify-center gap-2 rounded-2xl py-3 active:opacity-80 ${
            coordinates.length === 0 ? "bg-surface-alt" : "bg-brand-500"
          }`}
        >
          <Ionicons
            name="scan"
            size={18}
            color={coordinates.length === 0 ? colors["ink-subtle"] : "#FFFFFF"}
          />
          <Text variant="label" color={coordinates.length === 0 ? "subtle" : "inverse"}>
            {t("trips.map.centerAll")}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
