import { View, ActivityIndicator } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { Card, Text, Button, Badge } from "@/components/ui";
import { colors } from "@/theme";
import { useChildRequests, useDecideAppAccess, useDecideExtraTime } from "./queries";

export interface PendingRequestsCardProps {
  childUserId: string;
  /** Section heading above the card (omitted when the host screen has one). */
  title?: string;
  className?: string;
}

/**
 * Everything this child is waiting on, with approve/reject right there — the
 * guardian used to only get a push notification, which is easy to miss and
 * impossible to act on later. Renders nothing when there's nothing pending, so
 * hosting screens can drop it in unconditionally.
 */
export function PendingRequestsCard({ childUserId, title, className }: PendingRequestsCardProps) {
  const { t } = useTranslation();
  const { data, isLoading } = useChildRequests(childUserId);
  const decideApp = useDecideAppAccess(childUserId);
  const decideExtra = useDecideExtraTime();

  const extraTime = data?.extraTime ?? [];
  const appAccess = data?.appAccess ?? [];
  const total = extraTime.length + appAccess.length;
  if (isLoading || total === 0) return null;

  return (
    <View className={className}>
      <View className="mb-3 mt-6 flex-row items-center gap-2">
        <Text variant="h2">{title ?? t("parental.requests.title")}</Text>
        <Badge label={String(total)} tone="warning" />
      </View>

      <Card className="gap-4">
        {/* Extra screen-time requests */}
        {extraTime.map((r) => (
          <View key={r.id} className="gap-3">
            <View className="flex-row items-center gap-3">
              <View className="h-11 w-11 items-center justify-center rounded-2xl bg-brand-50">
                <Ionicons name="time" size={22} color={colors.brand[500]} />
              </View>
              <View className="flex-1">
                <Text variant="title">{t("parental.requests.extraTitle", { min: r.requestedMinutes })}</Text>
                <Text variant="caption" color="muted">
                  {t("parental.requests.extraBody")}
                </Text>
              </View>
            </View>
            <View className="flex-row gap-2">
              <Button
                label={t("parental.requests.approve")}
                size="sm"
                className="flex-1"
                loading={decideExtra.isPending}
                onPress={() => decideExtra.mutate({ requestId: r.id, approve: true })}
              />
              <Button
                label={t("parental.requests.reject")}
                size="sm"
                variant="secondary"
                className="flex-1"
                onPress={() => decideExtra.mutate({ requestId: r.id, approve: false })}
              />
            </View>
          </View>
        ))}

        {extraTime.length > 0 && appAccess.length > 0 ? <View className="h-px bg-border" /> : null}

        {/* "Let me use this app" requests from the blocked screen */}
        {appAccess.map((r) => (
          <View key={r.packageName} className="gap-3">
            <View className="flex-row items-center gap-3">
              <View className="h-11 w-11 items-center justify-center rounded-2xl bg-brand-50">
                <Ionicons name="lock-open" size={22} color={colors.brand[500]} />
              </View>
              <View className="flex-1">
                <Text variant="title">{r.label}</Text>
                <Text variant="caption" color="muted">
                  {t("parental.requests.appBody")}
                </Text>
              </View>
            </View>
            <View className="flex-row gap-2">
              <Button
                label={t("parental.requests.allow")}
                size="sm"
                className="flex-1"
                loading={decideApp.isPending}
                onPress={() => decideApp.mutate({ packageName: r.packageName, approve: true })}
              />
              <Button
                label={t("parental.requests.allow1h")}
                size="sm"
                variant="secondary"
                className="flex-1"
                onPress={() => decideApp.mutate({ packageName: r.packageName, approve: true, hours: 1 })}
              />
              <Button
                label={t("parental.requests.reject")}
                size="sm"
                variant="ghost"
                onPress={() => decideApp.mutate({ packageName: r.packageName, approve: false })}
              />
            </View>
          </View>
        ))}

        {decideApp.isPending || decideExtra.isPending ? (
          <ActivityIndicator color={colors.brand[500]} />
        ) : null}
      </Card>
    </View>
  );
}
