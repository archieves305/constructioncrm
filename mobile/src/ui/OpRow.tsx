import { Text, View } from "react-native";
import type { OutboxOp } from "@/outbox/outbox";
import { withoutExpect } from "@/outbox/pending";
import { useOutbox } from "@/outbox/useOutbox";
import { Button, Card, s } from "./components";
import { useTheme } from "./theme";

const CONFLICT_FIELDS: Record<string, string> = {
  status: "status",
  blockedReason: "blocked reason",
  dueAt: "due date",
  assignedUserId: "owner",
  title: "title",
  description: "description",
  priority: "priority",
};

/** One unsent change: what it is, why it is stuck, and what can be done. */
export function OpRow({ op, showLabel = true }: { op: OutboxOp; showLabel?: boolean }) {
  const t = useTheme();
  const { retry, discard } = useOutbox();
  const failed = op.state === "failed";
  const conflict = op.errorCode === "conflict";
  const fields = conflict
    ? ((op.errorBody as { conflicts?: string[] } | null)?.conflicts ?? []).map((f) => CONFLICT_FIELDS[f] ?? f)
    : [];
  return (
    <Card style={{ borderColor: failed ? t.danger : t.border }}>
      {showLabel ? <Text style={[s.body, { color: t.text, fontWeight: "600" }]}>{op.label}</Text> : null}
      <Text style={{ color: failed ? t.danger : t.warn, fontSize: 14 }}>
        {failed
          ? conflict
            ? `Not sent: someone changed ${fields.length ? `the ${fields.join(" and ")}` : op.kind === "log.save" ? "this log" : "it"} on the web after you last saw it.`
            : `Not sent: ${op.error ?? "the CRM refused it"}`
          : op.error
            ? `Waiting to send · ${op.error}`
            : "Waiting to send"}
      </Text>
      {failed ? (
        <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
          {conflict ? (
            <View style={{ flex: 1 }}>
              <Button label="Send mine anyway" kind="secondary" onPress={() => void retry(op.id, withoutExpect(op.body))} />
            </View>
          ) : (
            <View style={{ flex: 1 }}>
              <Button label="Try again" kind="secondary" onPress={() => void retry(op.id)} />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Button label="Discard" kind="danger" onPress={() => void discard(op.id)} />
          </View>
        </View>
      ) : null}
    </Card>
  );
}
