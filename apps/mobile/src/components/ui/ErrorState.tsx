import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Card } from "./Card";
import { Text } from "./Text";
import { Button } from "./Button";
import { colors } from "@/theme";

export interface ErrorStateProps {
  /** Refetch da query que falhou. Sem isto o usuario fica sem saida. */
  onRetry?: () => void;
  /** Mensagem especifica; por padrao usa `common.loadError`. */
  message?: string;
  /** `true` enquanto o refetch dispara, para travar o botao. */
  retrying?: boolean;
  className?: string;
}

/**
 * Estado de falha de carregamento — o par do `ActivityIndicator`.
 *
 * Ate 2026-09-09 nenhuma tela tratava `isError`: quando uma query do TanStack
 * Query falhava depois das 2 tentativas, o spinner girava para sempre, sem
 * mensagem e sem saida. Isso fazia qualquer falha de rede (aviao, metro, 3G
 * ruim, backend dormindo) parecer app travado.
 *
 * Segue o mesmo formato do estado vazio das telas (Card centralizado, icone,
 * texto muted) para nao introduzir um vocabulario visual novo — o que muda e o
 * icone de alerta e a presenca de uma acao de recuperacao.
 */
export function ErrorState({ onRetry, message, retrying, className }: ErrorStateProps) {
  const { t } = useTranslation();
  return (
    <Card className={`mt-2 items-center gap-3 py-8 ${className ?? ""}`}>
      <Ionicons name="cloud-offline-outline" size={28} color={colors["ink-subtle"]} />
      <Text variant="body" color="muted" className="text-center">
        {message ?? t("common.loadError")}
      </Text>
      {onRetry ? (
        <Button
          label={t("common.retry")}
          variant="secondary"
          size="sm"
          onPress={onRetry}
          loading={retrying}
        />
      ) : null}
    </Card>
  );
}
