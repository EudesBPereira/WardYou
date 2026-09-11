import { useEffect, useState } from "react";
import { View, ActivityIndicator, Pressable, Alert } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
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
  MapPreview,
  InputModal,
} from "@/components/ui";
import { colors } from "@/theme";
import { useSession } from "@/stores/session";
import {
  useFamilyMap,
  useMyFamilies,
  useSetMemberRole,
  useSetMemberAvatar,
  useSetMemberNickname,
} from "@/features/family/queries";
import { pickAvatarDataUri } from "@/features/profile/pickAvatar";
import { RoleSelectModal } from "@/features/family/RoleSelectModal";
import { PendingRequestsCard } from "@/features/parental/PendingRequestsCard";

export default function FamilyMemberDetailScreen() {
  const { t } = useTranslation();
  const { memberId } = useLocalSearchParams<{ memberId: string }>();
  const { data: members = [], isLoading } = useFamilyMap();
  const { data: families = [] } = useMyFamilies();
  const setRole = useSetMemberRole();
  const setAvatar = useSetMemberAvatar();
  const setNickname = useSetMemberNickname();
  const [roleOpen, setRoleOpen] = useState(false);
  const [nicknameOpen, setNicknameOpen] = useState(false);
  const myUserId = useSession((s) => s.session?.userId);

  const member = members.find((m) => m.id === memberId);
  // Viewing yourself: the location/battery/last-place readout is your own
  // device — there's nothing to "monitor". Send self to the profile screen,
  // the single home for your own account. Covers every entry point (family
  // list, home, direct link) in one place.
  const isSelf = !!member?.userId && member.userId === myUserId;
  useEffect(() => {
    if (isSelf) router.replace("/profile");
  }, [isSelf]);

  const myRole = families.find((f) => f.id === member?.familyId)?.myRole;
  const canManage = myRole === "admin" || myRole === "guardian";
  const isAdmin = myRole === "admin";

  // Photo is managed by the guardian here (a child rarely sets their own) —
  // same pick → resize → data-URI flow the adult uses on their profile.
  async function pickAndUpload() {
    if (!member) return;
    try {
      const dataUri = await pickAvatarDataUri();
      if (!dataUri) return; // cancelled or permission denied
      await setAvatar.mutateAsync({ familyId: member.familyId, memberId: member.id, avatarUrl: dataUri });
    } catch {
      Alert.alert(t("profile.photoTitle"), t("profile.photoError"));
    }
  }

  function onAvatarPress() {
    if (!member || !canManage || setAvatar.isPending) return;
    if (!member.avatarUrl) {
      pickAndUpload();
      return;
    }
    Alert.alert(t("profile.photoTitle"), undefined, [
      { text: t("profile.changePhoto"), onPress: pickAndUpload },
      {
        text: t("profile.removePhoto"),
        style: "destructive",
        onPress: () =>
          setAvatar
            .mutateAsync({ familyId: member.familyId, memberId: member.id, avatarUrl: null })
            .catch(() => Alert.alert(t("profile.photoTitle"), t("profile.photoError"))),
      },
      { text: t("common.cancel"), style: "cancel" },
    ]);
  }

  // Bug de campo #4: this screen used to show "Online agora · 09/11, 2:23 PM"
  // as one string — `status` comes from the heartbeat (`family_members.
  // LastSeenAt`, bumped every time the app pings in) while the timestamp came
  // from `locationCapturedAt` (the last GPS fix, only reported when the
  // child's app is opened — see `useReportLocationOnOpen` — with no periodic
  // background reporting outside an active trip). Gluing them together read
  // as "this position is current", when the position can be hours old while
  // the device is genuinely online. Keep them as two separate, separately
  // labeled facts instead: presence uses the heartbeat's own timestamp (and
  // only shows one at all when NOT currently online — "current" already says
  // so), and the location card gets its own "visto {{time}}" caption sourced
  // from `locationCapturedAt`.
  const presenceLastSeen = member?.lastSeen
    ? new Date(member.lastSeen).toLocaleString([], {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;
  const locationSeenAt = member?.locationCapturedAt
    ? new Date(member.locationCapturedAt).toLocaleString([], {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <ScreenContainer>
      <ScreenHeader
        title={member?.name ?? t("family.title")}
        subtitle={member ? t(`roles.${member.role}`) : undefined}
        onBack={() => router.back()}
        action={
          member && !isSelf ? (
            <Pressable
              accessibilityRole={canManage ? "button" : "image"}
              accessibilityLabel={canManage ? t("family.memberDetail.changePhoto") : member.name}
              disabled={!canManage || setAvatar.isPending}
              onPress={onAvatarPress}
              className="relative active:opacity-80"
            >
              <Avatar name={member.name} uri={member.avatarUrl} size="md" status={member.status} />
              {canManage ? (
                <View className="absolute -bottom-0.5 -right-0.5 h-6 w-6 items-center justify-center rounded-full border-2 border-surface bg-brand-500">
                  {setAvatar.isPending ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Ionicons name="camera" size={12} color="#FFFFFF" />
                  )}
                </View>
              ) : null}
            </Pressable>
          ) : undefined
        }
      />

      {isLoading || !member || isSelf ? (
        <ActivityIndicator className="mt-10" color={colors.brand[500]} />
      ) : (
        <>
          {/* Last known location */}
          <View className="mt-6 flex-row items-baseline justify-between">
            <Text variant="h2">{t("family.memberDetail.locationTitle")}</Text>
            {locationSeenAt ? (
              <Text variant="caption" color="muted">
                {t("family.memberDetail.lastSeen", { time: locationSeenAt })}
              </Text>
            ) : null}
          </View>
          <Card padded={false} className="mt-3 overflow-hidden">
            {member.latitude != null && member.longitude != null ? (
              <MapPreview
                latitude={member.latitude}
                longitude={member.longitude}
                markers={[
                  { id: member.id, latitude: member.latitude, longitude: member.longitude, label: member.name },
                ]}
                height={180}
              />
            ) : (
              <View className="h-[180px] items-center justify-center gap-2 px-6">
                <Ionicons
                  name={member.canViewLocation ? "location-outline" : "eye-off-outline"}
                  size={28}
                  color={colors["ink-subtle"]}
                />
                <Text variant="caption" color="muted" className="text-center">
                  {member.canViewLocation
                    ? t("family.memberDetail.noLocation")
                    : t("family.memberDetail.locationHidden")}
                </Text>
              </View>
            )}
          </Card>

          {/* Details */}
          <Card padded={false} className="mt-6 px-4">
            <ListItem
              icon="battery-half"
              title={t("family.memberDetail.battery")}
              trailing={
                member.battery > 0 ? (
                  <Badge label={`${member.battery}%`} tone={member.battery <= 15 ? "warning" : "neutral"} />
                ) : (
                  <Text variant="mono" color="subtle">
                    —
                  </Text>
                )
              }
            />
            <View className="h-px bg-border" />
            {/* Endereco vai como subtitulo, nao como valor a direita: rotulo
                curto + valor longo na mesma linha nao cabe em tela de telefone,
                e um endereco completo nunca e curto. */}
            <ListItem
              icon="location"
              title={t("family.memberDetail.lastPlace")}
              subtitle={member.locationLabel}
            />
            {/* Presence moved here from the old hero card: still worth showing,
                just not worth a card of its own. */}
            <View className="h-px bg-border" />
            <ListItem
              icon="pulse"
              title={t("family.memberDetail.presence")}
              trailing={
                <Text variant="caption" color="muted">
                  {t(`family.memberDetail.status.${member.status}`)}
                  {member.status !== "online" && presenceLastSeen ? ` · ${presenceLastSeen}` : ""}
                </Text>
              }
            />
          </Card>

          {/* Anything this child is waiting on (extra time, app unlock), with
              approve/reject inline — a push alone was easy to miss and gave
              the guardian nowhere to act on it later. */}
          {canManage && member.userId && member.role === "child" ? (
            <PendingRequestsCard childUserId={member.userId} />
          ) : null}

          {/* Manage shortcuts (admins/guardians) */}
          {canManage ? (
            <>
              <Text variant="h2" className="mt-6">
                {t("family.memberDetail.manage")}
              </Text>
              <Card padded={false} className="mt-3 px-4">
                {/* Apelido: how this member's name shows up across the app —
                    the fix for two members sharing a real name (e.g. two
                    "Tatiane Silva"), most dangerous in the Consent Center
                    where an admin grants/revokes location "on behalf of" a
                    name. Optional: empty keeps the real name, as before. */}
                <ListItem
                  icon="pricetag"
                  iconTone="neutral"
                  title={t("family.memberDetail.nickname")}
                  subtitle={member.nickname || t("family.memberDetail.nicknameEmpty")}
                  onPress={() => setNicknameOpen(true)}
                  trailing={
                    setNickname.isPending ? (
                      <ActivityIndicator color={colors.brand[500]} />
                    ) : (
                      <Ionicons name="chevron-forward" size={18} color={colors["ink-subtle"]} />
                    )
                  }
                />
                {member.userId && member.role === "child" ? (
                  <>
                    <View className="h-px bg-border" />
                    <ListItem
                      icon="shield-checkmark"
                      iconTone="brand"
                      title={t("family.memberDetail.parental")}
                      subtitle={t("family.memberDetail.parentalBody")}
                      onPress={() => router.navigate(`/parental/${member.userId}` as never)}
                      trailing={<Ionicons name="chevron-forward" size={18} color={colors["ink-subtle"]} />}
                    />
                  </>
                ) : null}
                {member.userId && member.role === "elder" ? (
                  <>
                    <View className="h-px bg-border" />
                    <ListItem
                      icon="medkit"
                      iconTone="brand"
                      title={t("family.memberDetail.elder")}
                      subtitle={t("family.memberDetail.elderBody")}
                      onPress={() => router.navigate(`/elder/${member.userId}` as never)}
                      trailing={<Ionicons name="chevron-forward" size={18} color={colors["ink-subtle"]} />}
                    />
                  </>
                ) : null}
                {isAdmin ? (
                  <>
                    <View className="h-px bg-border" />
                    <ListItem
                      icon="swap-horizontal"
                      iconTone="neutral"
                      title={t("family.memberDetail.changeRole")}
                      subtitle={t("family.memberDetail.changeRoleBody")}
                      onPress={() => setRoleOpen(true)}
                      trailing={
                        setRole.isPending ? (
                          <ActivityIndicator color={colors.brand[500]} />
                        ) : (
                          <Ionicons name="chevron-forward" size={18} color={colors["ink-subtle"]} />
                        )
                      }
                    />
                  </>
                ) : null}
              </Card>
            </>
          ) : null}
        </>
      )}

      <RoleSelectModal
        visible={roleOpen}
        title={t("family.roleSelect.title", { name: member?.name ?? "" })}
        subtitle={t("family.roleSelect.subtitle")}
        loading={setRole.isPending}
        onSelect={(role) => {
          if (!member) return;
          setRole.mutate(
            { familyId: member.familyId, memberId: member.id, role },
            { onSettled: () => setRoleOpen(false) },
          );
        }}
        onClose={() => setRoleOpen(false)}
      />

      <InputModal
        visible={nicknameOpen}
        title={t("family.memberDetail.nicknameTitle")}
        subtitle={t("family.memberDetail.nicknameSubtitle", { name: member?.name ?? "" })}
        placeholder={member?.name}
        confirmLabel={t("common.save")}
        initialValue={member?.nickname ?? ""}
        autoCapitalize="words"
        allowEmpty
        maxLength={60}
        loading={setNickname.isPending}
        onConfirm={(value) => {
          if (!member) return;
          setNickname.mutate(
            { familyId: member.familyId, memberId: member.id, nickname: value },
            { onSuccess: () => setNicknameOpen(false) },
          );
        }}
        onClose={() => setNicknameOpen(false)}
      />
    </ScreenContainer>
  );
}
