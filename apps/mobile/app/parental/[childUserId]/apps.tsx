import { useState } from "react";
import { View, ActivityIndicator, Pressable, Modal } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, ScreenHeader, Card, Text, Toggle, ListItem, InputModal, Button } from "@/components/ui";
import { colors } from "@/theme";
import {
  useAppRules,
  useSaveAppRules,
  useTemporaryAllow,
  type AppRuleDto,
  type AppRuleInput,
} from "@/features/parental/queries";

// Firewall / allowlist model: everything is blocked by default; the guardian
// toggles apps to "allowed", optionally caps each one's daily time, or grants
// a temporary "liberar por N horas" window (Kids360-style).
function toInput(r: AppRuleDto): AppRuleInput {
  return {
    appPackageName: r.appPackageName,
    appDisplayName: r.appDisplayName,
    isBlocked: r.isBlocked,
    isWhitelisted: r.isWhitelisted,
    dailyLimitMinutes: r.dailyLimitMinutes,
    appCategory: r.appCategory,
  };
}

function tempActive(r: AppRuleDto): boolean {
  return !!r.allowedUntil && new Date(r.allowedUntil) > new Date();
}

// Achado de QA 2026-09-11: `[]` usa o idioma do SISTEMA, nao o do app — ver
// formatDateTime em src/lib/formatTime.ts para o caso mais grave encontrado.
// Funcao de nivel de modulo (fora do componente), entao usa o `i18n`
// singleton importado direto em vez do hook `useTranslation()`.
function fmtUntil(iso: string): string {
  return new Date(iso).toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit", hour12: false });
}

const TEMP_HOURS = [1, 2, 4, 8];

