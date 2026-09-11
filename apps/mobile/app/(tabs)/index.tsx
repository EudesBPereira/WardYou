import { useEffect } from "react";
import { View, Pressable } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import {
  ScreenContainer,
  Card,
  Text,
  Avatar,
  Badge,
  MapPreview,
} from "@/components/ui";
import type { MapMarker } from "@/components/ui";
import { colors } from "@/theme";
import { useMocks } from "@/lib/env";
import { useFamilyMap, useReportLocation } from "@/features/family/queries";
import { getCurrentPosition } from "@/services/location/locationService";
import { useMyProfile } from "@/features/profile/queries";
import { useOnboardingStore } from "@/stores/onboarding";
import { ChildHome } from "@/features/home/ChildHome";
import { ProtectionStatusCard } from "@/features/protection/ProtectionStatusCard";
import { ElderHome } from "@/features/home/ElderHome";
import { ProfileButton } from "@/components/ProfileButton";

/** Report this device's position on open so the family map / trip companion and
 *  presence stay fresh. Best-effort; skipped in mock mode. */
function useReportLocationOnOpen() {
  const reportLocation = useReportLocation();
  useEffect(() => {
    if (useMocks) return;
    let cancelled = false;
    getCurrentPosition().then((coords) => {
      if (cancelled || !coords) return;
      reportLocation.mutate({
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracyMeters: coords.accuracy,
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

type Quick = {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  titleKey: string;
  subtitleKey: string;
  href: string;
  tone: "brand" | "safe" | "danger" | "night";
};

const CARDS: Quick[] = [
  { key: "family", icon: "people", titleKey: "home.family.title", subtitleKey: "home.family.subtitle", href: "/family", tone: "brand" },
  { key: "parental", icon: "shield-checkmark", titleKey: "home.parental.title", subtitleKey: "home.parental.subtitle", href: "/parental", tone: "safe" },
  { key: "trips", icon: "navigate", titleKey: "home.trips.title", subtitleKey: "home.trips.subtitle", href: "/trips", tone: "night" },
  { key: "sos", icon: "warning", titleKey: "home.sos.title", subtitleKey: "home.sos.subtitle", href: "/sos", tone: "danger" },
];

const iconBg: Record<Quick["tone"], string> = {
  brand: "bg-brand-50",
  safe: "bg-safe-50",
  danger: "bg-danger-50",
  night: "bg-surface-alt",
};
const iconHex: Record<Quick["tone"], string> = {
  brand: colors.brand[500],
  safe: colors.safe[600],
  danger: colors.danger[500],
  night: colors.ink,
};

// São Paulo — last-resort map center when no member has shared a position yet.
const FALLBACK_CENTER = { latitude: -23.5505, longitude: -46.6333 };

/** The home tab renders a different experience per app profile: children get
 *  the screen-time view, elders the simplified big-button view, travelers a
 *  trip-focused view, and adults the full family dashboard below. */
export default function HomeScreen() {
  const { data: profile } = useMyProfile();
  const modeByUserId = useOnboardingStore((s) => s.modeByUserId);
  if (profile?.appProfile === "child") return <ChildHome />;
  if (profile?.appProfile === "elder") return <ElderHome />;
  // A traveler (adult who onboarded without a family) doesn't manage a family,
  // so the family map/members make no sense — give them a trips-focused home.
  if (profile?.appProfile === "onboarding" && modeByUserId[profile.userId] === "traveler") {
    return <TravelerHome />;
  }
  // Only admins/guardians can approve pending join requests.
  return (
    <AdultHome
      canApprove={profile?.appProfile === "guardian"}
      hasFamily={(profile?.families.length ?? 0) > 0}
    />
  );
}

function AdultHome({ canApprove, hasFamily }: { canApprove: boolean; hasFamily: boolean }) {
  const { t } = useTranslation();
  const { data: allMembers = [] } = useFamilyMap();
  useReportLocationOnOpen();

  // A member awaiting approval isn't a full family member yet: keep them out of
  // the map/list and surface them via the approval banner instead.
  const members = allMembers.filter((m) => m.membershipStatus === "active");
  const pending = allMembers.filter((m) => m.membershipStatus === "pending");

  const sharing = members.filter((m) => m.status !== "offline").length;
  const hasAlert = members.some((m) => m.status === "alert");

  const markers: MapMarker[] = members
    .filter((m) => m.latitude !== null && m.longitude !== null)
    .map((m) => ({
      id: m.id,
      latitude: m.latitude as number,
      longitude: m.longitude as number,
      label: m.name,
      photoUri: m.avatarUrl,
      isOnline: m.status !== "offline",
    }));
  const center = markers[0] ?? FALLBACK_CENTER;

  return (
    <ScreenContainer>
      {/* Title + account avatar (scrolls with the header, not a fixed overlay) */}
      <View className="flex-row items-center gap-3 py-2">
        <View className="flex-1">
          <Text variant="h1">WardYou</Text>
        </View>
        <ProfileButton />
      </View>

      {/* Estado da protecao tambem no aparelho do responsavel: GPS desligado,
          permissao negada ou push bloqueado AQUI quebram o produto do mesmo
          jeito — o pai deixa de ver a familia e de receber alerta de SOS. */}
      <ProtectionStatusCard modoCrianca={false} />

      {/* Pending join requests — only admins/guardians can act on them. The
          approval lives in the Família tab, so nudge them there. */}
      {canApprove && pending.length > 0 ? (
        <Card
          tone="surface"
          onPress={() => router.navigate("/family")}
          className="mt-2 flex-row items-center gap-3 border border-brand-500/30"
        >
          <View className="h-11 w-11 items-center justify-center rounded-2xl bg-brand-50">
            <Ionicons name="person-add" size={22} color={colors.brand[500]} />
          </View>
          <View className="flex-1">
            <Text variant="title">{t("home.pending.title", { count: pending.length })}</Text>
            <Text variant="caption" color="muted">
              {t("home.pending.body")}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors["ink-subtle"]} />
        </Card>
      ) : null}

      {/* Family status hero */}
      <Card tone={hasAlert ? "surface" : "brand"} className="mt-2 gap-3">
        <View className="flex-row items-center gap-3">
          <View
            className={`h-12 w-12 items-center justify-center rounded-2xl ${hasAlert ? "bg-danger-50" : "bg-white/15"}`}
          >
            <Ionicons
              name={hasAlert ? "alert-circle" : "shield-checkmark"}
              size={26}
              color={hasAlert ? colors.danger[500] : "#FFFFFF"}
            />
          </View>
          <View className="flex-1">
            <Text variant="title" color={hasAlert ? "default" : "inverse"}>
              {hasAlert ? t("family.title") : t("home.statusTitle")}
            </Text>
            <Text
              variant="caption"
              color={hasAlert ? "muted" : "inverse"}
              className={hasAlert ? "" : "opacity-90"}
            >
              {t("home.statusSubtitle", { count: sharing })}
            </Text>
          </View>
        </View>
      </Card>

      {/* Family map + members — both are meaningless before a family exists:
          with none, they render as two hollow sections ("no locations shared",
          an empty avatar row) that only advertise emptiness. The quick-access
          card below is the way in to actually create one. */}
      {hasFamily ? (
        <>
          <Text variant="h2" className="mt-6">
            {t("home.mapTitle")}
          </Text>
          <Card
            padded={false}
            className="mt-3 overflow-hidden"
            onPress={markers.length > 0 ? () => router.push("/family-map") : undefined}
          >
            {markers.length > 0 ? (
              // pointerEvents="none": the preview is a static thumbnail — let the
              // card press win everywhere so a tap always expands to /family-map
              // (same gesture as the traveler-mode map).
              <View pointerEvents="none">
                <MapPreview latitude={center.latitude} longitude={center.longitude} markers={markers} height={180} />
              </View>
            ) : (
              <View className="h-[180px] items-center justify-center gap-2">
                <Ionicons name="location-outline" size={28} color={colors["ink-subtle"]} />
                <Text variant="caption" color="muted">
                  {t("home.mapEmpty")}
                </Text>
              </View>
            )}
          </Card>

          <View className="mt-6 flex-row items-center justify-between">
            <Text variant="h2">{t("home.membersTitle")}</Text>
            <Pressable onPress={() => router.navigate("/family")} hitSlop={8}>
              <Text variant="label" color="brand">
                {t("home.seeAll")}
              </Text>
            </Pressable>
          </View>
          <View className="mt-3 flex-row gap-4">
            {members.map((m) => (
              <Pressable
                key={m.id}
                onPress={() => router.navigate(`/family/${m.id}` as never)}
                className="items-center gap-1 active:opacity-70"
                style={{ width: 64 }}
              >
                <Avatar name={m.name} uri={m.avatarUrl} status={m.status} />
                <Text variant="caption" numberOfLines={1} className="w-full text-center">
                  {m.name}
                </Text>
                {m.battery > 0 && m.battery <= 15 ? (
                  <Badge label={`${m.battery}%`} tone="warning" />
                ) : null}
              </Pressable>
            ))}
          </View>
        </>
      ) : null}

      {/* Quick access grid — the cards speak for themselves, no heading needed. */}
      <View className="mt-7 flex-row flex-wrap justify-between gap-y-4">
        {CARDS.map((c) => (
          <Card
            key={c.key}
            onPress={() => router.navigate(c.href as never)}
            className="w-[48%] gap-3"
          >
            <View
              className={`h-12 w-12 items-center justify-center rounded-2xl ${iconBg[c.tone]}`}
            >
              <Ionicons name={c.icon} size={24} color={iconHex[c.tone]} />
            </View>
            <View>
              <Text variant="title">{t(c.titleKey)}</Text>
              <Text variant="caption" color="muted" className="mt-0.5">
                {t(c.subtitleKey)}
              </Text>
            </View>
          </Card>
        ))}
      </View>
    </ScreenContainer>
  );
}

/** Home for the "traveler" onboarding mode: no family map/management — just a
 *  trip-focused hero and the shortcuts a traveler needs (Trajetos + SOS). */
function TravelerHome() {
  const { t } = useTranslation();
  useReportLocationOnOpen();

  const cards: Quick[] = [
    { key: "trips", icon: "navigate", titleKey: "home.trips.title", subtitleKey: "home.trips.subtitle", href: "/trips", tone: "night" },
    { key: "sos", icon: "warning", titleKey: "home.sos.title", subtitleKey: "home.sos.subtitle", href: "/sos", tone: "danger" },
  ];

  return (
    <ScreenContainer>
      <View className="flex-row items-center gap-3 py-2">
        <View className="flex-1">
          <Text variant="h1">WardYou</Text>
        </View>
        <ProfileButton />
      </View>

      {/* Traveler hero */}
      <Card tone="brand" className="mt-2 gap-3">
        <View className="flex-row items-center gap-3">
          <View className="h-12 w-12 items-center justify-center rounded-2xl bg-white/15">
            <Ionicons name="navigate" size={26} color="#FFFFFF" />
          </View>
          <View className="flex-1">
            <Text variant="title" color="inverse">
              {t("home.traveler.title")}
            </Text>
            <Text variant="caption" color="inverse" className="opacity-90">
              {t("home.traveler.subtitle")}
            </Text>
          </View>
        </View>
      </Card>

      {/* Start a trip CTA */}
      <Card onPress={() => router.navigate("/trips")} className="mt-4 flex-row items-center gap-3">
        <View className="h-12 w-12 items-center justify-center rounded-2xl bg-surface-alt">
          <Ionicons name="add" size={24} color={colors.ink} />
        </View>
        <View className="flex-1">
          <Text variant="title">{t("home.traveler.startTitle")}</Text>
          <Text variant="caption" color="muted">
            {t("home.traveler.startBody")}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors["ink-subtle"]} />
      </Card>

      {/* Quick access — the cards speak for themselves, no heading needed. */}
      <View className="mt-7 flex-row flex-wrap justify-between gap-y-4">
        {cards.map((c) => (
          <Card key={c.key} onPress={() => router.navigate(c.href as never)} className="w-[48%] gap-3">
            <View className={`h-12 w-12 items-center justify-center rounded-2xl ${iconBg[c.tone]}`}>
              <Ionicons name={c.icon} size={24} color={iconHex[c.tone]} />
            </View>
            <View>
              <Text variant="title">{t(c.titleKey)}</Text>
              <Text variant="caption" color="muted" className="mt-0.5">
                {t(c.subtitleKey)}
              </Text>
            </View>
          </Card>
        ))}
      </View>
    </ScreenContainer>
  );
}
