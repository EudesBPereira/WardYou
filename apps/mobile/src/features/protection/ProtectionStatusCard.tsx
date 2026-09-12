import { useCallback, useEffect, useState } from "react";
import { AppState, Platform, Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Card, Text } from "@/components/ui";
import { colors } from "@/theme";
import { diagnosticar, type Diagnostico, type NivelProtecao } from "./diagnostics";

const ICONE: Record<NivelProtecao, keyof typeof Ionicons.glyphMap> = {
  completa: "shield-checkmark",
  limitada: "shield-half",
  acao: "alert-circle",
  offline: "cloud-offline",
};

function tomDoNivel(nivel: NivelProtecao) {
  switch (nivel) {
    case "completa": return { cor: colors.safe[500], fundo: colors.safe[50] };
    case "limitada": return { cor: colors.warning[500], fundo: colors.warning[100] };
    case "acao":     return { cor: colors.danger[500], fundo: colors.danger[50] };
    case "offline":  return { cor: colors["ink-subtle"], fundo: colors["surface-alt"] };
  }
}

/**
 * Painel de estado da protecao.
 *
 * Substitui a fila de cards que apareciam UM DE CADA VEZ (acessibilidade ->
 * depois uso -> depois blindagem). Aquele desenho escondia o tamanho da tarefa:
 * a pessoa resolvia um, achava que tinha acabado, e no dia seguinte aparecia
 * outro. Aqui tudo que falta e listado de uma vez, com contagem, e cada item
 * leva direto para a tela de sistema que resolve.
 *
 * Usa o mesmo vocabulario de status do resto do produto: protecao completa,
 * limitada, acao necessaria, offline.
 */
export function ProtectionStatusCard({ modoCrianca }: { modoCrianca: boolean }) {
  const { t } = useTranslation();
  const [diag, setDiag] = useState<Diagnostico | null>(null);

  const medir = useCallback(() => {
    diagnosticar({ modoCrianca }).then(setDiag).catch(() => setDiag(null));
  }, [modoCrianca]);

  // Remede ao voltar do segundo plano: resolver uma permissao acontece FORA do
  // app, entao sem isto o painel continuaria mostrando o problema ja resolvido.
  useEffect(() => {
    medir();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") medir();
    });
    return () => sub.remove();
  }, [medir]);

  if (!diag) return null;

  const { nivel, problemas, oemAgressiva } = diag;
  const tom = tomDoNivel(nivel);
  const criticos = problemas.filter((p) => p.severidade === "critica").length;

  return (
    <Card className="mt-2 gap-3" style={{ borderColor: tom.cor, borderWidth: 1 }}>
      <View className="flex-row items-center gap-3">
        <View
          className="h-12 w-12 items-center justify-center rounded-2xl"
          style={{ backgroundColor: tom.fundo }}
        >
          <Ionicons name={ICONE[nivel]} size={24} color={tom.cor} />
        </View>
        <View className="flex-1">
          <Text variant="title" style={{ color: tom.cor }}>
            {t(`protection.level.${nivel}`)}
          </Text>
          <Text variant="caption" color="muted">
            {nivel === "completa"
              ? t("protection.allGood")
              : t("protection.pending", { n: problemas.length, criticos })}
          </Text>
        </View>
      </View>

      {problemas.length > 0 ? (
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
                {/* Instrucao literal do caminho na MIUI e afins — foi onde ate o
                    proprio fundador travou ao ativar a acessibilidade. */}
                {oemAgressiva && Platform.OS === "android" && temDicaOem(p.id) ? (
                  <Text variant="caption" style={{ color: colors.brand[500] }}>
                    {t(`protection.issue.${p.id}.oemHint`)}
                  </Text>
                ) : null}
              </View>
              {p.resolver ? (
                <Ionicons name="chevron-forward" size={16} color={colors["ink-subtle"]} />
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

/** Só estes têm texto de caminho por fabricante; os demais caem no genérico. */
function temDicaOem(id: string): boolean {
  return (
    id === "accessibility" || id === "accessibilityDead" || id === "usageAccess" || id === "battery"
  );
}
