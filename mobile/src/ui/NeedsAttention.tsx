import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useAttentionMine } from "@/api/queries";
import { openCrmLink } from "@/lib/openLink";
import { Card, s } from "./components";
import { TOUCH, useTheme } from "./theme";

/**
 * The top of Today, as the top of the web dashboard: what needs this person,
 * one row per kind with its count, each opening the list it was counted from.
 * Rows with nothing in them are left out. Every role sees it; the server keeps
 * each role to its own rows.
 */
export function NeedsAttention() {
  const t = useTheme();
  const router = useRouter();
  const q = useAttentionMine();
  if (!q.data) return null;
  const rows = q.data.rows.filter((r) => r.count > 0);
  if (rows.length === 0)
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 }}>
        <Ionicons name="checkmark-circle" size={18} color={t.ok} />
        <Text style={{ color: t.muted, fontSize: 14 }}>Nothing of yours needs attention right now.</Text>
      </View>
    );
  return (
    <Card>
      <Text style={[s.h2, { color: t.text }]} accessibilityRole="header">
        Needs attention
      </Text>
      {rows.map((r) => {
        const tone = t.tones[r.tone];
        return (
          <Pressable
            key={r.key}
            accessibilityRole="button"
            accessibilityLabel={`${r.label}: ${r.count}`}
            onPress={() =>
              r.key === "overdue-tasks" ? openCrmLink(router, r.href) : router.push({ pathname: "/attention/[key]", params: { key: r.key, label: r.label, scope: "mine" } })
            }
            style={{ minHeight: TOUCH, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 4 }}
          >
            <View style={{ minWidth: 36, alignItems: "center", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: tone.soft }}>
              <Text style={{ color: tone.fg, fontSize: 16, fontWeight: "700" }}>{r.count}</Text>
            </View>
            <Text style={[s.body, { color: t.text, flex: 1 }]}>{r.label}</Text>
            <Ionicons name="chevron-forward" size={18} color={t.muted} />
          </Pressable>
        );
      })}
    </Card>
  );
}
