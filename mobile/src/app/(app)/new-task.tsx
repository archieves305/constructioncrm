import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as Crypto from "expo-crypto";
import { useQuery } from "@tanstack/react-query";
import { assignableUsers, createTaskRequest, type CreateTaskRequest } from "@crm/mobile-api";
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
  const params = useLocalSearchParams<{ jobId?: string }>();
  const { user } = useSession();
  const outbox = useOutbox();
  const jobs = useMyJobs();
  const users = useQuery({ queryKey: ["users", "assignable"], queryFn: () => api("/api/users/assignable", { schema: assignableUsers }) });

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [jobId, setJobId] = useState<string>(params.jobId ?? "");
  const [assignee, setAssignee] = useState<string>(user?.id ?? "");
  const [due, setDue] = useState<"today" | "tomorrow" | "week" | "none">("tomorrow");
  const [priority, setPriority] = useState<"MEDIUM" | "HIGH" | "URGENT">("MEDIUM");
  const [showAllPeople, setShowAllPeople] = useState(false);

  const today = dayKey();
  const dueAt = due === "today" ? today : due === "tomorrow" ? addDays(today, 1) : due === "week" ? addDays(today, 7) : undefined;
  const job = jobs.data?.data.find((j) => j.id === jobId);
  const people = useMemo(() => {
    const list = users.data ?? [];
    const me = list.find((u) => u.id === user?.id);
    const rest = list.filter((u) => u.id !== user?.id);
    return me ? [me, ...rest] : rest;
  }, [users.data, user?.id]);
  const visiblePeople = showAllPeople ? people : people.slice(0, 6);

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
      <Stack.Screen options={{ title: "New task" }} />
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
        {job ? (
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
