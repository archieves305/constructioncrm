import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { InspectionDto } from "@crm/mobile-api";
import { addressLine, shortDate, time } from "@/lib/format";
import { RESULT_LABEL, TYPE_LABEL } from "@/lib/inspections";
import { s } from "./components";
import { TOUCH, useTheme } from "./theme";

export function InspectionRow({ inspection, showAddress = true }: { inspection: InspectionDto; showAddress?: boolean }) {
  const t = useTheme();
  const router = useRouter();
  const i = inspection;
  const address = showAddress ? addressLine(i.permit.job.lead) : null;
  const tone =
    i.result === "FAIL" ? t.danger : i.result === "CONDITIONAL" ? t.warn : i.result === "PASS" ? t.ok : i.result === "CANCELLED" ? t.muted : t.brand;
  const when = i.result === "SCHEDULED" ? (i.scheduledFor ? `${shortDate(i.scheduledFor)}, ${time(i.scheduledFor)}` : "No date yet") : shortDate(i.completedAt ?? i.scheduledFor);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${TYPE_LABEL[i.type]} inspection${address ? `, ${address}` : ""}, ${RESULT_LABEL[i.result]}, ${when}`}
      onPress={() => router.push({ pathname: "/inspection/[id]", params: { id: i.id } })}
      style={({ pressed }) => ({
        minHeight: TOUCH + 12,
        padding: 14,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: t.border,
        borderLeftWidth: 4,
        borderLeftColor: tone,
        backgroundColor: t.card,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <Ionicons name="shield-checkmark-outline" size={22} color={tone} />
      <View style={{ flex: 1, gap: 3 }}>
        {address ? <Text style={{ color: t.muted, fontSize: 13 }}>{address}</Text> : null}
        <Text style={[s.body, { color: t.text, fontWeight: "600" }]}>{TYPE_LABEL[i.type]} inspection</Text>
        <Text style={{ color: tone, fontSize: 13, fontWeight: "600" }}>
          {RESULT_LABEL[i.result]} · {when}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={t.muted} />
    </Pressable>
  );
}
