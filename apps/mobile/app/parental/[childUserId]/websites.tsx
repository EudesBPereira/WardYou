import { useState } from "react";
import { View, ActivityIndicator, Pressable } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, ScreenHeader, Card, Text, ListItem, InputModal } from "@/components/ui";
import { colors } from "@/theme";
import { usePolicy, useSaveBlockedWebsites } from "@/features/parental/queries";

export default function WebsitesScreen() {
  const { t } = useTranslation();
  const { childUserId } = useLocalSearchParams<{ childUserId: string }>();
  const { data: policy, isLoading } = usePolicy(childUserId);
  const save = useSaveBlockedWebsites(childUserId as string);
  const [addOpen, setAddOpen] = useState(false);

  const domains = policy?.blockedWebsites ?? [];

  function add(value: string) {
    // Tira TODO espaco, nao so das pontas: teclado com correcao automatica
    // insere espaco depois do ponto ("g1. com. br"). O servidor ja recusa isso,
    // mas e melhor consertar em silencio do que devolver erro por algo que o
    // usuario nao digitou de proposito.
    const d = value.replace(/\s+/g, "");
    if (!d) return;
    save.mutate([...domains, d]);
    setAddOpen(false);
  }
  function remove(domain: string) {
    save.mutate(domains.filter((d) => d !== domain));
  }

  return (
    <ScreenContainer>
      <ScreenHeader
        title={t("parental.menu.websites")}
        subtitle={t("parental.websites.subtitle")}
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

      {/* Honest scope disclosure: this reads the browser's address bar, it
          does not filter DNS/network traffic. A guardian who doesn't know
          that will assume "blocked" means blocked everywhere, including an
          incognito tab or a link opened inside another app — neither is
          covered. Always visible, not just on empty state, since it matters
          the moment a guardian is deciding whether to rely on this. */}
      <Card className="mt-2 flex-row items-start gap-3 border border-warning-300 bg-warning-100">
        <Ionicons name="information-circle" size={20} color={colors.warning[700]} />
        <View className="flex-1 gap-1">
          <Text variant="label" className="font-body-semibold text-warning-700">
            {t("parental.websites.coverageTitle")}
          </Text>
          <Text variant="caption" className="text-warning-700">
            {t("parental.websites.coverageBody")}
          </Text>
        </View>
      </Card>

      {isLoading ? (
        <ActivityIndicator className="mt-10" color={colors.brand[500]} />
      ) : domains.length === 0 ? (
        <Card className="mt-2 items-center gap-2 py-8">
          <Ionicons name="globe-outline" size={28} color={colors["ink-subtle"]} />
          <Text variant="body" color="muted">
            {t("parental.websites.empty")}
          </Text>
        </Card>
      ) : (
        <Card padded={false} className="mt-2 px-4">
          {domains.map((d, i) => (
            <View key={d}>
              {i > 0 ? <View className="h-px bg-border" /> : null}
              <ListItem
                icon="ban"
                iconTone="danger"
                title={d}
                trailing={
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("common.delete")}
                    onPress={() => remove(d)}
                    className="h-9 w-9 items-center justify-center rounded-full bg-surface-alt active:opacity-70"
                  >
                    <Ionicons name="trash" size={15} color={colors.danger[500]} />
                  </Pressable>
                }
              />
            </View>
          ))}
        </Card>
      )}

      <InputModal
        visible={addOpen}
        title={t("parental.websites.addTitle")}
        subtitle={t("parental.websites.addSubtitle")}
        placeholder="exemplo.com"
        confirmLabel={t("parental.websites.add")}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        loading={save.isPending}
        onConfirm={add}
        onClose={() => setAddOpen(false)}
      />
    </ScreenContainer>
  );
}
