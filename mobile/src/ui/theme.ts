import { useColorScheme } from "react-native";

/**
 * KNU Field colours: the CRM's steel-blue brand, high contrast for use
 * outdoors, light and dark. Touch targets are at least 48 pt.
 */
const light = {
  bg: "#F4F6F8",
  card: "#FFFFFF",
  text: "#14181C",
  muted: "#55606B",
  border: "#D5DBE1",
  brand: "#2B5F94",
  brandText: "#FFFFFF",
  brandSoft: "#E3ECF6",
  danger: "#B42318",
  warn: "#9A5B00",
  ok: "#1E7A3E",
};

const dark: typeof light = {
  bg: "#0E1114",
  card: "#171B20",
  text: "#EEF1F4",
  muted: "#A3ADB8",
  border: "#2C333B",
  brand: "#7FA9DB",
  brandText: "#0E1114",
  brandSoft: "#1C2A3A",
  danger: "#F97066",
  warn: "#F5B547",
  ok: "#5BC584",
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === "dark" ? dark : light;
}

export const TOUCH = 48;
