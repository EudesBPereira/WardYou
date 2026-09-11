import { useCallback, useEffect, useState } from "react";
import { View, ActivityIndicator, Pressable, AppState, Alert, Linking, Platform } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, ScreenHeader, Card, Text, Toggle, Avatar } from "@/components/ui";
import { colors } from "@/theme";
import {
  getLocationPermissionLevel,
  requestLocationAlwaysPermission,
  type LocationPermissionLevel,
} from "@/services/location/locationService";
import { useConsents, useSetConsent, useFamilyConsents, useGrantFamilyConsent, CONSENT_TYPES, type ConsentTypeName } from "@/features/consent/queries";
import { useMyFamilies, useFamilyMembers } from "@/features/family/queries";
import { confirmSensitive } from "@/services/auth/confirmSensitive";

/**
 * Bug de campo (dúvida A): two active members with the same full name (e.g.
 * two children both named "Tatiane Silva") were indistinguishable in this
 * exact screen — the one place where an admin grants/revokes LOCATION access
 * "on behalf of" a specific person. Acting on the wrong one is a real
 * consequence here, not just a cosmetic annoyance. Until there's a proper
 * per-member nickname (a product decision, not this fix), append a short,
 * stable id suffix ONLY to names that actually collide, so the common case
 * (no duplicates) stays untouched.
 */
function disambiguateNames<T extends { id: string; name: string }>(items: T[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const it of items) counts.set(it.name, (counts.get(it.name) ?? 0) + 1);
  const labels = new Map<string, string>();
  for (const it of items) {
    labels.set(it.id, (counts.get(it.name) ?? 0) > 1 ? `${it.name} (#${it.id.slice(0, 4)})` : it.name);
  }
  return labels;
}

