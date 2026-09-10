import "../global.css";
import "@/i18n";
// Side-effect import: registers the background trip-location TaskManager task so
// the OS can relaunch it headlessly (native only; a no-op module on web).
import "@/services/location/tripLocationTracking";

import { useEffect, useState } from "react";
import { View } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreenNative from "expo-splash-screen";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFonts, Sora_600SemiBold, Sora_700Bold } from "@expo-google-fonts/sora";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import { JetBrainsMono_500Medium } from "@expo-google-fonts/jetbrains-mono";
import { loadPersistedLanguage } from "@/i18n";
import { useSession } from "@/stores/session";
import { useOnboardingStore } from "@/stores/onboarding";
import { useAppLock } from "@/stores/appLock";
import { AppLockGate } from "@/components/AppLockGate";
import { useRealtimeSync } from "@/services/realtime/useRealtimeSync";
import { useConsumePendingInvite } from "@/features/family/useConsumePendingInvite";
import { useTripLocationBroadcast } from "@/features/trips/useTripLocationBroadcast";
import { usePushRegistration } from "@/services/push/usePushRegistration";
import { useAppBlockRequests } from "@/features/parental/useAppBlockRequests";
import { useMyProfile } from "@/features/profile/queries";
import { useConnection } from "@/stores/connection";
import { ConnectionBanner } from "@/components/ConnectionBanner";
import { wireQueryToAppLifecycle } from "@/lib/queryFocus";

SplashScreenNative.preventAutoHideAsync().catch(() => {});

// No React Native o TanStack nao tem `window`, entao `refetchOnWindowFocus` e
// `refetchOnReconnect` ficam inertes sem esta ponte. Ver `lib/queryFocus.ts`.
wireQueryToAppLifecycle();

// O `queryCache` alimenta a faixa global de erro (ConnectionBanner). Sem ele,
// uma query que falha deixa `data` undefined, o default do destructuring (`= []`)
// assume e a tela mostra o ESTADO VAZIO — uma falha de rede vira "Nenhuma zona
// cadastrada". Ver `stores/connection.ts`.
const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: () => useConnection.getState().setHasError(true),
    onSuccess: () => useConnection.getState().setHasError(false),
  }),
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 30_000,
      // So passam a valer com o `wireQueryToAppLifecycle` acima.
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  },
});

// Safety net only: if a read from SecureStore ever wedges, don't hold the user
// on the splash forever — fall through to the app (AuthGate handles a missing
// session by routing to login).
const BOOT_TIMEOUT_MS = 5000;

/**
 * Redirect between the (auth) group, the first-login onboarding/pending
 * screens, and the app based on session status + the server-derived app
 * profile. A freshly registered account (no family membership yet) or one
 * still awaiting an admin's approval must NEVER land on the full adult tabs —
 * that was the bug where a child's phone looked identical to the parent's.
 */
function AuthGate() {
  const status = useSession((s) => s.status);
  const segments = useSegments();
  const router = useRouter();
  useRealtimeSync();
  useConsumePendingInvite();
  useTripLocationBroadcast();
  usePushRegistration();
  useAppBlockRequests();

  const { data: profile, isLoading: profileLoading } = useMyProfile();
  const onboardingHydrated = useOnboardingStore((s) => s.hydrated);
  const modeByUserId = useOnboardingStore((s) => s.modeByUserId);

  useEffect(() => {
    if (status === "loading") return;
    const inAuthGroup = segments[0] === "(auth)";

    if (status === "unauthenticated") {
      if (!inAuthGroup) router.replace("/(auth)/login");
      return;
    }

    if (inAuthGroup) {
      router.replace("/(tabs)");
      return;
    }

    // Wait for the profile + local ack flag before deciding — avoids a flash
    // redirect into onboarding/pending while the first fetch is in flight.
    if (!profile || profileLoading || !onboardingHydrated) return;

    const firstSegment = segments[0] as string;
    const inOnboarding = firstSegment === "onboarding";
    const inPending = firstSegment === "pending-approval";
    const acknowledgedAdult = !!modeByUserId[profile.userId];

    if (profile.appProfile === "pending") {
      if (!inPending) router.replace("/pending-approval" as never);
      return;
    }
    if (profile.appProfile === "onboarding" && !acknowledgedAdult) {
      if (!inOnboarding) router.replace("/onboarding" as never);
      return;
    }
    if (inOnboarding || inPending) {
      router.replace("/(tabs)");
    }
  }, [status, segments, router, profile, profileLoading, onboardingHydrated, modeByUserId]);

  return <Stack screenOptions={{ headerShown: false }} />;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Sora_600SemiBold,
    Sora_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    JetBrainsMono_500Medium,
  });
  // Boot gates on *real* progress, not a timer: the persisted session and the
  // onboarding flag actually rehydrated. Reading SecureStore takes milliseconds,
  // so this is effectively instant — the old fixed 1.8s "Restoring session"
  // screen was pure theater (its progress bar animated on a clock, not on work).
  const sessionHydrated = useSession((s) => s.status) !== "loading";
  const onboardingHydrated = useOnboardingStore((s) => s.hydrated);
  const [bootTimedOut, setBootTimedOut] = useState(false);

  useEffect(() => {
    loadPersistedLanguage();
    useSession.getState().hydrate();
    useOnboardingStore.getState().hydrate();
    useAppLock.getState().hydrate();
    const timer = setTimeout(() => setBootTimedOut(true), BOOT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  const fontsReady = fontsLoaded || fontError;
  const ready = (fontsReady && sessionHydrated && onboardingHydrated) || bootTimedOut;

  // Hold the *native* splash (already the product background, #F4F7F8) until
  // we're actually ready. Hiding it as soon as the fonts loaded is what exposed
  // a second, navy JS splash underneath — the light→navy→light jump.
  useEffect(() => {
    if (ready) SplashScreenNative.hideAsync().catch(() => {});
  }, [ready]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="dark" />
          {/* Not ready yet: just the product background under the native splash
              — no second branded screen to flash through. */}
          {ready ? (
            <View className="flex-1">
              <ConnectionBanner />
              <AppLockGate>
                <AuthGate />
              </AppLockGate>
            </View>
          ) : (
            <View className="flex-1 bg-background" />
          )}
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
