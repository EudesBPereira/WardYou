import { useCallback, useEffect, useState } from "react";
import { AppState, Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Card, Text } from "@/components/ui";
import { colors } from "@/theme";
import { diagnosticar, type Diagnostico } from "@/features/protection/diagnostics";

/**
 * "Os outros conseguem te acompanhar nesta viagem?"
 *
 * Existe porque o modo viajante tinha o mesmo defeito que perseguimos o dia
 * inteiro, na versao mais silenciosa de todas: a pessoa entrava na viagem,
 * via o mapa, aparecia na lista de membros -- e nao transmitia posicao
 * nenhuma. Quatro camadas engoliam a falha sem uma palavra:
 *
 *  1. `watchPosition` devolve `null` quando a permissao e negada;
 *  2. quem chama (useTripLocationBroadcast) nao olhava esse `null` e seguia
 *     rodando um timer que postava `lastCoords` eternamente vazio;
 *  3. ninguem checava o GPS do SISTEMA (permissao concedida + GPS desligado
 *     e o caso silencioso classico);
 *  4. `ensureTripLocationTracking(...).catch(() => {})` engolia a falha do
 *     servico de segundo plano.
 *
 * Reusa `diagnosticar` de proposito, em vez de um segundo mecanismo: ele ja
 * sabe medir permissao, GPS do sistema e o vocabulario de niveis, e dois
 * diagnosticos que medem a mesma coisa divergem com o tempo.
 *
 * So renderiza quando ha viagem ativa E ha algo errado: numa viagem saudavel
 * nao aparece nada. Cobrar GPS de quem esta tudo certo e como gritar perigo
 * onde nao ha -- ensina a ignorar o aviso no dia em que ele importa.
 */
export function TripSharingStatusCard({ ativa }: { ativa: boolean }) {
  const { t } = useTranslation();
  const [diag, setDiag] = useState<Diagnostico | null>(null);

  const medir = useCallback(() => {
    if (!ativa) {
      setDiag(null);
      return;
    }
    diagnosticar({ emViagem: true }).then(setDiag).catch(() => setDiag(null));
  }, [ativa]);

  // Remede ao voltar do segundo plano: conceder permissao ou ligar o GPS
  // acontece FORA do app, entao sem isto o aviso continuaria de pe depois de
  // resolvido. Mesmo padrao do ProtectionStatusCard.
  useEffect(() => {
    medir();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") medir();
    });
    return () => sub.remove();
  }, [medir]);

  // So interessam os problemas que afetam SER ACOMPANHADO nesta viagem. Os
  // outros itens que `diagnosticar` devolve (bateria, push...) tem o painel
  // deles; repetir aqui transformaria este card numa segunda lista generica.
  const relevantes =
    diag?.problemas.filter((p) =>
      ["locationPermission", "locationServices", "locationBackground", "tripTracking", "network"].includes(p.id),
    ) ?? [];

  if (!ativa || relevantes.length === 0) return null;

  const critico = relevantes.some((p) => p.severidade === "critica");
  const cor = critico ? colors.danger[500] : colors.warning[500];
  const fundo = critico ? colors.danger[50] : colors.warning[100];

  return (
    <Card className="mt-3 gap-3" style={{ borderColor: cor, borderWidth: 1 }}>
      <View className="flex-row items-center gap-3">
        <View
          className="h-12 w-12 items-center justify-center rounded-2xl"
          style={{ backgroundColor: fundo }}
        >
          <Ionicons name={critico ? "location-outline" : "alert-circle-outline"} size={24} color={cor} />
        </View>
        <View className="flex-1">
          <Text variant="title" style={{ color: cor }}>
            {critico ? t("trips.sharing.blockedTitle") : t("trips.sharing.partialTitle")}
          </Text>
          <Text variant="caption" color="muted">
            {critico ? t("trips.sharing.blockedBody") : t("trips.sharing.partialBody")}
          </Text>
        </View>
      </View>

      <View className="gap-px overflow-hidden rounded-xl bg-border">
        {relevantes.map((p) => (
          <Pressable
            key={p.id}
            onPress={p.resolver}
            disabled={!p.resolver}
            accessibilityRole={p.resolver ? "button" : "text"}
            accessibilityLabel={t(`protection.issue.${p.id}.title`)}
            className="flex-row items-center gap-3 bg-surface px-3 py-3 active:opacity-70"
          >
            <Ionicons
              name={p.severidade === "critica" ? "close-circle" : "alert-circle-outline"}
              size={18}
              color={p.severidade === "critica" ? colors.danger[500] : colors.warning[500]}
            />
            <View className="flex-1">
              <Text variant="body-strong">{t(`protection.issue.${p.id}.title`)}</Text>
              <Text variant="caption" color="muted">
                {t(`protection.issue.${p.id}.body`)}
              </Text>
            </View>
            {p.resolver ? (
              <Ionicons name="chevron-forward" size={16} color={colors["ink-subtle"]} />
            ) : null}
          </Pressable>
        ))}
      </View>
    </Card>
  );
}
