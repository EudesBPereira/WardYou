import { useState } from "react";
import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { Text } from "@/components/ui";
import { useConnection } from "@/stores/connection";
import { colors } from "@/theme";

/**
 * Faixa global de "nao consegui falar com o servidor".
 *
 * Cobre as 29 telas de uma vez, a partir do `QueryCache` no root layout, em vez
 * de depender de cada tela tratar `isError`. O objetivo nao e bonito: e impedir
 * que uma falha de rede continue se passando por "voce nao tem nada aqui" —
 * ver o comentario em `stores/connection.ts`.
 */
export function ConnectionBanner() {
  const { t } = useTranslation();
  const hasError = useConnection((s) => s.hasError);
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const [retrying, setRetrying] = useState(false);

  if (!hasError) return null;

  const retry = async () => {
    setRetrying(true);
    try {
      await qc.refetchQueries();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <View
      accessibilityRole="alert"
      style={{ paddingTop: insets.top }}
      className="flex-row items-center gap-2 bg-warning-100 px-4 pb-2 pt-2"
    >
      <Ionicons name="cloud-offline-outline" size={16} color={colors.warning[700]} />
      <Text variant="caption" className="flex-1 text-warning-700">
        {t("common.loadError")}
      </Text>
      <Pressable onPress={retry} disabled={retrying} accessibilityRole="button" hitSlop={8}>
        <Text variant="caption" className="font-semibold text-warning-700">
          {retrying ? "..." : t("common.retry")}
        </Text>
      </Pressable>
    </View>
  );
}