export default function AppRulesScreen() {
  const { t } = useTranslation();
  const { childUserId } = useLocalSearchParams<{ childUserId: string }>();
  const { data: rules = [], isLoading } = useAppRules(childUserId);
  const save = useSaveAppRules(childUserId as string);
  const tempAllow = useTemporaryAllow(childUserId as string);
  const [addOpen, setAddOpen] = useState(false);
  const [limitFor, setLimitFor] = useState<AppRuleDto | null>(null);
  const [tempFor, setTempFor] = useState<AppRuleDto | null>(null);

  function saveAll(next: AppRuleInput[]) {
    save.mutate(next);
  }
  function toggleAllow(id: string, allowed: boolean) {
    saveAll(rules.map((r) => (r.id === id ? { ...toInput(r), isWhitelisted: allowed } : toInput(r))));
  }
  function setLimit(minutes: string) {
    if (!limitFor) return;
    const n = parseInt(minutes, 10);
    const dailyLimitMinutes = Number.isFinite(n) && n > 0 ? n : null;
    saveAll(rules.map((r) => (r.id === limitFor.id ? { ...toInput(r), dailyLimitMinutes } : toInput(r))));
    setLimitFor(null);
  }
  function remove(id: string) {
    saveAll(rules.filter((r) => r.id !== id).map(toInput));
  }
  function add(pkg: string) {
    const name = pkg.trim();
    if (!name) return;
    // Manually-added apps start allowed (the guardian typed them on purpose).
    saveAll([...rules.map(toInput), { appPackageName: name, appDisplayName: name, isBlocked: false, isWhitelisted: true, appCategory: "Other" }]);
    setAddOpen(false);
  }
  function grantTemp(hours: number) {
    if (!tempFor) return;
    tempAllow.mutate({ appPackageName: tempFor.appPackageName, hours });
    setTempFor(null);
  }

  // Three buckets: freshly discovered on the device (guardian never decided),
  // usable now (allowed or temporarily allowed), and deliberately blocked.
  const fresh = rules.filter((r) => !r.isWhitelisted && !tempActive(r) && !r.configured);
  const allowed = rules.filter((r) => r.isWhitelisted || tempActive(r));
  const blocked = rules.filter((r) => !r.isWhitelisted && !tempActive(r) && r.configured);

  const renderRow = (r: AppRuleDto, i: number) => {
    const temp = tempActive(r);
    const subtitle = temp
      ? t("parental.apps.tempUntil", { time: fmtUntil(r.allowedUntil!) })
      : r.isWhitelisted
        ? r.dailyLimitMinutes
          ? t("parental.apps.limitLabel", { min: r.dailyLimitMinutes })
          : t("parental.apps.noLimit")
        : r.appPackageName;
    return (
      <View key={r.id}>
        {i > 0 ? <View className="h-px bg-border" /> : null}
        <ListItem
          title={r.appDisplayName}
          subtitle={subtitle}
          onPress={r.isWhitelisted ? () => setLimitFor(r) : undefined}
          trailing={
            <View className="flex-row items-center gap-2">
              {/* Temporary allow ("liberar por N horas") */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("parental.apps.tempTitle", { app: r.appDisplayName })}
                onPress={() => setTempFor(r)}
                className={`h-9 w-9 items-center justify-center rounded-full active:opacity-70 ${
                  temp ? "bg-safe-100" : "bg-surface-alt"
                }`}
              >
                <Ionicons name="time" size={16} color={temp ? colors.safe[600] : colors["ink-subtle"]} />
              </Pressable>
              {/* No global `disabled={save.isPending}` here: the save is
                  optimistic (cache flips instantly) and disabling every row
                  during the round trip made ALL switches dim for ~2s per tap. */}
              <Toggle value={r.isWhitelisted} onValueChange={(v) => toggleAllow(r.id, v)} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("common.delete")}
                onPress={() => remove(r.id)}
                className="h-9 w-9 items-center justify-center rounded-full bg-surface-alt active:opacity-70"
              >
                <Ionicons name="trash" size={15} color={colors.danger[500]} />
              </Pressable>
            </View>
          }
        />
      </View>
    );
  };

  return (
    <ScreenContainer>
      <ScreenHeader
        title={t("parental.menu.apps")}
        subtitle={t("parental.apps.firewallSubtitle")}
        onBack={() => router.back()}
        action={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("common.add")}
            onPress={() => setAddOpen(true)}
            className="h-10 w-10 items-center justify-center rounded-full bg-brand-50 active:opacity-70"
          >
            <Ionicons name="add" size={22} color={colors.brand[500]} />
          </Pressable>
        }
      />

      {isLoading ? (
        <ActivityIndicator className="mt-10" color={colors.brand[500]} />
      ) : rules.length === 0 ? (
        <Card className="mt-2 items-center gap-2 py-8">
          <Ionicons name="apps-outline" size={28} color={colors["ink-subtle"]} />
          <Text variant="body" color="muted" className="text-center">
            {t("parental.apps.firewallEmpty")}
          </Text>
        </Card>
      ) : (
        <>
          {fresh.length > 0 ? (
            <>
              <View className="mb-1 mt-4 flex-row items-center gap-2">
                <Text variant="label" color="muted">
                  {t("parental.apps.newTitle", { count: fresh.length })}
                </Text>
                <View className="rounded-full bg-brand-50 px-2 py-0.5">
                  <Text variant="caption" color="brand">
                    {t("parental.apps.newBadge")}
                  </Text>
                </View>
              </View>
              <Card padded={false} className="border border-brand-500/25 px-4">{fresh.map(renderRow)}</Card>
            </>
          ) : null}

          <Text variant="label" color="muted" className="mb-1 mt-5">
            {t("parental.apps.allowedTitle", { count: allowed.length })}
          </Text>
          {allowed.length > 0 ? (
            <Card padded={false} className="px-4">{allowed.map(renderRow)}</Card>
          ) : (
            <Text variant="caption" color="subtle" className="mb-1">
              {t("parental.apps.allowedEmpty")}
            </Text>
          )}

          <Text variant="label" color="muted" className="mb-1 mt-5">
            {t("parental.apps.blockedTitle", { count: blocked.length })}
          </Text>
          {blocked.length > 0 ? (
            <Card padded={false} className="px-4">{blocked.map(renderRow)}</Card>
          ) : (
            <Text variant="caption" color="subtle" className="mb-1">
              {t("parental.apps.blockedEmpty")}
            </Text>
          )}
        </>
      )}

      <InputModal
        visible={addOpen}
        title={t("parental.apps.addTitle")}
        subtitle={t("parental.apps.addSubtitle")}
        placeholder="com.exemplo.app"
        confirmLabel={t("parental.apps.add")}
        autoCapitalize="none"
        loading={save.isPending}
        onConfirm={add}
        onClose={() => setAddOpen(false)}
      />

      <InputModal
        visible={limitFor !== null}
        title={t("parental.apps.limitTitle", { app: limitFor?.appDisplayName ?? "" })}
        subtitle={t("parental.apps.limitSubtitle")}
        placeholder={t("parental.apps.limitPlaceholder")}
        confirmLabel={t("common.save")}
        keyboardType="number-pad"
        initialValue={limitFor?.dailyLimitMinutes ? String(limitFor.dailyLimitMinutes) : ""}
        allowEmpty
        loading={save.isPending}
        onConfirm={setLimit}
        onClose={() => setLimitFor(null)}
      />

      {/* Temporary allow picker */}
      <Modal visible={tempFor !== null} transparent animationType="fade" onRequestClose={() => setTempFor(null)}>
        <Pressable className="flex-1 items-center justify-center bg-black/40 px-6" onPress={() => setTempFor(null)}>
          <Pressable className="w-full" onPress={() => {}}>
            <Card className="gap-3">
              <Text variant="title">{t("parental.apps.tempTitle", { app: tempFor?.appDisplayName ?? "" })}</Text>
              <Text variant="caption" color="muted">
                {t("parental.apps.tempSubtitle")}
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {TEMP_HOURS.map((h) => (
                  <Pressable
                    key={h}
                    accessibilityRole="button"
                    onPress={() => grantTemp(h)}
                    className="rounded-2xl bg-brand-500 px-5 py-3 active:opacity-80"
                  >
                    <Text variant="label" color="inverse">
                      {t("parental.apps.tempHours", { count: h })}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {tempFor && tempActive(tempFor) ? (
                <Button
                  label={t("parental.apps.tempClear")}
                  variant="secondary"
                  icon="close-circle-outline"
                  loading={tempAllow.isPending}
                  onPress={() => grantTemp(0)}
                />
              ) : null}
            </Card>
          </Pressable>
        </Pressable>
      </Modal>
    </ScreenContainer>
  );
}
