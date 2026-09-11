import { type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets, type Edge } from "react-native-safe-area-context";
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
  // Respiro inferior alem do `pb-8`.
  //
  // `edges` nao inclui "bottom" por padrao, entao o SafeAreaView NAO reserva a
  // faixa da barra de navegacao / gestos do Android -- e 32px de padding nao
  // cobrem os ~48px dessa barra. Resultado visto em campo em 2026-09-11: o
  // ultimo item da secao "Gerenciar" ficava cortado ao meio, sem jeito de
  // rolar mais. Vale para toda tela empilhada (sem barra de abas embaixo), nao
  // so aquela.
  //
  // Somado apenas quando "bottom" NAO esta em `edges`: se o chamador pedir essa
  // borda, o proprio SafeAreaView ja aplica o recuo e somar aqui dobraria.
  //
  // O valor vai INTEIRO no style (32 + inset) em vez de `pb-8` na className:
  // estilo inline SUBSTITUI o da classe, nao soma -- manter os dois deixaria
  // so o inset e tiraria o respiro de 32px que ja existia.
  const insets = useSafeAreaInsets();
  const RESPIRO = 32; // equivalente ao antigo `pb-8`
  const recuoInferior = RESPIRO + (edges.includes("bottom") ? 0 : insets.bottom);

  return (
    <SafeAreaView edges={edges} className={cn("flex-1", toneClass[tone])}>
      {scroll ? (
        <ScrollView
          className="flex-1"
          contentContainerClassName={cn("px-5 pt-2", contentClassName)}
          contentContainerStyle={{ paddingBottom: recuoInferior }}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View
          className={cn("flex-1 px-5 pt-2", contentClassName)}
          style={{ paddingBottom: recuoInferior }}
        >
          {children}
        </View>
      )}
    </SafeAreaView>
  );
}
