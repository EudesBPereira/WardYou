import { useEffect, useState } from "react";
import { Modal, Pressable, TextInput, View, type KeyboardTypeOptions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { colors } from "@/theme";
import { cn } from "@/lib/cn";
import { Text } from "./Text";
import { Button } from "./Button";

export interface InputModalProps {
  visible: boolean;
  title: string;
  subtitle?: string;
  placeholder?: string;
  confirmLabel: string;
  initialValue?: string;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  loading?: boolean;
  error?: string | null;
  /** Allow confirming with an empty value (optional-note prompts). */
  allowEmpty?: boolean;
  keyboardType?: KeyboardTypeOptions;
  secureTextEntry?: boolean;
  maxLength?: number;
  onConfirm: (value: string) => void;
  onClose: () => void;
}

/** Lightweight single-field prompt (RN has no cross-platform Alert.prompt). */
export function InputModal({
  visible,
  title,
  subtitle,
  placeholder,
  confirmLabel,
  initialValue = "",
  autoCapitalize = "sentences",
  loading = false,
  error,
  allowEmpty = false,
  keyboardType,
  secureTextEntry,
  maxLength,
  onConfirm,
  onClose,
}: InputModalProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (visible) setValue(initialValue);
  }, [visible, initialValue]);

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

          <View
            className={cn(
              "mt-4 h-12 justify-center rounded-lg border bg-surface px-3",
              error ? "border-danger-500" : "border-border",
            )}
          >
            <TextInput
              className="font-body text-base text-ink"
              placeholderTextColor={colors["ink-subtle"]}
              placeholder={placeholder}
              value={value}
              onChangeText={setValue}
              autoCapitalize={autoCapitalize}
              keyboardType={keyboardType}
              secureTextEntry={secureTextEntry}
              maxLength={maxLength}
              autoFocus
              editable={!loading}
              onSubmitEditing={() => (allowEmpty || value.trim()) && onConfirm(value.trim())}
              returnKeyType="done"
            />
          </View>
          {error ? (
            <Text variant="caption" color="danger" className="mt-1">
              {error}
            </Text>
          ) : null}

          <View className="mt-5 gap-2">
            <Button
              label={confirmLabel}
              loading={loading}
              disabled={!allowEmpty && !value.trim()}
              onPress={() => onConfirm(value.trim())}
            />
            <Button label={t("common.cancel")} variant="ghost" onPress={onClose} disabled={loading} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
