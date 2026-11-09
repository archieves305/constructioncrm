import { useColorScheme } from "react-native";
import { TOKENS } from "./tokens";

/**
 * KNU Field colours: the web's design tokens (src/app/globals.css), generated
 * into tokens.ts by scripts/tokens.mjs, light and dark. The one departure:
 * borders use the web's stronger border, since a phone is read outdoors.
 * Touch targets are at least 48 pt.
 */
export type ToneName = keyof typeof TOKENS.light.tones;
export type Theme = {
  bg: string;
  card: string;
  text: string;
  muted: string;
  border: string;
  brand: string;
  brandText: string;
  brandSoft: string;
  brandFg: string;
  danger: string;
  warn: string;
  ok: string;
  tones: Record<ToneName, { soft: string; fg: string; dot: string }>;
};

const light: Theme = TOKENS.light;
const dark: Theme = TOKENS.dark;

export function useTheme(): Theme {
  return useColorScheme() === "dark" ? dark : light;
}

export const TOUCH = 48;
