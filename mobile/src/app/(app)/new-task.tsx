import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as Crypto from "expo-crypto";
import { useQuery } from "@tanstack/react-query";
import { assignableUsers, createTaskRequest, taskDraft, type CreateTaskRequest } from "@crm/mobile-api";
import { dueChoice } from "@/lib/voice";
import { Notice } from "@/ui/components";
import { api } from "@/api/client";
import { useMyJobs } from "@/api/queries";
import { useSession } from "@/auth/session";
import { addDays, addressLine, dayKey } from "@/lib/format";
import { useOutbox } from "@/outbox/useOutbox";
import { Button, Card, s } from "@/ui/components";
import { Chips } from "@/ui/Chips";
import { TOUCH, useTheme } from "@/ui/theme";

/** A follow-up task, made on the phone and sent by the outbox. */
export default function NewTask() {
  const t = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ jobId?: string; draft?: string }>();
  // A draft from "Speak a task" (voice-task.tsx): the form opens filled, to be checked.
  const draft = useMemo(() => {
    if (!params.draft) return null;
    try {
      const r = taskDraft.safeParse(JSON.parse(params.draft));
      return r.success ? r.data : null;
    } catch {
      return null;
    }
  }, [params.draft]);
  const { user } = useSession();
  const outbox = useOutbox();
  const jobs = useMyJobs();
  const users = useQuery({ queryKey: ["users", "assignable"], queryFn: () => api("/api/users/assignable", { schema: assignableUsers }) });

  const today = dayKey();
  const [title, setTitle] = useState(draft?.title ?? "");
  const [description, setDescription] = useState(draft?.description ?? "");
  const [jobId, setJobId] = useState<string>(draft?.jobId ?? params.jobId ?? "");
  const [assignee, setAssignee] = useState<string>(draft ? draft.assignedUserId ?? user?.id ?? "" : user?.id ?? "");
  const [due, setDue] = useState<"today" | "tomorrow" | "week" | "date" | "none">(draft ? dueChoice(draft.dueDate, today) : "tomorrow");
  const [priority, setPriority] = useState<"MEDIUM" | "HIGH" | "URGENT">(draft && draft.priority !== "LOW" ? draft.priority : "MEDIUM");
  const [showAllPeople, setShowAllPeople] = useState(false);

  const dueAt =
    due === "today" ? today : due === "tomorrow" ? addDays(today, 1) : due === "week" ? addDays(today, 7) : due === "date" ? draft?.dueDate ?? undefined : undefined;
  const job = jobs.data?.data.find((j) => j.id === jobId);
  const people = useMemo(() => {
    const list = users.data ?? [];
    const me = list.find((u) => u.id === user?.id);
    const rest = list.filter((u) => u.id !== user?.id);
    return me ? [me, ...rest] : rest;
  }, [users.data, user?.id]);
  const firstSix = people.slice(0, 6);
  const visiblePeople = showAllPeople || (assignee && !firstSix.some((u) => u.id === assignee)) ? people : firstSix;

  const save = async () => {
    const body: CreateTaskRequest = {
      title: title.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(jobId ? { jobId } : {}),
      ...(assignee ? { assignedUserId: assignee } : {}),
      ...(dueAt ? { dueAt } : {}),
      priority,
    };
    const ok = createTaskRequest.safeParse(body);
    if (!ok.success) {
      Alert.alert("Check the task", ok.error.issues[0]?.message ?? "Something is missing");
      return;
    }
    await outbox.enqueue({
      kind: "task.create",
      targetId: `new:${Crypto.randomUUID()}`,
      method: "POST",
      path: "/api/tasks",
      body: ok.data,
      label: `New task · ${ok.data.title}`,
    });
    router.back();
  };

  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={s.scroll}
      keyboardShouldPersistTaps="handled"
      // iOS: leave room for the keyboard so the whole form, and Create task, can be reached.
      automaticallyAdjustKeyboardInsets
      // Dragging the form puts the keyboard away.
      keyboardDismissMode="on-drag"
    >
      <Stack.Screen options={{ title: draft ? "Check the task" : "New task" }} />
      {draft ? (
        <Notice tone="warn" text={["Drafted from what you said. Check each part before you create it.", ...draft.unclear.map((u) => `• ${u}`)].join("\n")} />
      ) : null}
      <View style={{ gap: 6 }}>
        <Text style={[s.label, { color: t.muted }]}>What needs doing</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="e.g. Inspect the drywall in unit 2"
          placeholderTextColor={t.muted}
          autoFocus
          accessibilityLabel="Task title"
          style={{ minHeight: TOUCH, borderRadius: 10, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, color: t.text, paddingHorizontal: 12, fontSize: 17 }}
        />
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="Details (optional)"
          placeholderTextColor={t.muted}
          multiline
          accessibilityLabel="Details"
          style={{ minHeight: TOUCH * 1.5, borderRadius: 10, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, color: t.text, padding: 12, fontSize: 16, textAlignVertical: "top" }}
        />
      </View>

      <View style={{ gap: 6 }}>
        <Text style={[s.label, { color: t.muted }]}>Job</Text>
        {!job && jobId && draft?.jobId === jobId ? (
          <Card>
            <Text style={[s.body, { color: t.text, fontWeight: "600" }]}>{draft.jobLabel ?? "The job you named"}</Text>
            <Button label="No job" kind="secondary" onPress={() => setJobId("")} />
          </Card>
        ) : job ? (
          <Card>
            <Text style={[s.body, { color: t.text, fontWeight: "600" }]}>{addressLine(job.lead) ?? job.title}</Text>
            <Text style={{ color: t.muted, fontSize: 13 }}>
              {job.lead?.fullName ?? ""} · {job.jobNumber}
            </Text>
            <Button label="No job" kind="secondary" onPress={() => setJobId("")} />
          </Card>
        ) : (
          <View style={{ gap: 6 }}>
            {(jobs.data?.data ?? []).slice(0, 8).map((j) => (
              <Pressable
                key={j.id}
                accessibilityRole="button"
                onPress={() => setJobId(j.id)}
                style={{ minHeight: TOUCH, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, justifyContent: "center" }}
              >
                <Text style={{ color: t.text, fontSize: 15, fontWeight: "600" }}>{addressLine(j.lead) ?? j.title}</Text>
              </Pressable>
            ))}
            <Text style={{ color: t.muted, fontSize: 13 }}>Leave it unpicked for a task with no job.</Text>
          </View>
        )}
      </View>

      <View style={{ gap: 6 }}>
        <Chips
          label="Who"
          value={assignee}
          onChange={setAssignee}
          options={visiblePeople.map((u) => ({ value: u.id, label: u.id === user?.id ? "Me" : `${u.firstName} ${u.lastName}`.trim() }))}
        />
        {people.length > 6 && !showAllPeople ? (
          <Pressable accessibilityRole="button" onPress={() => setShowAllPeople(true)} style={{ minHeight: 40, justifyContent: "center" }}>
            <Text style={{ color: t.brand, fontWeight: "600" }}>Show everyone ({people.length})</Text>
          </Pressable>
        ) : null}
      </View>

      <Chips
        label="When"
        value={due}
        onChange={setDue}
        options={[
          { value: "today", label: "Today" },
          { value: "tomorrow", label: "Tomorrow" },
          { value: "week", label: "In a week" },
          ...(draft?.dueDate && dueChoice(draft.dueDate, today) === "date"
            ? [{ value: "date" as const, label: new Date(`${draft.dueDate}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) }]
            : []),
          { value: "none", label: "No date" },
        ]}
      />
      <Chips
        label="Priority"
        value={priority}
        onChange={setPriority}
        options={[
          { value: "MEDIUM", label: "Normal" },
          { value: "HIGH", label: "High" },
          { value: "URGENT", label: "Urgent" },
        ]}
      />

      <Button label="Create task" disabled={!title.trim()} onPress={() => void save()} />
    </ScrollView>
  );
}
