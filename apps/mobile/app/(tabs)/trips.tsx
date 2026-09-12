import { useState } from "react";
import { View, ActivityIndicator, Alert } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import {
  ScreenContainer,
  ScreenHeader,
  Card,
  Text,
  Button,
  Badge,
  ListItem,
  InputModal,
} from "@/components/ui";
import { colors } from "@/theme";
import { type MockTrip } from "@/lib/mockData";
import { useTrips, useCreateTrip, useJoinTrip } from "@/features/trips/queries";
import { CreateTripModal } from "@/features/trips/CreateTripModal";
import { ProfileButton } from "@/components/ProfileButton";
import { TripSharingStatusCard } from "@/features/trips/TripSharingStatusCard";
import type { CreateTripRequest } from "@/services/api/types";

function TripRow({ trip }: { trip: MockTrip }) {
  const { t } = useTranslation();
  const meta =
    trip.status === "active"
      ? `${t(`trips.types.${trip.type}`)} · ${t("trips.members", { count: trip.memberCount })}`
      : t("trips.closedAt", { date: trip.closedLabel });
  return (
    <ListItem
      icon={trip.status === "active" ? "navigate" : "checkmark-done"}
      iconTone={trip.status === "active" ? "brand" : "neutral"}
      title={trip.name}
      subtitle={meta}
      onPress={() => router.navigate(`/trips/${trip.id}` as never)}
      trailing={
        trip.status === "active" ? (
          <Badge label={t("trips.endsAt", { time: trip.endsLabel })} tone="safe" />
        ) : undefined
      }
    />
  );
}

function Section({ title, trips }: { title: string; trips: MockTrip[] }) {
  if (trips.length === 0) return null;
  return (
    <View className="mt-6">
      <Text variant="h2" className="mb-2">
        {title}
      </Text>
      <Card padded={false} className="px-4">
        {trips.map((trip, i) => (
          <View key={trip.id}>
            {i > 0 ? <View className="h-px bg-border" /> : null}
            <TripRow trip={trip} />
          </View>
        ))}
      </Card>
    </View>
  );
}

export default function TripsScreen() {
  const { t } = useTranslation();
  const { data: trips = [], isLoading } = useTrips();
  const createTrip = useCreateTrip();
  const joinTrip = useJoinTrip();
  const [createOpen, setCreateOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);

  const active = trips.filter((tr) => tr.status === "active");
  const history = trips.filter((tr) => tr.status === "closed");

  async function handleCreate(req: CreateTripRequest) {
    try {
      await createTrip.mutateAsync(req);
      setCreateOpen(false);
    } catch {
      /* keep modal open */
    }
  }

  // Quick tracking = a short temporary trip; jump straight into its live map.
  async function handleQuickCreate(req: CreateTripRequest) {
    try {
      const trip = await createTrip.mutateAsync(req);
      setQuickOpen(false);
      router.navigate(`/trips/${trip.id}` as never);
    } catch {
      /* keep modal open */
    }
  }

  async function handleJoin(code: string) {
    try {
      await joinTrip.mutateAsync(code.trim().toUpperCase());
      setJoinOpen(false);
    } catch {
      Alert.alert(t("trips.joinByCode"), t("trips.join.invalid"));
    }
  }

  return (
    <ScreenContainer>
      <ScreenHeader
        title={t("trips.title")}
        subtitle={t("trips.subtitle")}
        action={<ProfileButton />}
      />

      {/* Antes dos botoes de propósito: se o compartilhamento desta viagem
          esta quebrado, isso importa mais do que criar outra viagem. Aparece
          tambem aqui (e nao so no detalhe) porque a pessoa pode entrar numa
          viagem e nunca mais abrir a tela dela. */}
      <TripSharingStatusCard ativa={active.length > 0} />

      {/* Stacked full-width so long labels ("Entrar com código", FR's even
          longer) never overflow the fixed-height button — matches the Family
          screen's action layout. */}
      <View className="mt-2 gap-3">
        <Button label={t("trips.create")} icon="add" onPress={() => setCreateOpen(true)} />
        <Button
          label={t("trips.joinByCode")}
          icon="key"
          variant="secondary"
          onPress={() => setJoinOpen(true)}
        />
      </View>

      {/* Quick tracking */}
      <Card tone="brand" onPress={() => setQuickOpen(true)} className="mt-4 flex-row items-center gap-3">
        <View className="h-11 w-11 items-center justify-center rounded-2xl bg-white/15">
          <Ionicons name="flash" size={22} color="#FFFFFF" />
        </View>
        <View className="flex-1">
          <Text variant="title" color="inverse">
            {t("trips.quick.title")}
          </Text>
          <Text variant="caption" color="inverse" className="opacity-90">
            {t("trips.quick.subtitle")}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#FFFFFF" />
      </Card>

      {isLoading ? <ActivityIndicator className="mt-8" color={colors.brand[500]} /> : null}

      <Section title={t("trips.active")} trips={active} />
      <Section title={t("trips.history")} trips={history} />

      {!isLoading && active.length === 0 && history.length === 0 ? (
        <Card className="mt-6 items-center gap-2 py-10">
          <View className="h-16 w-16 items-center justify-center rounded-full bg-surface-alt">
            <Ionicons name="navigate" size={30} color={colors["ink-muted"]} />
          </View>
          <Text variant="title">{t("trips.empty.title")}</Text>
          <Text variant="body" color="muted" className="text-center">
            {t("trips.empty.body")}
          </Text>
        </Card>
      ) : null}

      <CreateTripModal
        visible={createOpen}
        loading={createTrip.isPending}
        onConfirm={handleCreate}
        onClose={() => setCreateOpen(false)}
      />

      <CreateTripModal
        visible={quickOpen}
        quick
        loading={createTrip.isPending}
        onConfirm={handleQuickCreate}
        onClose={() => setQuickOpen(false)}
      />

      <InputModal
        visible={joinOpen}
        title={t("trips.joinByCode")}
        subtitle={t("trips.join.subtitle")}
        placeholder={t("trips.join.placeholder")}
        confirmLabel={t("trips.joinByCode")}
        autoCapitalize="characters"
        loading={joinTrip.isPending}
        onConfirm={handleJoin}
        onClose={() => setJoinOpen(false)}
      />
    </ScreenContainer>
  );
}
