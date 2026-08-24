import { SvgXml } from "react-native-svg";
import { wardYouLogoXml, wardYouBrandXml } from "@/assets/brand-logos";

const MARK_RATIO = 433 / 577;
const WORDMARK_RATIO = 288 / 866;

export interface LogoProps {
  size?: number;
  variant?: "mark" | "wordmark";
}

export function Logo({ size = 96, variant = "mark" }: LogoProps) {
  if (variant === "wordmark") {
    return <SvgXml xml={wardYouBrandXml} width={size} height={size * WORDMARK_RATIO} />;
  }
  return <SvgXml xml={wardYouLogoXml} width={size} height={size * MARK_RATIO} />;
}
