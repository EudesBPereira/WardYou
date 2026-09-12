import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Card, Text } from "@/components/ui";
import { colors } from "@/theme";
import type { TripSharingHealth } from "./useTripSharingHealth";

/**
 * "Os outros conseguem te acompanhar nesta viagem?"
 *
 * Existe porque o modo viajante tinha o mesmo defeito que perseguimos o dia
 * inteiro, na versao mais silenciosa de todas: a pessoa entrava na viagem,
 * via o mapa, aparecia na lista de membros -- e nao transmitia posicao
 * nenhuma. Quatro camadas engoliam a falha sem uma palavra (permissao negada
 * devolvendo `null` em silencio, quem chama nao olhando esse `null`, ninguem
 * checando o GPS do SISTEMA, e a falha do servico de segundo plano engolida
 * por um `.catch(() => {})`).
 *
 * Componente puramente de APRESENTACAO: quem mede e `useTripSharingHealth`
 * (ver la o porque da re-medicao periodica). Isso existe para a tela de
 * detalhe da viagem poder usar A MESMA medicao para o selo "Ao vivo" e para
 * a linha do proprio usuario -- um aviso dizendo "ninguem consegue te
 * acompanhar" a dois centimetros de um selo "Ao vivo" seria a mesma
 * contradicao que este card veio corrigir.
 *
 * So renderiza quando ha algo errado: numa viagem saudavel nao aparece nada.
 * Cobrar GPS de quem esta com tudo certo e como gritar perigo onde nao ha --
 * ensina a ignorar o aviso no dia em que ele importa.
 */
export function TripSharingStatusCard({ health }: { health: TripSharingHealth }) {
  const { t } = useTranslation();
  const { problemas, critico } = health;

  if (problemas.length === 0) return null;

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
        {problemas.map((p) => (
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
