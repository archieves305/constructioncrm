import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { CalendarItemDto } from "@crm/mobile-api";
import { addressLine, time } from "@/lib/format";
import { pendingFor } from "@/outbox/pending";
import { useOutbox } from "@/outbox/useOutbox";
import { s } from "./components";
import { TOUCH, useTheme } from "./theme";

const OVERLAY_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  permit_inspection: "shield-checkmark-outline",
  case_inspection: "shield-checkmark-outline",
  permit_date: "document-text-outline",
  hearing: "hammer-outline",
  job_start: "flag-outline",
  crew_install: "people-outline",
};

/** One line on Today: a task (opens it) or a read-only dated record. */
export function ItemCard({ item }: { item: CalendarItemDto }) {
  const t = useTheme();
  const router = useRouter();
  const isTask = item.kind === "task";
  const address = addressLine(item.job?.lead ?? item.lead);
  const when = item.allDay ? "All day" : `${time(item.start)}${item.end && item.end !== item.start ? `–${time(item.end)}` : ""}`;
  const { ops } = useOutbox();
  const pending = pendingFor(ops, item.id);
  const status = pending.status ?? item.status;
  const done = status === "COMPLETED";
  const tone =
    pending.failed.length ? t.danger : item.derived === "overdue" && !done ? t.danger : status === "BLOCKED" ? t.warn : done ? t.ok : item.priority === "URGENT" ? t.danger : t.brand;
  const badge =
    pending.failed.length ? "Not sent" : pending.waiting ? (done ? "Done · sending" : "Sending") : item.derived === "overdue" && !done ? "Overdue" : status === "BLOCKED" ? "Blocked" : done ? "Done" : item.priority === "URGENT" ? "Urgent" : null;

  const body = (
    <View
      style={{
        minHeight: TOUCH + 16,
        flexDirection: "row",
        gap: 12,
        padding: 14,
        borderRadius: 12,
        borderWidth: 1,
        borderStyle: isTask ? "solid" : "dashed",
        borderColor: t.border,
        backgroundColor: t.card,
        borderLeftWidth: 4,
        borderLeftColor: tone,
      }}
    >
      <View style={{ width: 62 }}>
        <Text style={{ color: t.muted, fontSize: 13, fontWeight: "600" }}>{when}</Text>
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        {address ? <Text style={{ color: t.muted, fontSize: 13 }}>{address}</Text> : null}
        <Text style={[s.body, { color: t.text, fontWeight: "600", textDecorationLine: done ? "line-through" : "none" }]}>
          {isTask ? item.title : item.overlay?.label ?? item.title}
        </Text>
        {!isTask && item.overlay?.detail ? <Text style={{ color: t.muted, fontSize: 14 }}>{item.overlay.detail}</Text> : null}
        {item.status === "BLOCKED" && item.blockedReason ? (
          <Text style={{ color: t.warn, fontSize: 14 }}>Blocked: {item.blockedReason}</Text>
        ) : null}
        <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
          {badge ? <Text style={{ color: tone, fontSize: 13, fontWeight: "700" }}>{badge}</Text> : null}
          {item.checklist.total > 0 ? (
            <Text style={{ color: t.muted, fontSize: 13 }}>
              Checklist {item.checklist.done}/{item.checklist.total}
            </Text>
          ) : null}
          {item.counts.notes > 0 ? <Text style={{ color: t.muted, fontSize: 13 }}>{item.counts.notes} notes</Text> : null}
        </View>
      </View>
      {isTask ? (
        <Ionicons name="chevron-forward" size={20} color={t.muted} style={{ alignSelf: "center" }} />
      ) : (
        <Ionicons name={OVERLAY_ICON[item.kind] ?? "calendar-outline"} size={20} color={t.muted} style={{ alignSelf: "center" }} />
      )}
    </View>
  );

  if (!isTask) {
    return (
      <View accessible accessibilityLabel={`${item.overlay?.label ?? item.title}${address ? `, ${address}` : ""}, ${when}`}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.title}${address ? `, ${address}` : ""}, ${when}${badge ? `, ${badge}` : ""}`}
      onPress={() => router.push({ pathname: "/task/[id]", params: { id: item.id } })}
      style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
    >
      {body}
    </Pressable>
  );
}