function FamilyPermissions() {
  const { t } = useTranslation();
  const { data: families = [] } = useMyFamilies();
  const managed = families.find((f) => f.myRole === "admin" || f.myRole === "guardian");
  const { data: members = [] } = useFamilyMembers();
  const { data: famConsents = [] } = useFamilyConsents(managed?.id);
  const grant = useGrantFamilyConsent(managed?.id ?? "");

  if (!managed) return null;
  const others = members.filter((m) => m.familyId === managed.id && m.userId && m.membershipStatus === "active");
  if (others.length === 0) return null;
  const displayNames = disambiguateNames(others);

  const has = (userId: string, type: ConsentTypeName) =>
    famConsents.some((c) => c.userId === userId && c.type === type && c.isActive);

  const PERMS: ConsentTypeName[] = ["LocationSharing", "BatteryStatus"];

  return (
    <View className="mt-7">
      <Text variant="h2">{t("consent.family.title")}</Text>
      <Text variant="caption" color="muted" className="mb-3 mt-0.5">
        {t("consent.family.subtitle")}
      </Text>
      <Card padded={false} className="px-4">
        {others.map((m, i) => (
          <View key={m.id}>
            {i > 0 ? <View className="h-px bg-border" /> : null}
            <View className="flex-row items-center gap-3 py-3">
              <Avatar name={m.name} uri={m.avatarUrl} />
              <View className="flex-1">
                <Text variant="title">{displayNames.get(m.id) ?? m.name}</Text>
                <View className="mt-1 flex-row gap-2">
                  {PERMS.map((type) => {
                    const granted = has(m.userId as string, type);
                    // Achado de QA 2026-09-11: isto e uma acao de CONCEDER, nunca
                    // um toggle -- nao existe (nem no cliente, nem na API) um jeito
                    // de revogar um consentimento concedido em nome de outro membro
                    // por aqui, so o proprio titular pode revogar o que concedeu a
                    // si mesmo (ver o toggle pessoal no topo desta tela). Antes,
                    // depois de conceder, isto virava um Pressable DESABILITADO —
                    // continuava com toda a cara de botao tocavel, so que morto. Lido
                    // em campo (2x, 2 membros, 2 tipos) como "travou". A causa nao e
                    // um bug de estado — e a AFORDANCIA errada: nada aqui deveria
                    // parecer tocavel depois de concedido. Concedido agora renderiza
                    // como selo estatico (sem Pressable, sem onPress), nao como botao
                    // morto. Revogar-em-nome-de-outro-membro e decisao de produto em
                    // aberto (ver mensagem pro fundador) — nao inventado aqui.
                    if (granted) {
                      return (
                        <View
                          key={type}
                          className="flex-row items-center gap-1 rounded-full bg-safe-50 px-3 py-1.5"
                        >
                          <Ionicons name="checkmark-circle" size={14} color={colors.safe[600]} />
                          <Text variant="caption" className="text-safe-600">
                            {t(`consent.types.${type}.title`)}
                          </Text>
                        </View>
                      );
                    }
                    return (
                      <Pressable
                        key={type}
                        accessibilityRole="button"
                        disabled={grant.isPending}
                        onPress={() => grant.mutate({ userId: m.userId as string, type })}
                        className="flex-row items-center gap-1 rounded-full bg-surface-alt px-3 py-1.5 active:opacity-70"
                      >
                        <Ionicons name="add-circle-outline" size={14} color={colors["ink-subtle"]} />
                        <Text variant="caption" className="text-ink-subtle">
                          {t(`consent.types.${type}.title`)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </View>
          </View>
        ))}
      </Card>
    </View>
  );
}

export default function ConsentsScreen() {
  const { t } = useTranslation();
  const { data: consents = [], isLoading } = useConsents();
  const setConsent = useSetConsent();
  const [locationPerm, setLocationPerm] = useState<LocationPermissionLevel | null>(null);

  const isActive = (type: ConsentTypeName) => consents.some((c) => c.type === type && c.isActive);

  // Reflect the real OS location permission — refreshed when returning from the
  // system settings/permission dialog so the warning below stays accurate.
  const refreshPerm = useCallback(() => {
    getLocationPermissionLevel().then(setLocationPerm).catch(() => {});
  }, []);
  useEffect(() => {
    refreshPerm();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") refreshPerm();
    });
    return () => sub.remove();
  }, [refreshPerm]);

  // Enabling location sharing must also secure the OS "allow all the time"
  // permission — without it the family can't actually see the position (and
  // background/closed-app sharing won't work). If the OS grant is refused we
  // don't flip the consent on.
  async function onToggle(type: ConsentTypeName, active: boolean) {
    // REVOGAR consentimento tira a familia de vista — exige autenticacao.
    // Conceder nao pede nada: e a acao que aumenta protecao.
    if (!active && !(await confirmSensitive(t("consent.confirmRevoke")))) return;
    if (type === "LocationSharing" && active && Platform.OS !== "web") {
      const level = await requestLocationAlwaysPermission();
      setLocationPerm(level);
      if (level === "denied") {
        Alert.alert(
          t("consent.permission.deniedTitle"),
          t("consent.permission.deniedBody"),
          [
            { text: t("common.cancel"), style: "cancel" },
            { text: t("consent.permission.openSettings"), onPress: () => Linking.openSettings() },
          ],
        );
        return;
      }
    }
    setConsent.mutate({ type, active });
  }

  // Consent is on but the OS permission isn't "all the time" → actionable hint.
  async function fixPermission() {
    const level = await requestLocationAlwaysPermission();
    setLocationPerm(level);
    if (level !== "always") Linking.openSettings();
  }

  const locationWarning =
    isActive("LocationSharing") && locationPerm && locationPerm !== "always"
      ? locationPerm === "denied"
        ? t("consent.permission.denied")
        : t("consent.permission.foregroundOnly")
      : null;

  return (
    <ScreenContainer>
      <ScreenHeader
        title={t("consent.title")}
        subtitle={t("consent.subtitle")}
        onBack={() => router.back()}
      />

      {isLoading ? (
        <ActivityIndicator className="mt-10" color={colors.brand[500]} />
      ) : (
        <Card padded={false} className="mt-2 px-4">
          {CONSENT_TYPES.map((type, idx) => (
            <View key={type}>
              {idx > 0 ? <View className="h-px bg-border" /> : null}
              <View className="flex-row items-center gap-3 py-3.5">
                <View className="flex-1">
                  <Text variant="title">{t(`consent.types.${type}.title`)}</Text>
                  <Text variant="caption" color="muted" className="mt-0.5">
                    {t(`consent.types.${type}.body`)}
                  </Text>
                  {type === "LocationSharing" && locationWarning ? (
                    <Pressable
                      onPress={fixPermission}
                      accessibilityRole="button"
                      className="mt-1.5 flex-row items-center gap-1 active:opacity-70"
                    >
                      <Ionicons name="warning-outline" size={13} color={colors.warning[700]} />
                      <Text variant="caption" className="flex-1 text-warning-700">
                        {locationWarning}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
                <Toggle
                  value={isActive(type)}
                  onValueChange={(active) => onToggle(type, active)}
                  accessibilityLabel={t(`consent.types.${type}.title`)}
                />
              </View>
            </View>
          ))}
        </Card>
      )}

      <Text variant="caption" color="subtle" className="mt-3">
        {t("consent.note")}
      </Text>

      <FamilyPermissions />

      {/* Bottom breathing room so the last card clears the system nav bar. */}
      <View className="h-10" />
    </ScreenContainer>
  );
}
