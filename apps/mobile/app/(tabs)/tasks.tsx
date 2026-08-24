import { useEffect, useState } from "react";
import { View, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import {
  ScreenContainer,
  ScreenHeader,
  Card,
  Text,
  Badge,
  Button,
  InputModal,
} from "@/components/ui";
import { colors } from "@/theme";
import { useMyProfile } from "@/features/profile/queries";
import { useMyTasks, useCompleteTask } from "@/features/parental/childQueries";
import { ProfileButton } from "@/components/ProfileButton";
import type { TaskDto } from "@/features/parental/queries";

const CATEGORY_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  Educational: "book",
  Household: "home",
  Physical: "bicycle",
  Habit: "repeat",
  Other: "star",
};

/** Child mode: the "earn more screen time" screen. Lists the tasks guardians
 *  created, lets the child submit a completion (with an optional note) and
 *  shows the review status of recent submissions. */
export default function TasksScreen() {
  const { t } = useTranslation();
  const { data: profile } = useMyProfile();
  const { data, isLoading } = useMyTasks(profile?.appProfile === "child");
  const complete = useCompleteTask();
  const [noteFor, setNoteFor] = useState<TaskDto | null>(null);

  // This tab only exists for children; anyone landing here goes home.
  useEffect(() => {
    if (profile && profile.appProfile !== "child") router.replace("/(tabs)" as never);
  }, [profile]);

  const tasks = data?.tasks ?? [];
  const completions = data?.completions ?? [];
  const pendingTaskIds = new Set(
    completions.filter((c) => c.status === "PendingApproval").map((c) => c.childTaskId),
  );
  const recent = completions.slice(0, 8);

  function submit(task: TaskDto, note: string) {
    complete.mutate({ taskId: task.id, childNote: note.trim() || undefined });
    setNoteFor(null);
  }

  return (
    <ScreenContainer>
      <ScreenHeader
        title={t("childTasks.title")}
        subtitle={t("childTasks.subtitle")}
        action={<ProfileButton />}
      />

      {isLoading ? <ActivityIndicator className="mt-8" color={colors.brand[500]} /> : null}

      {!isLoading && tasks.length === 0 ? (
        <Card className="mt-4 items-center gap-2 py-10">
          <View className="h-16 w-16 items-center justify-center rounded-full bg-surface-alt">
            <Ionicons name="trophy-outline" size={30} color={colors["ink-muted"]} />
          </View>
          <Text variant="title">{t("childTasks.empty.title")}</Text>
          <Text variant="body" color="muted" className="text-center">
            {t("childTasks.empty.body")}
          </Text>
        </Card>
      ) : null}

      {tasks.map((task) => {
        const waiting = pendingTaskIds.has(task.id);
        return (
          <Card key={task.id} className="mt-4 gap-3">
            <View className="flex-row items-center gap-3">
              <View className="h-11 w-11 items-center justify-center rounded-2xl bg-brand-50">
                <Ionicons
                  name={CATEGORY_ICONS[task.category] ?? "star"}
                  size={22}
                  color={colors.brand[500]}
                />
              </View>
              <View className="flex-1">
                <Text variant="title">{task.title}</Text>
                {task.description ? (
                  <Text variant="caption" color="muted">
                    {task.description}
                  </Text>
                ) : null}
              </View>
              <Badge label={`+${task.rewardMinutes}min`} tone="safe" />
            </View>
            {waiting ? (
              <View className="flex-row items-center gap-2 rounded-2xl bg-surface-alt px-3 py-2.5">
                <Ionicons name="hourglass" size={18} color={colors["ink-muted"]} />
                <Text variant="caption" color="muted">
                  {t("childTasks.waitingReview")}
                </Text>
              </View>
            ) : (
              <Button
                label={t("childTasks.done")}
                icon="checkmark-circle-outline"
                variant="secondary"
                loading={complete.isPending}
                onPress={() => setNoteFor(task)}
              />
            )}
          </Card>
        );
      })}

      {/* Recent submissions */}
      {recent.length > 0 ? (
        <>
          <Text variant="h2" className="mt-7">
            {t("childTasks.recent")}
          </Text>
          <Card padded={false} className="mt-3 px-4">
            {recent.map((c, i) => {
              const approved = c.status === "Approved";
              const rejected = c.status === "Rejected";
              return (
                <View key={c.id}>
                  {i > 0 ? <View className="h-px bg-border" /> : null}
                  <View className="flex-row items-center gap-3 py-3.5">
                    <Ionicons
                      name={approved ? "checkmark-circle" : rejected ? "close-circle" : "hourglass"}
                      size={22}
                      color={approved ? colors.safe[600] : rejected ? colors.danger[500] : colors["ink-muted"]}
                    />
                    <View className="flex-1">
                      <Text variant="body">{c.title}</Text>
                      <Text variant="caption" color="muted">
                        {approved
                          ? t("childTasks.approved", { min: c.rewardMinutes })
                          : rejected
                            ? c.parentNote || t("childTasks.rejected")
                            : t("childTasks.waitingReview")}
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </Card>
        </>
      ) : null}

      <InputModal
        visible={noteFor !== null}
        title={noteFor?.title ?? ""}
        subtitle={t("childTasks.noteSubtitle")}
        placeholder={t("childTasks.notePlaceholder")}
        confirmLabel={t("childTasks.send")}
        autoCapitalize="sentences"
        allowEmpty
        loading={complete.isPending}
        onConfirm={(note) => noteFor && submit(noteFor, note)}
        onClose={() => setNoteFor(null)}
      />
    </ScreenContainer>
  );
}
