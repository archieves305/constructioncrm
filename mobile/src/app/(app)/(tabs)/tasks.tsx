import { SavedNote } from "@/cache/SavedNote";
import { track } from "@/usage/track";
import { useMemo, useState } from "react";
import { Alert, Pressable, RefreshControl, SectionList, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { TaskRowDto } from "@crm/mobile-api";
import { useAssignable, useMyTasks } from "@/api/queries";
import { useSession } from "@/auth/session";
import { addDays, dayKey, shortDate } from "@/lib/format";
import { moveChoices } from "@/lib/triage";
import { dueChange, ownerChange, pendingFor, statusChange } from "@/outbox/pending";
import { useOutbox } from "@/outbox/useOutbox";
import { Button } from "@/ui/components";
import { PickSheet } from "@/ui/PickSheet";
import { TOUCH } from "@/ui/theme";
import { TaskRow } from "@/ui/TaskRow";
import { Empty, LoadError, Loading } from "@/ui/states";
import { useTheme } from "@/ui/theme";

type Section = { title: string; tone?: "danger"; data: TaskRowDto[] };

/** My open tasks: overdue, today, this week, later, no date. */
function group(tasks: TaskRowDto[]): Section[] {
  const today = dayKey();
  const weekEnd = addDays(today, 7);
  const buckets: Record<string, TaskRowDto[]> = { overdue: [], today: [], week: [], later: [], none: [] };
  for (const task of tasks) {
    if (!task.dueAt) {
      buckets.none.push(task);
      continue;
    }
    const d = dayKey(new Date(task.dueAt));
    const timedPast = !task.allDay && new Date(task.dueAt).getTime() < Date.now();
    if (d < today || (d === today && timedPast)) buckets.overdue.push(task);
    else if (d === today) buckets.today.push(task);
    else if (d <= weekEnd) buckets.week.push(task);
    else buckets.later.push(task);
  }
  return [
    { title: "Overdue", tone: "danger" as const, data: buckets.overdue },
    { title: "Today", data: buckets.today },
    { title: "Next 7 days", data: buckets.week },
    { title: "Later", data: buckets.later },
    { title: "No date", data: buckets.none },
  ].filter((sec) => sec.data.length > 0);
}

/**
 * My tasks with the phone's unsent changes laid over them: a task given to
 * someone else or marked done leaves the list, a moved one changes section,
 * before the change is even sent.
 */
function withPending(tasks: TaskRowDto[], ops: Parameters<typeof pendingFor>[0], me: string | undefined): TaskRowDto[] {
  const out: TaskRowDto[] = [];
  for (const task of tasks) {
    const p = pendingFor(ops, task.id);
    if (p.status === "COMPLETED" || p.status === "CANCELLED") continue;
    if (p.assignedUserId !== undefined && p.assignedUserId !== me) continue;
    out.push(p.dueDay !== undefined ? { ...task, dueAt: p.dueDay ? `${p.dueDay}T16:00:00.000Z` : null, allDay: true } : task);
  }
  return out;
}

export default function Tasks() {
  const t = useTheme();
  const tasks = useMyTasks();
  const outbox = useOutbox();
  const { user } = useSession();
  const people = useAssignable();
  const sections = useMemo(() => group(withPending(tasks.data ?? [], outbox.ops, user?.id)), [tasks.data, outbox.ops, user?.id]);
  // Clearing overdue work: select several, then move, give away or complete them all.
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [sheet, setSheet] = useState<"move" | "give" | null>(null);
  const byId = useMemo(() => new Map((tasks.data ?? []).map((x) => [x.id, x])), [tasks.data]);
  const overdueIds = sections.find((x) => x.tone === "danger")?.data.map((x) => x.id) ?? [];
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const finish = () => {
    setSelecting(false);
    setPicked([]);
    setSheet(null);
  };
  const each = async (make: (task: TaskRowDto) => { body: unknown; label: string }) => {
    track("tasks_bulk_changed", "task");
    for (const id of picked) {
      const task = byId.get(id);
      if (!task) continue;
      const { body, label } = make(task);
      await outbox.enqueue({ kind: "task.update", targetId: id, method: "PATCH", path: `/api/tasks/${id}`, body, label: `${label} · ${task.title}` });
    }
    finish();
  };

  if (tasks.isPending) return <Loading />;
  if ((tasks.isError && tasks.data === undefined))
    return (
      <View style={{ padding: 16, backgroundColor: t.bg, flex: 1 }}>
        <LoadError error={tasks.error} onRetry={() => tasks.refetch()} />
      </View>
    );
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
    <SectionList
      style={{ backgroundColor: t.bg }}
      sections={sections}
      keyExtractor={(task) => task.id}
      renderItem={({ item, section }) => {
        const overdue = (section as Section).tone === "danger";
        if (selecting && overdue) {
          const on = picked.includes(item.id);
          return (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={item.title}
              onPress={() => toggle(item.id)}
              style={{ paddingHorizontal: 16, paddingVertical: 4, flexDirection: "row", alignItems: "center", gap: 10 }}
            >
              <Ionicons name={on ? "checkbox" : "square-outline"} size={26} color={on ? t.brand : t.muted} />
              <View style={{ flex: 1 }} pointerEvents="none">
                <TaskRow task={item} overdue />
              </View>
            </Pressable>
          );
        }
        return (
          <View style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
            <TaskRow task={item} overdue={overdue} />
          </View>
        );
      }}
      renderSectionHeader={({ section }) => (
        <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: t.bg, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6 }}>
          <Text
            accessibilityRole="header"
            style={{ flex: 1, fontSize: 13, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase", color: (section as Section).tone === "danger" ? t.danger : t.muted }}
          >
            {section.title} · {section.data.length}
          </Text>
          {(section as Section).tone === "danger" && section.data.length > 1 ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => (selecting ? finish() : setSelecting(true))}
              style={{ minHeight: TOUCH - 8, paddingHorizontal: 8, justifyContent: "center" }}
            >
              <Text style={{ color: t.brand, fontWeight: "700" }}>{selecting ? "Cancel" : "Select"}</Text>
            </Pressable>
          ) : null}
        </View>
      )}
      stickySectionHeadersEnabled
      ListHeaderComponent={
        <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
          <SavedNote />
        </View>
      }
      contentContainerStyle={{ paddingBottom: 24 }}
      refreshControl={<RefreshControl refreshing={tasks.isRefetching} onRefresh={() => void tasks.refetch()} tintColor={t.brand} />}
      ListEmptyComponent={
        <View style={{ padding: 16 }}>
          <Empty title="No open tasks assigned to you" />
        </View>
      }
    />
    {selecting ? (
      <View style={{ borderTopWidth: 1, borderTopColor: t.border, backgroundColor: t.card, padding: 12, gap: 8 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ color: t.text, fontWeight: "600" }}>{picked.length} selected</Text>
          <Pressable accessibilityRole="button" onPress={() => setPicked(picked.length === overdueIds.length ? [] : overdueIds)} style={{ minHeight: 36, justifyContent: "center" }}>
            <Text style={{ color: t.brand, fontWeight: "600" }}>{picked.length === overdueIds.length ? "Select none" : "Select all overdue"}</Text>
          </Pressable>
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button label="Move to…" kind="secondary" disabled={!picked.length} onPress={() => setSheet("move")} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="Give to…" kind="secondary" disabled={!picked.length} onPress={() => setSheet("give")} />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label="Done"
              kind="secondary"
              disabled={!picked.length}
              onPress={() =>
                Alert.alert(`Mark ${picked.length} task${picked.length === 1 ? "" : "s"} done?`, "Workflow steps that still need a checklist or a document will be refused and listed under Waiting to send.", [
                  { text: "Not yet", style: "cancel" },
                  { text: "Mark done", onPress: () => void each((task) => ({ body: statusChange({ status: task.status, blockedReason: task.blockedReason ?? null }, { status: "COMPLETED" }), label: "Done" })) },
                ])
              }
            />
          </View>
        </View>
      </View>
    ) : null}
    <PickSheet
      title={`Move ${picked.length} to`}
      visible={sheet === "move"}
      onClose={() => setSheet(null)}
      options={moveChoices(dayKey()).map((c) => ({ key: c.day, label: c.label, detail: shortDate(`${c.day}T12:00:00.000Z`) }))}
      onPick={(day) => {
        const c = moveChoices(dayKey()).find((x) => x.day === day);
        void each((task) => ({ body: dueChange(task.dueAt, day), label: `Moved to ${c?.label.toLowerCase() ?? day}` }));
      }}
    />
    <PickSheet
      title={`Give ${picked.length} to`}
      visible={sheet === "give"}
      onClose={() => setSheet(null)}
      options={(people.data ?? []).filter((u) => u.id !== user?.id).map((u) => ({ key: u.id, label: `${u.firstName} ${u.lastName}`.trim() }))}
      onPick={(id) => {
        const name = (people.data ?? []).find((u) => u.id === id)?.firstName ?? "someone";
        void each((task) => ({ body: ownerChange(task.assignedTo?.id ?? null, id), label: `Given to ${name}` }));
      }}
    />
    </View>
  );
}
