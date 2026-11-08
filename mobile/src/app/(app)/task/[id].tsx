import { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useTask } from "@/api/queries";
import { useSession } from "@/auth/session";
import { addressLine, personName, shortDate, time } from "@/lib/format";
import { pendingFor, statusChange } from "@/outbox/pending";
import { useOutbox } from "@/outbox/useOutbox";
import { Button, Card, Notice, s } from "@/ui/components";
import { OpRow } from "@/ui/OpRow";
import { DocRow } from "@/ui/DocList";
import { LoadError, Loading } from "@/ui/states";
import { TOUCH, useTheme } from "@/ui/theme";

const STATUS: Record<string, string> = {
  PENDING: "To do",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  COMPLETED: "Done",
  CANCELLED: "Cancelled",
};

/** A task: Done, Blocked / Unblock, notes. Changes go through the outbox. */
export default function TaskScreen() {
  const t = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useSession();
  const task = useTask(id);
  const outbox = useOutbox();
  const [note, setNote] = useState("");
  const [blockOpen, setBlockOpen] = useState(false);
  const [reason, setReason] = useState("");

  if (task.isPending) return <Loading />;
  if (task.isError)
    return (
      <View style={{ padding: 16, flex: 1, backgroundColor: t.bg }}>
        <LoadError error={task.error} onRetry={() => task.refetch()} />
      </View>
    );

  const k = task.data;
  const pending = pendingFor(outbox.ops, k.id);
  const status = pending.status ?? k.status;
  const blockedReason = pending.blockedReason !== undefined ? pending.blockedReason : k.blockedReason;
  const open = status !== "COMPLETED" && status !== "CANCELLED";
  const address = addressLine(k.job?.lead ?? k.lead);
  const notes = k.events.filter((e) => e.type === "NOTE" && e.body);
  const due = k.dueAt ? `${shortDate(k.dueAt)}${k.allDay ? "" : `, ${time(k.scheduledStart ?? k.dueAt)}`}` : "No date";
  // The server's copy is what the phone last saw: the conflict check compares to it.
  const seen = { status: k.status, blockedReason: k.blockedReason };

  const change = (label: string, next: Parameters<typeof statusChange>[1]) =>
    outbox.enqueue({
      kind: "task.update",
      targetId: k.id,
      method: "PATCH",
      path: `/api/tasks/${k.id}`,
      body: statusChange(seen, next),
      label: `${label} · ${k.title}`,
    });

  const sendNote = async () => {
    const body = note.trim();
    if (!body) return;
    setNote("");
    await outbox.enqueue({
      kind: "task.note",
      targetId: k.id,
      method: "POST",
      path: `/api/tasks/${k.id}/notes`,
      body: { body },
      label: `Note · ${k.title}`,
    });
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "android" ? "height" : undefined}>
      <ScrollView
        style={{ backgroundColor: t.bg }}
        contentContainerStyle={s.scroll}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={task.isRefetching} onRefresh={() => void task.refetch()} tintColor={t.brand} />}
      >
        <Stack.Screen options={{ title: "Task" }} />
        {address && k.job ? (
          <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: "/job/[id]", params: { id: k.job!.id } })}>
            <Text style={{ color: t.brand, fontSize: 15, fontWeight: "600" }}>{address} ›</Text>
          </Pressable>
        ) : address ? (
          <Text style={{ color: t.muted, fontSize: 15 }}>{address}</Text>
        ) : null}
        <Text style={[s.h1, { color: t.text, fontSize: 24 }]}>{k.title}</Text>

        <Card>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
            <View>
              <Text style={[s.label, { color: t.muted }]}>Status</Text>
              <Text style={[s.body, { color: status === "BLOCKED" ? t.warn : status === "COMPLETED" ? t.ok : t.text, fontWeight: "600" }]}>
                {STATUS[status] ?? status}
                {pending.waiting ? " · sending" : ""}
              </Text>
            </View>
            <View>
              <Text style={[s.label, { color: t.muted }]}>Due</Text>
              <Text style={[s.body, { color: t.text }]}>{due}</Text>
            </View>
            <View>
              <Text style={[s.label, { color: t.muted }]}>Owner</Text>
              <Text style={[s.body, { color: t.text }]}>{personName(k.assignedTo) ?? "Nobody"}</Text>
            </View>
          </View>
          {status === "BLOCKED" && blockedReason ? <Notice tone="warn" text={`Blocked: ${blockedReason}`} /> : null}
          {k.description ? <Text style={[s.body, { color: t.text, marginTop: 6 }]}>{k.description}</Text> : null}
        </Card>

        {pending.failed.map((op) => (
          <OpRow key={op.id} op={op} />
        ))}

        {k.viewer.canEdit ? (
          <Button
            label={pending.photos ? `Photo · ${pending.photos} waiting to send` : "Photo"}
            kind="secondary"
            onPress={() => router.push({ pathname: "/photo", params: { taskId: k.id, label: `${address ? `${address} · ` : ""}${k.title}` } })}
          />
        ) : null}
        {k.viewer.canEdit && open ? (
          <View style={{ gap: 10 }}>
            <Button label="Done" onPress={() => void change("Mark done", { status: "COMPLETED" })} />
            {status === "BLOCKED" ? (
              <Button
                label="Unblock"
                kind="secondary"
                onPress={() => void change("Unblock", { status: "PENDING", blockedReason: null })}
              />
            ) : (
              <Button label="Blocked…" kind="secondary" onPress={() => setBlockOpen(true)} />
            )}
          </View>
        ) : null}
        {k.viewer.canEdit && status === "COMPLETED" && k.status === "COMPLETED" ? (
          <Button label="Reopen" kind="secondary" onPress={() => void change("Reopen", { status: "PENDING" })} />
        ) : null}
        {!k.viewer.canEdit ? <Notice text="You can see this task but not change it. You can still add a note." /> : null}

        <Text style={[s.h2, { color: t.text }]}>Notes · {notes.length + pending.notes.length}</Text>
        {notes.map((n) => (
          <Card key={n.id}>
            <Text style={{ color: t.muted, fontSize: 13 }}>
              {personName(n.actor) ?? "Someone"} · {shortDate(n.createdAt)} {time(n.createdAt)}
            </Text>
            <Text style={[s.body, { color: t.text }]}>{n.body}</Text>
          </Card>
        ))}
        {pending.notes
          .filter((n) => !n.failed)
          .map((n) => (
            <Card key={n.id}>
              <Text style={{ color: t.warn, fontSize: 13 }}>
                {user ? `${user.firstName} ${user.lastName}` : "You"} · waiting to send
              </Text>
              <Text style={[s.body, { color: t.text }]}>{n.body}</Text>
            </Card>
          ))}
        <View style={{ gap: 8 }}>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Add a note"
            placeholderTextColor={t.muted}
            multiline
            accessibilityLabel="Note"
            style={{ minHeight: TOUCH * 1.5, borderRadius: 10, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, color: t.text, padding: 12, fontSize: 16, textAlignVertical: "top" }}
          />
          <Button label="Add note" kind="secondary" disabled={!note.trim()} onPress={() => void sendNote()} />
        </View>

        {k.files.length > 0 ? (
          <>
            <Text style={[s.h2, { color: t.text }]}>Attachments · {k.files.length}</Text>
            {k.files.map((f) => (
              <DocRow key={f.id} file={{ ...f, missing: false, takenAt: null }} />
            ))}
          </>
        ) : null}
      </ScrollView>

      <Modal visible={blockOpen} transparent animationType="fade" onRequestClose={() => setBlockOpen(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 20 }}>
          <Card style={{ gap: 12 }}>
            <Text style={[s.h2, { color: t.text }]}>What is it waiting on?</Text>
            <TextInput
              value={reason}
              onChangeText={setReason}
              autoFocus
              placeholder="e.g. Trusses not delivered"
              placeholderTextColor={t.muted}
              accessibilityLabel="Blocked reason"
              style={{ minHeight: TOUCH, borderRadius: 10, borderWidth: 1, borderColor: t.border, backgroundColor: t.bg, color: t.text, paddingHorizontal: 12, fontSize: 16 }}
            />
            <Button
              label="Mark blocked"
              disabled={!reason.trim()}
              onPress={() => {
                const r = reason.trim();
                setBlockOpen(false);
                setReason("");
                void change("Mark blocked", { status: "BLOCKED", blockedReason: r });
              }}
            />
            <Button label="Cancel" kind="secondary" onPress={() => setBlockOpen(false)} />
          </Card>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}
