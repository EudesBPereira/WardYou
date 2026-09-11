import { useState } from "react";
import { View, ActivityIndicator, Share, Alert, Pressable } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import {
  ScreenContainer,
  ScreenHeader,
  Card,
  Text,
  Avatar,
  Badge,
  ListItem,
  InputModal,
} from "@/components/ui";
import { colors } from "@/theme";
import { suppressNextRelock } from "@/stores/appLock";
import {
  useFamilyMembers,
  useMyFamilies,
  useCreateFamily,
  useFamilyInvite,
  useJoinFamily,
  useApproveMember,
  useRejectMember,
  type FamilyMemberVM,
} from "@/features/family/queries";
import { ProfileButton } from "@/components/ProfileButton";

function MemberRow({ member }: { member: FamilyMemberVM }) {
  const { t } = useTranslation();
  const low = member.battery <= 15;
  return (
    <ListItem
      leading={<Avatar name={member.name} uri={member.avatarUrl} status={member.status} />}
      title={member.name}
      subtitle={`${t(`roles.${member.role}`)} · ${member.locationLabel}`}
      onPress={() => router.navigate(`/family/${member.id}` as never)}
      trailing={
        <View className="flex-row items-center gap-2">
          {low ? (
            <Badge label={t("family.battery", { n: member.battery })} tone="warning" />
          ) : (
            <Text variant="mono" color="subtle">
              {member.battery}%
            </Text>
          )}
        </View>
      }
    />
  );
}

function PendingMembers({ members }: { members: FamilyMemberVM[] }) {
  const { t } = useTranslation();
  const approve = useApproveMember();
  const reject = useRejectMember();
  if (members.length === 0) return null;

  const busy = approve.isPending || reject.isPending;

  // The person already declared who they are during onboarding (child/elder/…),
  // so the admin just accepts or rejects — no need to re-pick the role. The
  // role can still be changed later in the member detail ("Alterar papel").
  return (
    <View className="mt-5">
      <Text variant="label" color="muted" className="mb-1">
        {t("family.pending.title")}
      </Text>
      <Card padded={false} className="px-4">
        {members.map((m, i) => (
          <View key={m.id}>
            {i > 0 ? <View className="h-px bg-border" /> : null}
            <ListItem
              leading={<Avatar name={m.name} uri={m.avatarUrl} />}
              title={m.name}
              subtitle={t("family.pending.subtitleRole", { role: t(`roles.${m.declaredRole}`) })}
              trailing={
                <View className="flex-row items-center gap-1">
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("common.reject")}
                    disabled={busy}
                    onPress={() => reject.mutate({ familyId: m.familyId, memberId: m.id })}
                    className="h-9 w-9 items-center justify-center rounded-full bg-surface-alt active:opacity-70"
                  >
                    <Ionicons name="close" size={18} color={colors.danger[500]} />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("common.approve")}
                    disabled={busy}
                    onPress={() => approve.mutate({ familyId: m.familyId, memberId: m.id })}
                    className="h-9 w-9 items-center justify-center rounded-full bg-safe-50 active:opacity-70"
                  >
                    <Ionicons name="checkmark" size={18} color={colors.safe[600]} />
                  </Pressable>
                </View>
              }
            />
          </View>
        ))}
      </Card>
    </View>
  );
}

function Group({ title, members }: { title: string; members: FamilyMemberVM[] }) {
  if (members.length === 0) return null;
  return (
    <View className="mt-5">
      <Text variant="label" color="muted" className="mb-1">
        {title}
      </Text>
      <Card padded={false} className="px-4">
        {members.map((m, i) => (
          <View key={m.id}>
            {i > 0 ? <View className="h-px bg-border" /> : null}
            <MemberRow member={m} />
          </View>
        ))}
      </Card>
    </View>
  );
}

