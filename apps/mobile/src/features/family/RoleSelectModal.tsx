import { Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { Text, Button } from "@/components/ui";
import { colors } from "@/theme";

/** Roles an admin can hand out. The chosen role decides which app experience
 *  that person gets (child mode, elder mode, guardian, plain member). */
export const ASSIGNABLE_ROLES = ["child", "elder", "member", "guardian"] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

const ROLE_ICONS: Record<AssignableRole, keyof typeof Ionicons.glyphMap> = {
  child: "happy",
  elder: "heart",
  member: "person",
  guardian: "shield-checkmark",
};

export interface RoleSelectModalProps {
  visible: boolean;
  title: string;
  subtitle?: string;
  loading?: boolean;
  onSelect: (role: AssignableRole) => void;
  onClose: () => void;
}

export function RoleSelectModal({ visible, title, subtitle, loading, onSelect, onClose }: RoleSelectModalProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end bg-overlay" onPress={loading ? undefined : onClose}>
        <Pressable
          className="rounded-t-3xl bg-surface px-5 pt-5"
          style={{ paddingBottom: insets.bottom + 24 }}
          onPress={() => {}}
        >
          <View className="mb-4 h-1 w-10 self-center rounded-full bg-border" />
          <Text variant="h2">{title}</Text>
          {subtitle ? (
            <Text variant="body" color="muted" className="mt-1">
              {subtitle}
            </Text>
          ) : null}

          <View className="mt-4 gap-2">
            {ASSIGNABLE_ROLES.map((role) => (
              <Pressable
                key={role}
                accessibilityRole="button"
                disabled={loading}
                onPress={() => onSelect(role)}
                className="flex-row items-center gap-3 rounded-2xl bg-surface-alt px-4 py-3.5 active:opacity-70"
              >
                <View className="h-10 w-10 items-center justify-center rounded-xl bg-brand-50">
                  <Ionicons name={ROLE_ICONS[role]} size={20} color={colors.brand[500]} />
                </View>
                <View className="flex-1">
                  <Text variant="title">{t(`roles.${role}`)}</Text>
                  <Text variant="caption" color="muted">
                    {t(`family.roleSelect.${role}`)}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors["ink-subtle"]} />
              </Pressable>
            ))}
          </View>

          <Button label={t("common.cancel")} variant="ghost" className="mt-3" onPress={onClose} disabled={loading} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}
