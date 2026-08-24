import { useCallback, useState } from "react";
import { Pressable, View, Platform } from "react-native";
import Svg, { Circle } from "react-native-svg";
import Animated, {
  useSharedValue,
  useAnimatedProps,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  cancelAnimation,
  runOnJS,
  useReducedMotion,
  Easing,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/theme";
import { Text } from "./Text";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const SIZE = 220;
const STROKE = 12;
const R = (SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * R;

function haptic(kind: "start" | "success") {
  if (Platform.OS === "web") return;
  // Lazily required so web never bundles a native-only call path.
  const Haptics = require("expo-haptics");
  if (kind === "start") {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  } else {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }
}

export interface HoldButtonProps {
  onActivate: () => void;
  holdMs?: number;
  idleLabel: string;
  holdingLabel: string;
  activatedLabel: string;
  hint?: string;
  activated?: boolean;
}

export function HoldButton({
  onActivate,
  holdMs = 1500,
  idleLabel,
  holdingLabel,
  activatedLabel,
  hint,
  activated = false,
}: HoldButtonProps) {
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);
  const pulse = useSharedValue(1);
  const [holding, setHolding] = useState(false);

  const finish = useCallback(() => {
    setHolding(false);
    haptic("success");
    onActivate();
  }, [onActivate]);

  const onPressIn = useCallback(() => {
    setHolding(true);
    haptic("start");
    if (!reduced) {
      pulse.value = withRepeat(
        withSequence(
          withTiming(1.06, { duration: 500 }),
          withTiming(1, { duration: 500 }),
        ),
        -1,
        true,
      );
    }
    progress.value = withTiming(
      1,
      { duration: holdMs, easing: Easing.linear },
      (done) => {
        if (done) runOnJS(finish)();
      },
    );
  }, [finish, holdMs, pulse, progress, reduced]);

  const onPressOut = useCallback(() => {
    setHolding(false);
    cancelAnimation(progress);
    cancelAnimation(pulse);
    pulse.value = withTiming(1, { duration: 150 });
    progress.value = withTiming(0, { duration: 250 });
  }, [progress, pulse]);

  const ringProps = useAnimatedProps(() => ({
    strokeDashoffset: CIRC * (1 - progress.value),
  }));

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
  }));

  const label = activated ? activatedLabel : holding ? holdingLabel : idleLabel;

  return (
    <View className="items-center gap-4">
      <Animated.View style={pulseStyle}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={idleLabel}
          accessibilityHint={hint}
          onPressIn={onPressIn}
          onPressOut={onPressOut}
          style={{ width: SIZE, height: SIZE }}
          className="items-center justify-center"
        >
          {/* Progress ring */}
          <Svg
            width={SIZE}
            height={SIZE}
            style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}
          >
            <Circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              stroke={colors.danger[100]}
              strokeWidth={STROKE}
              fill="none"
            />
            <AnimatedCircle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              stroke={colors.danger[500]}
              strokeWidth={STROKE}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={CIRC}
              animatedProps={ringProps}
            />
          </Svg>

          {/* Core */}
          <View
            className="items-center justify-center rounded-full bg-danger-500"
            style={{ width: SIZE - 48, height: SIZE - 48 }}
          >
            <Ionicons name="warning" size={56} color="#FFFFFF" />
            <Text
              variant="title"
              color="inverse"
              className="mt-1 text-center uppercase tracking-wide"
            >
              {label}
            </Text>
          </View>
        </Pressable>
      </Animated.View>

      {hint ? (
        <Text variant="caption" color="muted" className="text-center">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}