export default function FamilyScreen() {
  const { t } = useTranslation();
  const { data: members = [], isLoading } = useFamilyMembers();
  const { data: families = [] } = useMyFamilies();
  const createFamily = useCreateFamily();
  const invite = useFamilyInvite();
  const join = useJoinFamily();

  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const hasFamily = families.length > 0;

  const pending = members.filter((m) => m.membershipStatus === "pending");
  const activeMembers = members.filter((m) => m.membershipStatus === "active");
  const responsibles = activeMembers.filter(
    (m) => m.role === "admin" || m.role === "guardian",
  );
  const dependents = activeMembers.filter(
    (m) => m.role === "child" || m.role === "elder",
  );

  async function handleInvite() {
    if (!hasFamily) {
      setCreateOpen(true);
      return;
    }
    try {
      const data = await invite.mutateAsync(families[0].id);
      suppressNextRelock();
      await Share.share({
        message: t("family.invite.shareMessage", { code: data.inviteCode, link: data.inviteLink }),
      }).catch(() => {
        // Web/no share sheet: show the code so it can be copied manually.
        Alert.alert(t("family.invite.title"), `${data.inviteCode}\n${data.inviteLink}`);
      });
    } catch {
      Alert.alert(t("family.invite.title"), t("auth.errors.generic"));
    }
  }

  async function handleCreate(name: string) {
    try {
      await createFamily.mutateAsync({ name });
      setCreateOpen(false);
    } catch {
      /* error surfaced by the disabled state; keep the modal open */
    }
  }

  async function handleJoin(code: string) {
    setJoinError(null);
    try {
      // Joining from an adult who's already in the app → plain member.
      await join.mutateAsync({ inviteCode: code.trim().toUpperCase() });
      setJoinOpen(false);
      Alert.alert(t("family.join.title"), t("family.join.success"));
    } catch {
      setJoinError(t("family.join.invalid"));
    }
  }

  return (
    <ScreenContainer>
      <ScreenHeader
        title={t("family.title")}
        subtitle={t("family.subtitle")}
        action={<ProfileButton />}
      />

      {/* Invite / create family */}
      <Card onPress={handleInvite} className="mt-2 flex-row items-center gap-3">
        <View className="h-11 w-11 items-center justify-center rounded-2xl bg-brand-50">
          <Ionicons name={hasFamily ? "link" : "add"} size={22} color={colors.brand[500]} />
        </View>
        <View className="flex-1">
          <Text variant="title">
            {hasFamily ? t("family.invite.title") : t("family.empty.action")}
          </Text>
          <Text variant="caption" color="muted">
            {hasFamily ? t("family.invite.subtitle") : t("family.empty.body")}
          </Text>
        </View>
        {invite.isPending ? (
          <ActivityIndicator color={colors.brand[500]} />
        ) : (
          <Ionicons name={hasFamily ? "share-outline" : "chevron-forward"} size={20} color={colors["ink-subtle"]} />
        )}
      </Card>

      {/* Join an existing family by pasting the invite code (child/member side). */}
      <Card
        onPress={() => {
          setJoinError(null);
          setJoinOpen(true);
        }}
        className="mt-3 flex-row items-center gap-3"
      >
        <View className="h-11 w-11 items-center justify-center rounded-2xl bg-surface-alt">
          <Ionicons name="enter-outline" size={22} color={colors["ink-muted"]} />
        </View>
        <View className="flex-1">
          <Text variant="title">{t("family.join.title")}</Text>
          <Text variant="caption" color="muted">
            {t("family.join.subtitle")}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors["ink-subtle"]} />
      </Card>

      {isLoading ? (
        <ActivityIndicator className="mt-10" color={colors.brand[500]} />
      ) : (
        <>
          <PendingMembers members={pending} />
          <Group title={t("family.responsibles")} members={responsibles} />
          <Group title={t("family.dependents")} members={dependents} />
        </>
      )}

      <InputModal
        visible={createOpen}
        title={t("family.create.title")}
        subtitle={t("family.create.subtitle")}
        placeholder={t("family.create.placeholder")}
        confirmLabel={t("family.empty.action")}
        autoCapitalize="words"
        loading={createFamily.isPending}
        onConfirm={handleCreate}
        onClose={() => setCreateOpen(false)}
      />

      <InputModal
        visible={joinOpen}
        title={t("family.join.title")}
        subtitle={t("family.join.subtitle")}
        placeholder={t("family.join.placeholder")}
        confirmLabel={t("family.join.title")}
        autoCapitalize="characters"
        loading={join.isPending}
        error={joinError}
        onConfirm={handleJoin}
        onClose={() => setJoinOpen(false)}
      />
    </ScreenContainer>
  );
}
