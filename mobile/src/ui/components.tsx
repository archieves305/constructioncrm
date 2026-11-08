import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { TOUCH, useTheme } from "./theme";

export function Button({
  label,
  onPress,
  kind = "primary",
  busy,
  disabled,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  kind?: "primary" | "secondary" | "danger";
  busy?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
}) {
  const t = useTheme();
  const bg = kind === "primary" ? t.brand : t.card;
  const fg = kind === "primary" ? t.brandText : kind === "danger" ? t.danger : t.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled || !!busy, busy: !!busy }}
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        s.btn,
        { backgroundColor: bg, borderColor: kind === "primary" ? t.brand : t.border, opacity: pressed || disabled ? 0.7 : 1 },
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[s.btnText, { color: fg }]}>{label}</Text>}
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return <View style={[s.card, { backgroundColor: t.card, borderColor: t.border }, style]}>{children}</View>;
}

export function Notice({ text, tone = "info" }: { text: string; tone?: "info" | "warn" | "danger" }) {
  const t = useTheme();
  const color = tone === "danger" ? t.danger : tone === "warn" ? t.warn : t.muted;
  return (
    <View accessibilityRole="alert" style={[s.notice, { borderColor: color }]}>
      <Text style={[s.noticeText, { color: t.text }]}>{text}</Text>
    </View>
  );
}

/** Placeholder body for screens that arrive in Phase 2. */
export function ComingSoon({ title, what }: { title: string; what: string }) {
  const t = useTheme();
  return (
    <View style={[s.screen, { backgroundColor: t.bg }]}>
      <Card>
        <Text style={[s.h2, { color: t.text }]}>{title}</Text>
        <Text style={[s.body, { color: t.muted }]}>{what}</Text>
      </Card>
    </View>
  );
}

export const s = StyleSheet.create({
  /** A screen that does not scroll (fills the space). */
  screen: { flex: 1, padding: 16, gap: 12 },
  /** A ScrollView's content: grows with what it holds. `flex: 1` here would
   *  pin it to the screen's height and stop it scrolling. */
  scroll: { flexGrow: 1, padding: 16, gap: 12, paddingBottom: 40 },
  btn: { minHeight: TOUCH + 4, borderRadius: 10, borderWidth: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 18 },
  btnText: { fontSize: 17, fontWeight: "700" },
  card: { borderWidth: 1, borderRadius: 12, padding: 16, gap: 6 },
  notice: { borderLeftWidth: 4, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 6 },
  noticeText: { fontSize: 15, lineHeight: 21 },
  h1: { fontSize: 28, fontWeight: "800" },
  h2: { fontSize: 19, fontWeight: "700" },
  body: { fontSize: 16, lineHeight: 23 },
  label: { fontSize: 13, fontWeight: "600", letterSpacing: 0.4, textTransform: "uppercase" },
});
