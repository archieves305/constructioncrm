import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { TaskRowDto } from "@crm/mobile-api";
import { addressLine, shortDate } from "@/lib/format";
import { pendingFor } from "@/outbox/pending";
import { useOutbox } from "@/outbox/useOutbox";
import { s } from "./components";
import { TOUCH, useTheme } from "./theme";

export function TaskRow({ task, showAddress = true, overdue }: { task: TaskRowDto; showAddress?: boolean; overdue?: boolean }) {
  const t = useTheme();
  const router = useRouter();
  const address = showAddress ? addressLine(task.job?.lead ?? task.lead) : null;
  const { ops } = useOutbox();
  const pending = pendingFor(ops, task.id);
  const status = pending.status ?? task.status;
  const tone = pending.failed.length || overdue ? t.danger : status === "BLOCKED" ? t.warn : t.muted;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${task.title}${address ? `, ${address}` : ""}, due ${shortDate(task.dueAt)}${overdue ? ", overdue" : ""}`}
      onPress={() => router.push({ pathname: "/task/[id]", params: { id: task.id } })}
      style={({ pressed }) => ({
        minHeight: TOUCH + 12,
        padding: 14,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: t.border,
        backgroundColor: t.card,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <View style={{ flex: 1, gap: 3 }}>
        {address ? <Text style={{ color: t.muted, fontSize: 13 }}>{address}</Text> : null}
        <Text style={[s.body, { color: t.text, fontWeight: "600" }]}>{task.title}</Text>
        <Text style={{ color: tone, fontSize: 13, fontWeight: overdue ? "700" : "500" }}>
          {pending.failed.length ? "Not sent · " : pending.waiting ? (status === "COMPLETED" ? "Done · sending · " : "Sending · ") : ""}
          {status === "BLOCKED" ? "Blocked · " : ""}
          {shortDate(task.dueAt)}
          {task.priority === "URGENT" ? " · Urgent" : task.priority === "HIGH" ? " · High" : ""}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={t.muted} />
    </Pressable>
  );
}
