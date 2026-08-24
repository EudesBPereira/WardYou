import { useEffect, useRef, useState } from "react";
import { Pressable } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolateColor,
  useReducedMotion,
} from "react-native-reanimated";
import { colors } from "@/theme";

const TRACK_W = 52;
const TRACK_H = 32;
const KNOB = 28;
const ON_OFFSET = TRACK_W - KNOB - 4;

export interface ToggleProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}

export function Toggle({
  value,
  onValueChange,
  disabled = false,
  accessibilityLabel,
}: ToggleProps) {
  const reduced = useReducedMotion();

  // Optimistic flip: the knob moves the instant it's tapped, then reconciles
  // with the controlled `value` once the server round trip lands — so a switch
  // never freezes waiting on the network, and one in-flight save no longer
  // makes every switch on the screen look affected. Works for ANY caller,
  // whether or not its mutation does an optimistic cache update.
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const shown = optimistic ?? value;
  const progress = useSharedValue(shown ? 1 : 0);

  // Server truth arrived (the prop changed): trust it and drop the override.
  const prevValue = useRef(value);
  useEffect(() => {
    if (prevValue.current !== value) {
      prevValue.current = value;
      setOptimistic(null);
    }
  }, [value]);

  // Safety: if the prop never changes (e.g. a failed save rolled back to the
  // same value), don't stay stuck on the optimistic guess — snap to truth.
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (clearTimer.current) clearTimeout(clearTimer.current);
  }, []);

  useEffect(() => {
    progress.value = reduced
      ? (shown ? 1 : 0)
      : withTiming(shown ? 1 : 0, { duration: 180 });
  }, [shown, reduced, progress]);

  const handlePress = () => {
    const next = !shown;
    setOptimistic(next);
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => setOptimistic(null), 4000);
    onValueChange(next);
  };

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      progress.value,
      [0, 1],
      [colors.border, colors.brand[500]],
    ),
  }));

  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * ON_OFFSET }],
  }));

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: shown, disabled }}
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={handlePress}
      hitSlop={8}
      style={{ opacity: disabled ? 0.5 : 1 }}
    >
      <Animated.View
        style={[
          {
            width: TRACK_W,
            height: TRACK_H,
            borderRadius: TRACK_H / 2,
            padding: 2,
            justifyContent: "center",
          },
          trackStyle,
        ]}
      >
        <Animated.View
          style={[
            {
              width: KNOB,
              height: KNOB,
              borderRadius: KNOB / 2,
              backgroundColor: colors.surface,
              shadowColor: colors.ink,
              shadowOpacity: 0.15,
              shadowRadius: 2,
              shadowOffset: { width: 0, height: 1 },
              elevation: 2,
            },
            knobStyle,
          ]}
        />
      </Animated.View>
    </Pressable>
  );
}
