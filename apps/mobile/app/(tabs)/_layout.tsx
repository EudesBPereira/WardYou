import { View, ActivityIndicator } from "react-native";
import { Tabs, Redirect } from "expo-router";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomNav, type TabKey } from "@/components/ui";
import { colors } from "@/theme";
import { useMyProfile, type AppProfile } from "@/features/profile/queries";
import { useOnboardingStore } from "@/stores/onboarding";

const ROUTE_TO_KEY: Record<string, TabKey> = {
  index: "home",
  family: "family",
  trips: "trips",
  tasks: "tasks",
  sos: "sos",
  settings: "settings",
};

const KEY_TO_ROUTE: Record<TabKey, string> = {
  home: "index",
  family: "family",
  trips: "trips",
  tasks: "tasks",
  sos: "sos",
  settings: "settings",
};

// The app profile decides the shell: children get tasks instead of family
// management/trips; elders get a simplified set. Guardians/members see it all.
// `pending`/`onboarding` never actually reach the tab render below (they are
// redirected out first), but the Record type needs every key.
const TABS_BY_PROFILE: Record<AppProfile, TabKey[]> = {
  child: ["home", "tasks", "sos", "settings"],
  elder: ["home", "family", "sos", "settings"],
  guardian: ["home", "family", "trips", "sos", "settings"],
  member: ["home", "family", "trips", "sos", "settings"],
  pending: ["home", "settings"],
  onboarding: ["home", "settings"],
};

// A brand-new adult who acknowledged onboarding but hasn't created/joined a
// family yet (server profile still "onboarding"): a tutor gets the full adult
// shell so they can create a family; a traveler gets a trips-focused shell
// (no family management — they just want to be accompanied on a trip).
const ADULT_TABS: TabKey[] = ["home", "family", "trips", "sos", "settings"];
const TRAVELER_TABS: TabKey[] = ["home", "trips", "sos", "settings"];

export default function TabsLayout() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { data: profile, isLoading } = useMyProfile();
  const hydrated = useOnboardingStore((s) => s.hydrated);
  const modeByUserId = useOnboardingStore((s) => s.modeByUserId);

  // Wait until the profile + local onboarding flag are known before painting
  // anything. Otherwise the full adult menu flashes for a frame on a fresh
  // login before a brand-new account gets redirected to the setup screen —
  // and that flash was tappable. A neutral spinner avoids it.
  if (isLoading || !profile || !hydrated) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color={colors.brand[500]} />
      </View>
    );
  }

  const mode = modeByUserId[profile.userId];

  // Redirect at render time (not in an effect) so tab content never paints for
  // accounts that must go to the setup / awaiting-approval screens first.
  if (profile.appProfile === "pending") return <Redirect href={"/pending-approval" as never} />;
  if (profile.appProfile === "onboarding" && !mode) return <Redirect href={"/onboarding" as never} />;

  const tabs =
    profile.appProfile === "onboarding"
      ? mode === "traveler"
        ? TRAVELER_TABS
        : ADULT_TABS
      : TABS_BY_PROFILE[profile.appProfile];

  const labels: Record<TabKey, string> = {
    home: t("nav.home"),
    family: t("nav.family"),
    trips: t("nav.trips"),
    tasks: t("nav.tasks"),
    sos: t("nav.sos"),
    settings: t("nav.settings"),
  };

  return (
    <View className="flex-1">
      <Tabs
        screenOptions={{ headerShown: false }}
        tabBar={({ state, navigation }) => {
          const activeRoute = state.routes[state.index]?.name ?? "index";
          const active = ROUTE_TO_KEY[activeRoute] ?? "home";
          return (
            <View
              className="bg-surface"
              style={{ paddingBottom: insets.bottom }}
            >
              <BottomNav
                active={active}
                labels={labels}
                tabs={tabs}
                onChange={(key) => navigation.navigate(KEY_TO_ROUTE[key])}
              />
            </View>
          );
        }}
      >
        <Tabs.Screen name="index" />
        <Tabs.Screen name="family" />
        <Tabs.Screen name="trips" />
        <Tabs.Screen name="tasks" />
        <Tabs.Screen name="sos" />
        <Tabs.Screen name="settings" />
      </Tabs>
    </View>
  );
}
