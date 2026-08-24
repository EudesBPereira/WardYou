import { useEffect } from "react";
import { View, Pressable, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, Card, Text } from "@/components/ui";
import { ProfileButton } from "@/components/ProfileButton";
import { colors } from "@/theme";
import { useMocks } from "@/lib/env";
import { getCurrentPosition } from "@/services/location/locationService";
import { useReportLocation } from "@/features/family/queries";
import { useMyMedications, useMyCheckInStatus, useCheckIn, useMyAdherence, useMarkTaken } from "@/features/elder/queries";

/** DaysOfWeek bitmask uses bit0=Mon…bit6=Sun; JS getDay() has 0=Sunday. */
function isForToday(daysOfWeek: number): boolean {
  const day = new Date().getDay();
  const bit = day === 0 ? 1 << 6 : 1 << (day - 1);
  return (daysOfWeek & bit) !== 0;
}

/** Home screen for elder mode: oversized, low-noise UI — a big SOS action,
 *  today's medications and nothing to manage. */
export function ElderHome() {
  const { t } = useTranslation();
  const { data: medications = [] } = useMyMedications();
  const { data: checkInStatus } = useMyCheckInStatus();
  const { data: adherence = [] } = useMyAdherence();
  const checkIn = useCheckIn();
  const markTaken = useMarkTaken();
  const reportLocation = useReportLocation();

  // Best-effort position report so caregivers see the elder on the family map.
  useEffect(() => {
    if (useMocks) return;
    getCurrentPosition().then((coords) => {
      if (!coords) return;
      reportLocation.mutate({
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracyMeters: coords.accuracy,
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const todayMeds = medications
    .filter((m) => m.isActive && isForToday(m.daysOfWeek))
    .flatMap((m) =>
      m.times.map((time) => ({
        id: `${m.id}-${time}`,
        medicationId: m.id,
        time,
        name: m.name,
        dosage: m.dosage,
        taken: adherence.some((a) => a.medicationId === m.id && a.time === time),
      })),
    )
    .sort((a, b) => a.time.localeCompare(b.time));

  return (
    <ScreenContainer>
      <View className="flex-row items-center justify-between py-2">
        <View className="flex-1">
          <Text variant="h1">WardYou</Text>
        </View>
        <ProfileButton />
      </View>

      {/* Big SOS */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("elderHome.sosTitle")}
        onPress={() => router.navigate("/sos" as never)}
        className="mt-2 items-center gap-3 rounded-3xl bg-danger-500 py-10 active:bg-danger-600"
      >
        <Ionicons name="warning" size={56} color="#FFFFFF" />
        <Text variant="h2" color="inverse">
          {t("elderHome.sosTitle")}
        </Text>
        <Text variant="body" color="inverse" className="opacity-90">
          {t("elderHome.sosBody")}
        </Text>
      </Pressable>

      {/* Daily check-in — a single tap to tell caregivers "I'm okay today". */}
      <Card
        onPress={checkInStatus?.checkedInToday ? undefined : () => checkIn.mutate(undefined)}
        className={`mt-4 flex-row items-center gap-3 ${checkInStatus?.checkedInToday ? "border border-safe-500/30" : ""}`}
      >
        <View className={`h-12 w-12 items-center justify-center rounded-2xl ${checkInStatus?.checkedInToday ? "bg-safe-50" : "bg-brand-50"}`}>
          <Ionicons
            name={checkInStatus?.checkedInToday ? "checkmark-circle" : "hand-left"}
            size={24}
            color={checkInStatus?.checkedInToday ? colors.safe[600] : colors.brand[500]}
          />
        </View>
        <View className="flex-1">
          <Text variant="title">
            {checkInStatus?.checkedInToday ? t("elderHome.checkInDone") : t("elderHome.checkInTitle")}
          </Text>
          <Text variant="caption" color="muted">
            {checkInStatus?.checkedInToday ? t("elderHome.checkInDoneBody") : t("elderHome.checkInBody")}
          </Text>
        </View>
        {checkIn.isPending ? <ActivityIndicator color={colors.brand[500]} /> : null}
      </Card>

      {/* Today's medications */}
      <Text variant="h2" className="mt-7">
        {t("elderHome.medsTitle")}
      </Text>
      {todayMeds.length === 0 ? (
        <Card className="mt-3 items-center gap-2 py-8">
          <Ionicons name="medkit-outline" size={30} color={colors["ink-muted"]} />
          <Text variant="body" color="muted">
            {t("elderHome.medsEmpty")}
          </Text>
        </Card>
      ) : (
        <Card padded={false} className="mt-3 px-4">
          {todayMeds.map((med, i) => (
            <View key={med.id}>
              {i > 0 ? <View className="h-px bg-border" /> : null}
              <View className="flex-row items-center gap-3 py-4">
                <View className={`h-12 w-12 items-center justify-center rounded-2xl ${med.taken ? "bg-safe-50" : "bg-brand-50"}`}>
                  <Text variant="label" color={med.taken ? "safe" : "brand"}>
                    {med.time}
                  </Text>
                </View>
                <View className="flex-1">
                  <Text variant="title">{med.name}</Text>
                  <Text variant="body" color="muted">
                    {med.taken ? t("elderHome.medTaken") : med.dosage ?? ""}
                  </Text>
                </View>
                {/* One big tap: "tomei" — logs adherence for the caregiver. */}
                {med.taken ? (
                  <Ionicons name="checkmark-circle" size={30} color={colors.safe[600]} />
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("elderHome.medTakeAction", { name: med.name })}
                    disabled={markTaken.isPending}
                    onPress={() => markTaken.mutate({ medicationId: med.medicationId, time: med.time })}
                    className="rounded-2xl bg-safe-500 px-5 py-3 active:opacity-80"
                  >
                    <Text variant="label" color="inverse">
                      {t("elderHome.medTake")}
                    </Text>
                  </Pressable>
                )}
              </View>
            </View>
          ))}
        </Card>
      )}

      {/* My family */}
      <Card onPress={() => router.navigate("/family" as never)} className="mt-6 flex-row items-center gap-3 py-5">
        <View className="h-12 w-12 items-center justify-center rounded-2xl bg-brand-50">
          <Ionicons name="people" size={24} color={colors.brand[500]} />
        </View>
        <View className="flex-1">
          <Text variant="title">{t("elderHome.familyTitle")}</Text>
          <Text variant="body" color="muted">
            {t("elderHome.familyBody")}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors["ink-subtle"]} />
      </Card>
    </ScreenContainer>
  );
}
