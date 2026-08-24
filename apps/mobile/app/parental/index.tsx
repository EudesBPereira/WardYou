import { View, ActivityIndicator, Pressable } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, ScreenHeader, Card, Text, ListItem, Avatar, Button } from "@/components/ui";
import { colors } from "@/theme";
import {
  useChildren,
  usePendingExtraTime,
  useDecideExtraTime,
  usePendingCompletions,
  useDecideCompletion,
} from "@/features/parental/queries";

function ApproveRejectRow({
  title,
  subtitle,
  busy,
  onApprove,
  onReject,
}: {
  title: string;
  subtitle: string;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ListItem
      title={title}
      subtitle={subtitle}
      trailing={
        <View className="flex-row items-center gap-1">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("common.reject")}
            disabled={busy}
            onPress={onReject}
            className="h-9 w-9 items-center justify-center rounded-full bg-surface-alt active:opacity-70"
          >
            <Ionicons name="close" size={18} color={colors.danger[500]} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("common.approve")}
            disabled={busy}
            onPress={onApprove}
            className="h-9 w-9 items-center justify-center rounded-full bg-safe-50 active:opacity-70"
          >
            <Ionicons name="checkmark" size={18} color={colors.safe[600]} />
          </Pressable>
        </View>
      }
    />
  );
}

/** Step-by-step for binding a child device — the missing link when a parent
 *  lands here and sees no children yet. The invite lives on the Family tab. */
function AddChildGuide() {
  const { t } = useTranslation();
  return (
    <Card className="mt-2 gap-3">
      <View className="flex-row items-center gap-3">
        <View className="h-11 w-11 items-center justify-center rounded-2xl bg-brand-50">
          <Ionicons name="sparkles" size={22} color={colors.brand[500]} />
        </View>
        <Text variant="title" className="flex-1">
          {t("parental.addChild.title")}
        </Text>
      </View>
      <Text variant="body" color="muted">
        {t("parental.addChild.body")}
      </Text>
      <Button
        label={t("parental.addChild.invite")}
        icon="person-add"
        onPress={() => router.navigate("/(tabs)/family" as never)}
      />
    </Card>
  );
}

export default function ParentalScreen() {
  const { t } = useTranslation();
  const { data: children = [], isLoading } = useChildren();
  const { data: extraTime = [] } = usePendingExtraTime();
  const { data: completions = [] } = usePendingCompletions();
  const decideExtra = useDecideExtraTime();
  const decideCompletion = useDecideCompletion();

  const hasPending = extraTime.length > 0 || completions.length > 0;

  return (
    <ScreenContainer>
      <ScreenHeader title={t("parental.title")} subtitle={t("parental.subtitle")} onBack={() => router.back()} />

      {hasPending ? (
        <View className="mt-2">
          <Text variant="label" color="muted" className="mb-1">
            {t("parental.pending")}
          </Text>
          <Card padded={false} className="px-4">
            {extraTime.map((r, i) => (
              <View key={r.id}>
                {i > 0 ? <View className="h-px bg-border" /> : null}
                <ApproveRejectRow
                  title={t("parental.extraTime", { n: r.requestedMinutes })}
                  subtitle={t("parental.extraTimeSubtitle")}
                  busy={decideExtra.isPending}
                  onApprove={() => decideExtra.mutate({ requestId: r.id, approve: true })}
                  onReject={() => decideExtra.mutate({ requestId: r.id, approve: false })}
                />
              </View>
            ))}
            {completions.map((c, i) => (
              <View key={c.id}>
                {(i > 0 || extraTime.length > 0) ? <View className="h-px bg-border" /> : null}
                <ApproveRejectRow
                  title={c.title}
                  subtitle={t("parental.taskReward", { n: c.rewardMinutes })}
                  busy={decideCompletion.isPending}
                  onApprove={() => decideCompletion.mutate({ completionId: c.id, approve: true })}
                  onReject={() => decideCompletion.mutate({ completionId: c.id, approve: false })}
                />
              </View>
            ))}
          </Card>
        </View>
      ) : null}

      <Text variant="label" color="muted" className="mb-1 mt-5">
        {t("parental.children")}
      </Text>
      {isLoading ? (
        <ActivityIndicator className="mt-6" color={colors.brand[500]} />
      ) : children.length === 0 ? (
        <>
          <Card className="items-center gap-2 py-8">
            <Ionicons name="happy-outline" size={28} color={colors["ink-subtle"]} />
            <Text variant="body" color="muted">
              {t("parental.empty")}
            </Text>
          </Card>
          <AddChildGuide />
        </>
      ) : (
        <>
          <Card padded={false} className="px-4">
            {children.map((c, i) => (
              <View key={c.memberId}>
                {i > 0 ? <View className="h-px bg-border" /> : null}
                <ListItem
                  leading={
                    <Avatar
                      name={c.fullName}
                      uri={c.avatarUrl}
                      status={c.isConnected ? "online" : "offline"}
                    />
                  }
                  title={c.fullName}
                  subtitle={c.isConnected ? t("parental.connected") : t("parental.disconnected")}
                  showChevron
                  onPress={() => router.navigate(`/parental/${c.userId}` as never)}
                />
              </View>
            ))}
          </Card>
          <AddChildGuide />
        </>
      )}
    </ScreenContainer>
  );
}
