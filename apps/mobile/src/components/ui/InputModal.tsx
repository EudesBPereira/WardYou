import { useEffect, useState } from "react";
import { Keyboard, Modal, Platform, Pressable, TextInput, View, type KeyboardTypeOptions } from "react-native";
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
  /** Desligue em campos tecnicos (dominio, codigo): a correcao automatica do
   *  teclado insere espaco depois do ponto e corrompe o valor. */
  autoCorrect?: boolean;
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
  autoCorrect = true,
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

  // Empurra a folha para cima na altura do teclado.
  //
  // Um Modal do Android abre em JANELA PROPRIA, que nao herda o
  // `adjustResize` da activity -- por isso o teclado simplesmente cobria a
  // folha e o usuario digitava as cegas (visto na tela "Sites bloqueados" em
  // 2026-09-11). KeyboardAvoidingView tambem nao resolve dentro de Modal no
  // Android; medir o teclado e reservar o espaco e o caminho que funciona nas
  // duas plataformas.
  const [alturaTeclado, setAlturaTeclado] = useState(0);
  useEffect(() => {
    if (!visible) return;
    const aoMostrar = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      (e) => setAlturaTeclado(e.endCoordinates.height),
    );
    const aoEsconder = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => setAlturaTeclado(0),
    );
    return () => {
      aoMostrar.remove();
      aoEsconder.remove();
      setAlturaTeclado(0);
    };
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end bg-overlay" onPress={loading ? undefined : onClose}>
        <Pressable
          className="rounded-t-3xl bg-surface px-5 pt-5"
          style={{
            // Com o teclado aberto o recuo da area segura ja esta coberto por
            // ele -- somar os dois deixaria um vao morto.
            paddingBottom: alturaTeclado > 0 ? alturaTeclado + 16 : insets.bottom + 24,
          }}
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
              autoCorrect={autoCorrect}
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
