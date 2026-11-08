import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { FieldIssueDto } from "@crm/mobile-api";
import { useJobIssues } from "@/api/queries";
import { personName, shortDate } from "@/lib/format";
import { useOutbox } from "@/outbox/useOutbox";
import { Button, s } from "./components";
import { LoadError, Loading } from "./states";
import { TOUCH, useTheme } from "./theme";

const TYPE_LABEL: Record<FieldIssueDto["type"], string> = {
  PUNCH: "Punch",
  SAFETY: "Safety",
  MATERIAL_REQUEST: "Materials",
  OFFICE_FOLLOW_UP: "Office",
  CO_REVIEW: "Change order",
  INSPECTION_REMINDER: "Inspection",
};

/**
 * A job's open issues and punch items, with the ones still on the phone.
 * Tapping one opens its task, where Done resolves the issue (the CRM keeps
 * the two in step) and Photo adds completion photos.
 */
export function IssueSection({ jobId }: { jobId: string }) {
  const t = useTheme();
  const router = useRouter();
  const issues = useJobIssues(jobId);
  const { ops } = useOutbox();
  const waiting = ops.filter((o) => o.kind === "issue.create" && o.path === `/api/jobs/${jobId}/field-issues`);
  const open = (issues.data ?? []).filter((i) => i.status !== "COMPLETED" && i.status !== "CANCELLED");
  const resolved = (issues.data ?? []).length - open.length;

  return (
    <View style={{ gap: 8 }}>
      <Text style={[s.h2, { color: t.text, marginTop: 4 }]}>Issues & punch · {open.length + waiting.length}</Text>
      {waiting.map((o) => (
        <View key={o.id} style={{ minHeight: TOUCH, padding: 14, borderRadius: 12, borderWidth: 1, borderStyle: "dashed", borderColor: t.border, backgroundColor: t.card }}>
          <Text style={[s.body, { color: t.text, fontWeight: "600" }]}>{(o.body as { title?: string }).title}</Text>
          <Text style={{ color: o.state === "failed" ? t.danger : t.warn, fontSize: 13 }}>
            {o.state === "failed" ? `Not sent: ${o.error ?? "refused"}` : "Waiting to send"}
          </Text>
        </View>
      ))}
      {issues.isPending ? (
        <Loading />
      ) : (issues.isError && issues.data === undefined) ? (
        <LoadError error={issues.error} onRetry={() => issues.refetch()} />
      ) : (
        open.map((i) => (
          <Pressable
            key={i.id}
            accessibilityRole="button"
            accessibilityLabel={`${TYPE_LABEL[i.type]}: ${i.title}${i.assignedTo ? `, ${personName(i.assignedTo)}` : ""}`}
            disabled={!i.task}
            onPress={() => i.task && router.push({ pathname: "/task/[id]", params: { id: i.task.id } })}
            style={({ pressed }) => ({
              minHeight: TOUCH + 8,
              padding: 14,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: t.border,
              borderLeftWidth: 4,
              borderLeftColor: i.priority === "URGENT" || i.type === "SAFETY" ? t.danger : i.type === "PUNCH" ? t.warn : t.brand,
              backgroundColor: t.card,
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              opacity: pressed ? 0.75 : 1,
            })}
          >
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={{ color: t.muted, fontSize: 12, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase" }}>{TYPE_LABEL[i.type]}</Text>
              <Text style={[s.body, { color: t.text, fontWeight: "600" }]}>{i.title}</Text>
              <Text style={{ color: t.muted, fontSize: 13 }}>
                {personName(i.assignedTo) ?? "Not assigned"}
                {i.dueAt ? ` · due ${shortDate(i.dueAt)}` : ""}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={t.muted} />
          </Pressable>
        ))
      )}
      {resolved > 0 ? <Text style={{ color: t.muted, fontSize: 13 }}>{resolved} resolved</Text> : null}
      <Button label="Report an issue or punch item" kind="secondary" onPress={() => router.push({ pathname: "/issue/new", params: { jobId } })} />
    </View>
  );
}
