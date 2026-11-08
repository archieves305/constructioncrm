import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { OWNER_ROLES } from "@crm/mobile-api";
import { useAttention, useOwnerSummary } from "@/api/queries";
import { useSession } from "@/auth/session";
import { moneyShort } from "@/lib/links";
import { TOUCH, useTheme } from "./theme";

/** On Today, for the owner roles only: the business in one line, opening the owner summary. */
export function OwnerStrip() {
  const t = useTheme();
  const router = useRouter();
  const { user } = useSession();
  const allowed = (OWNER_ROLES as readonly string[]).includes(user?.role ?? "");
  const summary = useOwnerSummary(allowed);
  const attention = useAttention(allowed);
  if (!allowed || !summary.data) return null;
  const urgent = (attention.data?.rows ?? []).filter((r) => r.tone === "danger").reduce((n, r) => n + r.count, 0);
  const d = summary.data;
  const parts = [
    `${d.newLeadsToday} new lead${d.newLeadsToday === 1 ? "" : "s"}`,
    `${moneyShort(d.pipeline.value)} pipeline`,
    `${d.activeJobs} active jobs`,
    ...(urgent ? [`${urgent} urgent`] : []),
  ];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Business today: ${parts.join(", ")}. Opens the owner summary.`}
      onPress={() => router.push("/owner")}
      style={{ minHeight: TOUCH, flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: urgent ? t.danger : t.border, backgroundColor: t.card }}
    >
      <Ionicons name="stats-chart-outline" size={20} color={t.brand} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.text, fontSize: 14, fontWeight: "600" }}>{parts.join(" · ")}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={t.muted} />
    </Pressable>
  );
}
