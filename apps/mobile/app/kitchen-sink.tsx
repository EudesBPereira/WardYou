import { useState } from "react";
import { View, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Text,
  Button,
  Card,
  Toggle,
  Avatar,
  Badge,
  ListItem,
  ScreenHeader,
  BottomNav,
  HoldButton,
  Select,
  type TabKey,
} from "@/components/ui";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mt-7 gap-3">
      <Text variant="h2">{title}</Text>
      {children}
    </View>
  );
}

const NAV_LABELS: Record<TabKey, string> = {
  home: "Home",
  family: "Family",
  trips: "Trips",
  tasks: "Tasks",
  sos: "SOS",
  settings: "Settings",
};

export default function KitchenSink() {
  const [toggle1, setToggle1] = useState(true);
  const [toggle2, setToggle2] = useState(false);
  const [tab, setTab] = useState<TabKey>("home");
  const [sosCount, setSosCount] = useState(0);
  const [flavor, setFlavor] = useState("brand");

  return (
    <SafeAreaView edges={["top", "left", "right"]} className="flex-1 bg-background">
      <ScrollView
        contentContainerClassName="px-5 pb-10"
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader
          title="Design System"
          subtitle="Guardião Sereno — Phase 1 review"
          action={<Badge label="v0.1" tone="brand" />}
        />

        {/* Typography */}
        <Section title="Typography">
          <Card>
            <Text variant="display">24:18</Text>
            <Text variant="h1">Stay close, stay safe</Text>
            <Text variant="h2">Family network</Text>
            <Text variant="title">Trip to grandma's</Text>
            <Text variant="body" color="muted" className="mt-1">
              Inter body — calm, legible copy for anxious parents who want clarity.
            </Text>
            <Text variant="mono" color="subtle" className="mt-2">
              Closed 26/06 17:44
            </Text>
          </Card>
        </Section>

        {/* Colors */}
        <Section title="Color tokens">
          <View className="flex-row flex-wrap gap-2">
            {[
              ["brand", "bg-brand-500"],
              ["safe", "bg-safe-500"],
              ["danger (SOS)", "bg-danger-500"],
              ["warning", "bg-warning-500"],
              ["night", "bg-night-500"],
              ["surface-alt", "bg-surface-alt"],
            ].map(([name, cls]) => (
              <View key={name} className="items-center gap-1">
                <View className={`h-14 w-14 rounded-xl ${cls}`} />
                <Text variant="caption" color="muted">
                  {name}
                </Text>
              </View>
            ))}
          </View>
        </Section>

        {/* Buttons */}
        <Section title="Buttons">
          <View className="gap-3">
            <Button label="Primary action" icon="shield-checkmark" />
            <Button label="All good — I'm OK" variant="safe" icon="checkmark-circle" />
            <Button label="Send emergency alert" variant="danger" icon="warning" />
            <Button label="Secondary" variant="secondary" />
            <View className="flex-row gap-3">
              <Button label="Ghost" variant="ghost" fullWidth={false} />
              <Button label="Loading" loading fullWidth={false} />
            </View>
            <View className="flex-row gap-3">
              <Button label="Small" size="sm" fullWidth={false} />
              <Button label="Large" size="lg" fullWidth={false} />
            </View>
          </View>
        </Section>

        {/* Badges */}
        <Section title="Badges & status">
          <View className="flex-row flex-wrap gap-2">
            <Badge label="Admin" tone="brand" />
            <Badge label="Online" tone="safe" />
            <Badge label="SOS active" tone="danger" />
            <Badge label="Low battery" tone="warning" />
            <Badge label="Offline" tone="neutral" />
          </View>
        </Section>

        {/* Avatars */}
        <Section title="Avatars">
          <View className="flex-row items-end gap-4">
            <Avatar name="Ana Paula" size="lg" status="online" />
            <Avatar name="Carlos" size="md" status="offline" />
            <Avatar name="Beatriz Lima" size="md" status="alert" />
            <Avatar name="Davi" size="sm" />
          </View>
        </Section>

        {/* List + toggles */}
        <Section title="List items & toggles">
          <Card padded={false} className="px-4">
            <ListItem
              title="Location sharing"
              subtitle="Share your live location with family"
              icon="location"
              iconTone="brand"
              trailing={<Toggle value={toggle1} onValueChange={setToggle1} />}
            />
            <View className="h-px bg-border" />
            <ListItem
              title="Sound alarm mode"
              subtitle="Play a loud alarm during SOS"
              icon="volume-high"
              iconTone="warning"
              trailing={<Toggle value={toggle2} onValueChange={setToggle2} />}
            />
            <View className="h-px bg-border" />
            <ListItem
              title="Safety zones"
              subtitle="Home, School"
              icon="map"
              iconTone="safe"
              onPress={() => {}}
            />
          </Card>
        </Section>

        {/* Signature SOS */}
        <Section title="Select (dropdown)">
          <Select
            label="Flavor"
            value={flavor}
            onChange={setFlavor}
            options={[
              { value: "brand", label: "Brand" },
              { value: "safe", label: "Safe" },
              { value: "danger", label: "Danger" },
            ]}
          />
        </Section>

        <Section title="Signature — SOS hold button">
          <Card tone="night" className="items-center py-8">
            <HoldButton
              onActivate={() => setSosCount((c) => c + 1)}
              idleLabel="Hold for SOS"
              holdingLabel="Keep holding…"
              activatedLabel="Sent"
              hint="Hold to prevent accidental triggers."
            />
            <Text variant="caption" color="inverse" className="mt-4 opacity-70">
              Activated {sosCount}×
            </Text>
          </Card>
        </Section>

        {/* Empty state example */}
        <Section title="Empty state (with direction)">
          <Card className="items-center gap-2 py-8">
            <Avatar name="+" size="lg" />
            <Text variant="title">No trips yet</Text>
            <Text variant="body" color="muted" className="text-center">
              Create a trip or join one with a code to track your route safely.
            </Text>
            <Button
              label="Create trip"
              icon="add"
              fullWidth={false}
              className="mt-2"
            />
          </Card>
        </Section>
      </ScrollView>

      <BottomNav active={tab} onChange={setTab} labels={NAV_LABELS} />
    </SafeAreaView>
  );
}
