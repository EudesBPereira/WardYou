import { useState } from "react";
import { View, ActivityIndicator, Alert, Share } from "react-native";
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
  Button,
  ListItem,
  InputModal,
  MapPreview,
} from "@/components/ui";
import type { MapMarker } from "@/components/ui";
import { colors } from "@/theme";
import { suppressNextRelock } from "@/stores/appLock";
import { formatSeenAt } from "@/lib/formatTime";
import { TripSharingStatusCard } from "@/features/trips/TripSharingStatusCard";
import {
  useTrip,
  useTripMap,
  useTripMembers,
  useUpdateTrip,
  useCloseTrip,
  useLeaveTrip,
  useDeleteTrip,
  useTripInvite,
} from "@/features/trips/queries";

export default function TripDetailScreen() {
  const { t, i18n } = useTranslation();
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const { data: trip, isLoading } = useTrip(tripId);
  const isActive = trip?.isActive ?? false;
  const { data: map } = useTripMap(tripId, isActive);
  const update = useUpdateTrip();
  const close = useCloseTrip();
  const leave = useLeaveTrip();
  const del = useDeleteTrip();
  const invite = useTripInvite();
  const [nameOpen, setNameOpen] = useState(false);

  // GPS broadcast to the trip happens app-wide in useTripLocationBroadcast
  // (mounted in AuthGate) — no per-screen timer needed here.
  const { data: members = [] } = useTripMembers(tripId);
  const myMembership = members.find((m) => m.isMe);
  const isCreator = myMembership?.isCreator ?? map?.members.some((m) => m.isMe && m.isCreator) ?? false;

  const markers: MapMarker[] = (map?.members ?? [])
    .filter((m) => m.latitude != null && m.longitude != null)
    .map((m) => ({
      id: m.userId,
      latitude: m.latitude as number,
      longitude: m.longitude as number,
      label: m.fullName,
      photoUri: m.avatarUrl,
      isMe: m.isMe,
      isOnline: m.isOnline,
    }));

  const openFullMap = () => router.navigate(`/trips/${tripId}/map` as never);

  async function handleInvite() {
    if (!tripId) return;
    try {
      const data = await invite.mutateAsync(tripId);
      suppressNextRelock();
      await Share.share({
        message: t("trips.detail.shareMessage", { code: data.inviteCode, link: data.inviteLink }),
      }).catch(() => {
        Alert.alert(t("trips.detail.invite"), `${data.inviteCode}\n${data.inviteLink}`);
      });
    } catch {
      Alert.alert(t("trips.detail.invite"), t("common.genericError"));
    }
  }

  function confirmClose() {
    if (!trip) return;
    Alert.alert(trip.name, t("trips.detail.closeConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("trips.detail.close"),
        style: "destructive",
        onPress: () => close.mutate(trip.id, { onSuccess: () => router.back() }),
      },
    ]);
  }

  function confirmLeave() {
    if (!trip) return;
    Alert.alert(trip.name, t("trips.detail.leaveConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("trips.detail.leave"),
        style: "destructive",
        onPress: () => leave.mutate(trip.id, { onSuccess: () => router.back() }),
      },
    ]);
  }

  function confirmDelete() {
    if (!trip) return;
    Alert.alert(trip.name, t("trips.detail.deleteConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("trips.detail.delete"),
        style: "destructive",
        onPress: () => del.mutate(trip.id, { onSuccess: () => router.back() }),
      },
    ]);
  }

  // Trips can span days, so show date + time for both ends of the window.
  // Achado de QA 2026-09-11: esta funcao inline escapou da varredura anterior
  // de toLocaleString([], ...) (que usa o idioma do SISTEMA, nao o do app) --
  // "09/09, 7:29 PM" numa tela em portugues, ao lado de "Visto às 20:01" ja
  // corrigido. Reusa o mesmo formatDateTime (src/lib/formatTime.ts) que
  // corrige os outros lugares, com dia+mes (sem ano: e so o cabecalho de um
  // trajeto ativo, nao um log de auditoria de longo prazo).
  const fmtDateTime = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language, {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  const timeRange = trip ? `${fmtDateTime(trip.startsAt)} – ${fmtDateTime(trip.endsAt)}` : "";

  return (
    <ScreenContainer>
      <ScreenHeader
        title={trip?.name ?? t("trips.title")}
        subtitle={trip ? t(`trips.types.${trip.type}`) : undefined}
        onBack={() => router.back()}
      />

      {isLoading || !trip ? (
        <ActivityIndicator className="mt-10" color={colors.brand[500]} />
      ) : (
        <>
          {/* Antes do cartao de status da viagem: "voce esta sendo acompanhado?"
              vale mais do que "a viagem esta ativa". So aparece quando ha algo
              errado numa viagem ATIVA. */}
          <TripSharingStatusCard ativa={isActive} />

          {/* Status */}
          <Card className="mt-2 flex-row items-center gap-3">
            <View
              className={`h-11 w-11 items-center justify-center rounded-2xl ${isActive ? "bg-safe-50" : "bg-surface-alt"}`}
            >
              <Ionicons
                name={isActive ? "navigate" : "checkmark-done"}
                size={22}
                color={isActive ? colors.safe[600] : colors["ink-muted"]}
              />
            </View>
            <View className="flex-1">
              <Text variant="title">
                {isActive ? t("trips.detail.active") : t("trips.detail.closed")}
              </Text>
              <Text variant="caption" color="muted">
                {timeRange} · {t("trips.members", { count: trip.memberCount })}
              </Text>
            </View>
            {isActive ? <Badge label={t("trips.detail.live")} tone="safe" /> : null}
          </Card>

          {/* Live map — tap to open the fullscreen live map */}
          <View className="mt-6 flex-row items-center justify-between">
            <Text variant="h2">{t("trips.detail.mapTitle")}</Text>
            {markers.length > 0 ? (
              <Text variant="label" color="brand" onPress={openFullMap}>
                {t("trips.map.expand")}
              </Text>
            ) : null}
          </View>
          <Card padded={false} className="mt-3 overflow-hidden">
            {markers.length > 0 ? (
              <MapPreview
                latitude={markers[0].latitude}
                longitude={markers[0].longitude}
                markers={markers}
                height={200}
                onPress={openFullMap}
              />
            ) : (
              <View className="h-[200px] items-center justify-center gap-2">
                <Ionicons name="location-outline" size={28} color={colors["ink-subtle"]} />
                <Text variant="caption" color="muted" className="px-6 text-center">
                  {t("trips.detail.mapEmpty")}
                </Text>
              </View>
            )}
          </Card>

          {/* Members */}
          <Text variant="h2" className="mt-6">
            {t("trips.detail.members")}
          </Text>
          <Card padded={false} className="mt-3 px-4">
            {(map?.members ?? []).map((m, i) => {
              const seen = m.capturedAt
                ? t("trips.detail.lastSeen", { time: formatSeenAt(m.capturedAt) })
                : m.canViewLocation
                  ? t("trips.detail.noFix")
                  : t("trips.detail.locationHidden");
              return (
                <View key={m.userId}>
                  {i > 0 ? <View className="h-px bg-border" /> : null}
                  <ListItem
                    leading={
                      <Avatar
                        name={m.fullName}
                        uri={m.avatarUrl}
                        status={m.isOnline ? "online" : "offline"}
                      />
                    }
                    title={m.isMe ? t("trips.detail.you", { name: m.fullName }) : m.fullName}
                    subtitle={seen}
                    trailing={
                      <View className="flex-row items-center gap-2">
                        {m.isCreator ? <Badge label={t("trips.detail.creator")} tone="brand" /> : null}
                        {m.batteryLevel != null ? (
                          <Text variant="mono" color="subtle">
                            {m.batteryLevel}%
                          </Text>
                        ) : null}
                      </View>
                    }
                  />
                </View>
              );
            })}
          </Card>

          {/* Actions */}
          {isActive ? (
            <View className="mt-6 gap-3">
              {isCreator ? (
                <>
                  <Button
                    label={t("trips.detail.invite")}
                    icon="share-outline"
                    onPress={handleInvite}
                    loading={invite.isPending}
                  />
                  <Button
                    label={t("trips.detail.rename")}
                    icon="create-outline"
                    variant="secondary"
                    onPress={() => setNameOpen(true)}
                  />
                  <Button
                    label={t("trips.detail.close")}
                    icon="stop-circle-outline"
                    variant="danger"
                    onPress={confirmClose}
                    loading={close.isPending}
                  />
                </>
              ) : (
                <Button
                  label={t("trips.detail.leave")}
                  icon="exit-outline"
                  variant="danger"
                  onPress={confirmLeave}
                  loading={leave.isPending}
                />
              )}
            </View>
          ) : isCreator ? (
            /* Closed trip: the creator can remove it from history for good. */
            <View className="mt-6 gap-3">
              <Button
                label={t("trips.detail.delete")}
                icon="trash-outline"
                variant="danger"
                onPress={confirmDelete}
                loading={del.isPending}
              />
            </View>
          ) : null}
        </>
      )}

      <InputModal
        visible={nameOpen}
        title={t("trips.detail.rename")}
        confirmLabel={t("common.save")}
        initialValue={trip?.name}
        autoCapitalize="sentences"
        loading={update.isPending}
        onConfirm={(v) => {
          if (v.trim() && trip) update.mutate({ tripId: trip.id, name: v.trim() });
          setNameOpen(false);
        }}
        onClose={() => setNameOpen(false)}
      />
    </ScreenContainer>
  );
}
