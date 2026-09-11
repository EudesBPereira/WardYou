import { useEffect, useState } from "react";
import { View, ActivityIndicator, Pressable, Modal, TextInput } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { ScreenContainer, ScreenHeader, Card, Text, Toggle, ListItem, Button, Badge } from "@/components/ui";
import { colors } from "@/theme";
import {
  usePolicy,
  useUpsertPolicy,
  useRemoteAction,
  useChildTasks,
  useCreateTask,
  useDeleteTask,
  usePendingCompletions,
  useDecideCompletion,
} from "@/features/parental/queries";
import { PendingRequestsCard } from "@/features/parental/PendingRequestsCard";
import { confirmSensitive } from "@/services/auth/confirmSensitive";

const STEP = 15;

// Presets for a task's screen-time reward. Deliberately its OWN constant —
// NOT reused from STEP (the daily-limit adjustment step) even though both are
// currently 15, so that changing one doesn't silently change the other.
const TASK_REWARD_OPTIONS = [10, 15, 30, 60];

export default function ChildDetailScreen() {
  const { t } = useTranslation();
  const { childUserId } = useLocalSearchParams<{ childUserId: string }>();
  const { data: policy, isLoading } = usePolicy(childUserId);
  const upsert = useUpsertPolicy(childUserId);
  const remote = useRemoteAction(childUserId);
  const { data: tasks = [] } = useChildTasks(childUserId);
  const createTask = useCreateTask(childUserId);
  const deleteTask = useDeleteTask(childUserId);
  // Task completions awaiting this guardian's approval, across all their
  // children — filtered down to this one below. Same endpoint/hook the
  // dedicated approvals screen (app/parental/index.tsx) uses, so a decision
  // made here shows up there too (and vice versa) via the shared cache key.
  const { data: pendingCompletions = [] } = usePendingCompletions();
  const decideCompletion = useDecideCompletion();
  const [taskOpen, setTaskOpen] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskReward, setTaskReward] = useState(TASK_REWARD_OPTIONS[1]);
  const [pausePickerOpen, setPausePickerOpen] = useState(false);

  useEffect(() => {
    if (taskOpen) {
      setTaskTitle("");
      setTaskReward(TASK_REWARD_OPTIONS[1]);
    }
  }, [taskOpen]);

  // Kids360-style timed pause: minutes → auto-lifts; null → until Resume.
  const PAUSE_OPTIONS: { minutes: number | null; labelKey: string }[] = [
    { minutes: 30, labelKey: "parental.remote.pause30m" },
    { minutes: 60, labelKey: "parental.remote.pause1h" },
    { minutes: 120, labelKey: "parental.remote.pause2h" },
    { minutes: null, labelKey: "parental.remote.pauseIndefinite" },
  ];
  function startPause(minutes: number | null) {
    setPausePickerOpen(false);
    remote.mutate({ action: "Pause", ...(minutes ? { durationMinutes: minutes } : {}) });
  }

  async function saveLimit(next: { limit?: number; enabled?: boolean }) {
    if (!policy) return;
    // DESLIGAR a protecao exige a autenticacao do responsavel. Ligar e ajustar
    // o limite nao — so a acao que remove protecao. Sem isto, a crianca que
    // pegar o telefone do pai desbloqueado desliga tudo com um toque.
    if (next.enabled === false && !(await confirmSensitive(t("parental.confirmDisable")))) {
      return;
    }
    upsert.mutate({
      dailyScreenTimeLimitMinutes: Math.max(STEP, next.limit ?? policy.dailyScreenTimeLimitMinutes),
      isEnabled: next.enabled ?? policy.isEnabled,
    });
  }

  async function handleCreateTask() {
    if (!taskTitle.trim()) return;
    try {
      await createTask.mutateAsync({ title: taskTitle.trim(), rewardMinutes: taskReward });
      setTaskOpen(false);
    } catch {
      /* keep modal open */
    }
  }

  const cid = childUserId as string;
  // One pending completion per task, keyed by the task it's for — lets the
  // list below flag a task that's waiting on approval instead of looking
  // exactly like one nobody has touched yet.
  const pendingCompletionByTask = new Map(
    pendingCompletions.filter((c) => c.childUserId === cid).map((c) => [c.childTaskId, c] as const),
  );
  const links: { key: string; icon: keyof typeof Ionicons.glyphMap; href: string }[] = [
    { key: "apps", icon: "apps", href: `/parental/${cid}/apps` },
    { key: "schedules", icon: "time", href: `/parental/${cid}/schedules` },
    { key: "usage", icon: "stats-chart", href: `/parental/${cid}/usage` },
    { key: "websites", icon: "globe", href: `/parental/${cid}/websites` },
  ];

  return (
    <ScreenContainer>
      <ScreenHeader title={t("parental.policy.title")} onBack={() => router.back()} />

      {/* Pending approvals first — they're time-sensitive (the child is
          waiting right now), unlike the policy settings below. */}
      <PendingRequestsCard childUserId={cid} />

      {isLoading || !policy ? (
        <ActivityIndicator className="mt-10" color={colors.brand[500]} />
      ) : (
        <>
          <Card className="mt-2 gap-4">
            <View className="flex-row items-center justify-between">
              <View className="flex-1 pr-3">
                <Text variant="title">{t("parental.policy.enabled")}</Text>
                <Text variant="caption" color="muted">
                  {t("parental.policy.enabledBody")}
                </Text>
              </View>
              <Toggle
                value={policy.isEnabled}
                onValueChange={(enabled) => saveLimit({ enabled })}
              />
            </View>

            <View className="h-px bg-border" />

            <View>
              <Text variant="title">{t("parental.policy.limit")}</Text>
              <View className="mt-2 flex-row items-center justify-between">
                <Pressable
                  accessibilityRole="button"
                  disabled={upsert.isPending}
                  onPress={() => saveLimit({ limit: policy.dailyScreenTimeLimitMinutes - STEP })}
                  className="h-11 w-11 items-center justify-center rounded-2xl bg-surface-alt active:opacity-70"
                >
                  <Ionicons name="remove" size={22} color={colors.ink} />
                </Pressable>
                <Text variant="h2">{t("parental.minutes", { n: policy.dailyScreenTimeLimitMinutes })}</Text>
                <Pressable
                  accessibilityRole="button"
                  disabled={upsert.isPending}
                  onPress={() => saveLimit({ limit: policy.dailyScreenTimeLimitMinutes + STEP })}
                  className="h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 active:opacity-70"
                >
                  <Ionicons name="add" size={22} color={colors.brand[500]} />
                </Pressable>
              </View>
            </View>

            <View className="h-px bg-border" />

            {/* Remote pause/resume (pause optionally timed — auto-lifts) */}
            <View className="flex-row items-center justify-between">
              <View className="flex-1 pr-3">
                <Text variant="title">{t("parental.remote.title")}</Text>
                <Text variant="caption" color="muted">
                  {policy.isRemotelyPaused
                    ? policy.pausedUntil
                      ? t("parental.remote.pausedUntil", {
                          time: new Date(policy.pausedUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                        })
                      : t("parental.remote.paused")
                    : t("parental.remote.active")}
                </Text>
              </View>
              {policy.isRemotelyPaused ? (
                <Button
                  label={t("parental.remote.resume")}
                  size="sm"
                  fullWidth={false}
                  icon="play"
                  loading={remote.isPending}
                  onPress={() => remote.mutate({ action: "Resume" })}
                />
              ) : (
                <Button
                  label={t("parental.remote.pause")}
                  size="sm"
                  variant="danger"
                  fullWidth={false}
                  icon="pause"
                  loading={remote.isPending}
                  onPress={() => setPausePickerOpen(true)}
                />
              )}
            </View>
          </Card>

          {/* Sub-screens */}
          <Card padded={false} className="mt-4 px-4">
            {links.map((l, i) => (
              <View key={l.key}>
                {i > 0 ? <View className="h-px bg-border" /> : null}
                <ListItem
                  icon={l.icon}
                  iconTone="brand"
                  title={t(`parental.menu.${l.key}`)}
                  showChevron
                  onPress={() => router.navigate(l.href as never)}
                />
              </View>
            ))}
          </Card>

          {/* Tasks */}
          <View className="mt-6 flex-row items-center justify-between">
            <Text variant="h2">{t("parental.tasks")}</Text>
            <Pressable onPress={() => setTaskOpen(true)} hitSlop={8}>
              <Text variant="label" color="brand">
                {t("parental.tasksAdd")}
              </Text>
            </Pressable>
          </View>

          {tasks.length === 0 ? (
            <Card className="mt-3">
              <Text variant="body" color="muted">
                {t("parental.tasksEmpty")}
              </Text>
            </Card>
          ) : (
            <Card padded={false} className="mt-3 px-4">
              {tasks.map((task, i) => {
                const completion = pendingCompletionByTask.get(task.id);
                return (
                  <View key={task.id}>
                    {i > 0 ? <View className="h-px bg-border" /> : null}
                    <ListItem
                      icon="checkbox"
                      iconTone={completion ? "warning" : "safe"}
                      title={task.title}
                      subtitle={t("parental.taskReward", { n: task.rewardMinutes })}
                      trailing={
                        completion ? (
                          <View className="items-end gap-1.5">
                            <Badge label={t("parental.taskPendingApproval")} tone="warning" />
                            <View className="flex-row items-center gap-2">
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={t("common.reject")}
                                disabled={decideCompletion.isPending}
                                onPress={() => decideCompletion.mutate({ completionId: completion.id, approve: false })}
                                className="h-9 w-9 items-center justify-center rounded-full bg-surface-alt active:opacity-70"
                              >
                                <Ionicons name="close" size={16} color={colors.danger[500]} />
                              </Pressable>
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={t("common.approve")}
                                disabled={decideCompletion.isPending}
                                onPress={() => decideCompletion.mutate({ completionId: completion.id, approve: true })}
                                className="h-9 w-9 items-center justify-center rounded-full bg-safe-50 active:opacity-70"
                              >
                                <Ionicons name="checkmark" size={16} color={colors.safe[600]} />
                              </Pressable>
                            </View>
                          </View>
                        ) : (
                          <View className="flex-row items-center gap-2">
                            {!task.isActive ? <Badge label={t("parental.inactive")} tone="neutral" /> : null}
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={t("common.delete")}
                              onPress={() => deleteTask.mutate(task.id)}
                              className="h-9 w-9 items-center justify-center rounded-full bg-surface-alt active:opacity-70"
                            >
                              <Ionicons name="trash" size={16} color={colors.danger[500]} />
                            </Pressable>
                          </View>
                        )
                      }
                    />
                  </View>
                );
              })}
            </Card>
          )}
        </>
      )}

      {/* Task creation: title + reward preset. A custom modal (not the shared
          InputModal, which only takes one free-text field) so the guardian
          picks a reward chip instead of every task defaulting to the same
          fixed value. */}
      <Modal visible={taskOpen} transparent animationType="fade" onRequestClose={() => setTaskOpen(false)}>
        <Pressable
          className="flex-1 items-center justify-center bg-black/40 px-6"
          onPress={() => (createTask.isPending ? undefined : setTaskOpen(false))}
        >
          <Pressable className="w-full" onPress={() => {}}>
            <Card className="gap-3">
              <Text variant="title">{t("parental.taskCreate.title")}</Text>
              <Text variant="caption" color="muted">
                {t("parental.taskCreate.subtitle")}
              </Text>

              <View className="h-12 justify-center rounded-lg border border-border bg-surface px-3">
                <TextInput
                  className="font-body text-base text-ink"
                  placeholderTextColor={colors["ink-subtle"]}
                  placeholder={t("parental.taskCreate.placeholder")}
                  value={taskTitle}
                  onChangeText={setTaskTitle}
                  autoCapitalize="sentences"
                  editable={!createTask.isPending}
                  autoFocus
                  returnKeyType="done"
                />
              </View>

              <Text variant="label" color="muted" className="mt-1">
                {t("parental.taskCreate.rewardLabel")}
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {TASK_REWARD_OPTIONS.map((min) => (
                  <Pressable
                    key={min}
                    accessibilityRole="button"
                    accessibilityState={{ selected: taskReward === min }}
                    disabled={createTask.isPending}
                    onPress={() => setTaskReward(min)}
                    className={`rounded-full border px-4 py-2 active:opacity-70 ${
                      taskReward === min ? "border-brand-500 bg-brand-50" : "border-border bg-surface"
                    }`}
                  >
                    <Text variant="label" color={taskReward === min ? "brand" : "default"}>
                      {t("parental.minutes", { n: min })}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Button
                label={t("parental.tasksAdd")}
                loading={createTask.isPending}
                disabled={!taskTitle.trim()}
                onPress={handleCreateTask}
                className="mt-2"
              />
              <Button
                label={t("common.cancel")}
                variant="ghost"
                disabled={createTask.isPending}
                onPress={() => setTaskOpen(false)}
              />
            </Card>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Pause duration picker */}
      <Modal visible={pausePickerOpen} transparent animationType="fade" onRequestClose={() => setPausePickerOpen(false)}>
        <Pressable className="flex-1 items-center justify-center bg-black/40 px-6" onPress={() => setPausePickerOpen(false)}>
          <Pressable className="w-full" onPress={() => {}}>
            <Card className="gap-3">
              <Text variant="title">{t("parental.remote.pausePickerTitle")}</Text>
              <Text variant="caption" color="muted">
                {t("parental.remote.pausePickerSubtitle")}
              </Text>
              {PAUSE_OPTIONS.map((o) => (
                <Button
                  key={o.labelKey}
                  label={t(o.labelKey)}
                  variant={o.minutes ? "secondary" : "danger"}
                  onPress={() => startPause(o.minutes)}
                />
              ))}
            </Card>
          </Pressable>
        </Pressable>
      </Modal>
    </ScreenContainer>
  );
}
