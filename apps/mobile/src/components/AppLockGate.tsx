import { useEffect, useRef, useState } from "react";
import { AppState, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { Text, Button } from "@/components/ui";
import { colors } from "@/theme";
import { useSession } from "@/stores/session";
import { useAppLock } from "@/stores/appLock";
import { authenticateBiometric } from "@/services/auth/biometrics";

/**
 * WhatsApp-style biometric lock. Wraps the app: while authenticated and the
 * lock is enabled, a full-screen shield covers everything until the owner
 * passes biometrics. Re-locks whenever the app returns from the background.
 * Never arms on the login screen (gated on session status), so a logged-out
 * user is never asked for a fingerprint.
 */
export function AppLockGate({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const authed = useSession((s) => s.status === "authenticated");
  const { enabled, hydrated, locked, lock, unlock } = useAppLock();
  const [prompting, setPrompting] = useState(false);
  const appState = useRef(AppState.currentState);

  const active = authed && hydrated && enabled;

  // Re-lock on every background → foreground transition (like WhatsApp).
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      const prev = appState.current;
      appState.current = next;
      if (next === "active" && prev.match(/inactive|background/) && useAppLock.getState().enabled) {
        lock();
      }
    });
    return () => sub.remove();
  }, [lock]);

  const promptUnlock = async () => {
    if (prompting) return;
    setPrompting(true);
    const ok = await authenticateBiometric(t("appLock.prompt"));
    setPrompting(false);
    if (ok) unlock();
  };

  // Auto-prompt the moment the lock becomes active/visible.
  useEffect(() => {
    if (active && locked) promptUnlock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, locked]);

  return (
    <View style={{ flex: 1 }}>
      {children}
      {active && locked ? (
        <View className="absolute inset-0 items-center justify-center gap-6 bg-night-500 px-8">
          <View className="h-24 w-24 items-center justify-center rounded-full bg-white/10">
            <Ionicons name="finger-print" size={52} color="#FFFFFF" />
          </View>
          <View className="items-center gap-2">
            <Text variant="h2" color="inverse" className="text-center">
              {t("appLock.title")}
            </Text>
            <Text variant="body" color="inverse" className="text-center opacity-80">
              {t("appLock.body")}
            </Text>
          </View>
          <Button
            label={t("appLock.unlock")}
            icon="finger-print"
            loading={prompting}
            onPress={promptUnlock}
            fullWidth={false}
          />
        </View>
      ) : null}
    </View>
  );
}
