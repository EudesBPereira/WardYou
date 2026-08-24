import { type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { cn } from "@/lib/cn";

type Tone = "background" | "surface" | "night";

const toneClass: Record<Tone, string> = {
  background: "bg-background",
  surface: "bg-surface",
  night: "bg-night-500",
};

export interface ScreenContainerProps {
  children: ReactNode;
  scroll?: boolean;
  tone?: Tone;
  edges?: Edge[];
  contentClassName?: string;
}

export function ScreenContainer({
  children,
  scroll = true,
  tone = "background",
  edges = ["top", "left", "right"],
  contentClassName,
}: ScreenContainerProps) {
  return (
    <SafeAreaView edges={edges} className={cn("flex-1", toneClass[tone])}>
      {scroll ? (
        <ScrollView
          className="flex-1"
          contentContainerClassName={cn("px-5 pb-8 pt-2", contentClassName)}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View className={cn("flex-1 px-5 pb-8 pt-2", contentClassName)}>
          {children}
        </View>
      )}
    </SafeAreaView>
  );
}
