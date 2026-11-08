import { useState } from "react";
import { track } from "@/usage/track";
import { Alert, Text, TextInput, View } from "react-native";
import { addLeadNoteRequest } from "@crm/mobile-api";
import { useLeadNotes } from "@/api/queries";
import { personName, shortDate } from "@/lib/format";
import { useOutbox } from "@/outbox/useOutbox";
import { Button, Card, s } from "./components";
import { OpRow } from "./OpRow";
import { TOUCH, useTheme } from "./theme";

/**
 * Notes on a job (they live on its lead, as on the web): the latest notes and
 * a box to add one, typed or dictated with the keyboard's microphone. A note
 * is queued, so it saves without signal and shows at once as "sending".
 */
export function NotesSection({ leadId, label }: { leadId: string; label: string }) {
  const t = useTheme();
  const notes = useLeadNotes(leadId);
  const outbox = useOutbox();
  const [text, setText] = useState("");
  const [showAll, setShowAll] = useState(false);
  const target = `lead:${leadId}`;
  const mine = outbox.ops.filter((o) => o.targetId === target && o.kind === "lead.note");
  const waiting = mine.filter((o) => o.state !== "failed");
  const failed = mine.filter((o) => o.state === "failed");
  const list = notes.data ?? [];
  const shown = showAll ? list : list.slice(0, 3);

  const save = async () => {
    const body = addLeadNoteRequest.safeParse({ content: text });
    if (!body.success) return Alert.alert("Write the note first");
    track("note_saved", "lead");
    await outbox.enqueue({ kind: "lead.note", targetId: target, method: "POST", path: `/api/leads/${leadId}/notes`, body: body.data, label: `Note · ${label}` });
    setText("");
  };

  return (
    <View style={{ gap: 8 }}>
      <Text style={[s.h2, { color: t.text, marginTop: 4 }]}>Notes</Text>
      <TextInput
        value={text}
        onChangeText={setText}
        multiline
        maxLength={5000}
        placeholder="Add a note (tap the keyboard microphone to talk)"
        placeholderTextColor={t.muted}
        accessibilityLabel="New note"
        style={{ minHeight: TOUCH * 1.5, borderRadius: 10, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, color: t.text, padding: 12, fontSize: 16, textAlignVertical: "top" }}
      />
      {text.trim() ? <Button label="Save note" onPress={() => void save()} /> : null}
      {failed.map((op) => (
        <OpRow key={op.id} op={op} />
      ))}
      {waiting.map((op) => (
        <Card key={op.id} style={{ borderStyle: "dashed" }}>
          <Text style={[s.body, { color: t.text }]}>{String((op.body as { content?: string }).content ?? "")}</Text>
          <Text style={{ color: t.muted, fontSize: 12 }}>You · sending</Text>
        </Card>
      ))}
      {shown.map((n) => (
        <Card key={n.id}>
          <Text style={[s.body, { color: t.text }]}>{n.description}</Text>
          <Text style={{ color: t.muted, fontSize: 12 }}>
            {personName(n.createdBy) ?? "Someone"} · {shortDate(n.createdAt)}
          </Text>
        </Card>
      ))}
      {notes.data && list.length === 0 && !waiting.length ? <Text style={{ color: t.muted }}>No notes yet.</Text> : null}
      {list.length > 3 ? <Button label={showAll ? "Show fewer" : `Show all ${list.length} notes`} kind="secondary" onPress={() => setShowAll((x) => !x)} /> : null}
    </View>
  );
}
