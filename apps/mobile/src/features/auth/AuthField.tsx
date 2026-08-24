import { useState } from "react";
import { Pressable, TextInput, View, type TextInputProps } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "@/components/ui";
import { colors } from "@/theme";
import { cn } from "@/lib/cn";

export interface AuthFieldProps extends Omit<TextInputProps, "className"> {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  /** Renders a show/hide toggle and masks the input. */
  secure?: boolean;
  error?: string | null;
}

export function AuthField({ label, icon, secure, error, ...props }: AuthFieldProps) {
  const [hidden, setHidden] = useState(true);

  return (
    <View className="gap-1.5">
      <Text variant="label" color="muted">
        {label}
      </Text>
      <View
        className={cn(
          "h-12 flex-row items-center gap-2 rounded-lg border bg-surface px-3",
          error ? "border-danger-500" : "border-border",
        )}
      >
        {icon ? <Ionicons name={icon} size={18} color={colors["ink-subtle"]} /> : null}
        <TextInput
          className="h-full flex-1 font-body text-base text-ink"
          placeholderTextColor={colors["ink-subtle"]}
          secureTextEntry={secure ? hidden : false}
          {...props}
        />
        {secure ? (
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => setHidden((v) => !v)}
          >
            <Ionicons
              name={hidden ? "eye-outline" : "eye-off-outline"}
              size={18}
              color={colors["ink-subtle"]}
            />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text variant="caption" color="danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
