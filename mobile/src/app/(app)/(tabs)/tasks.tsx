import { SavedNote } from "@/cache/SavedNote";
import { useMemo } from "react";
import { RefreshControl, SectionList, Text, View } from "react-native";
import type { TaskRowDto } from "@crm/mobile-api";
import { useMyTasks } from "@/api/queries";
import { addDays, dayKey } from "@/lib/format";
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

export default function Tasks() {
  const t = useTheme();
  const tasks = useMyTasks();
  const sections = useMemo(() => group(tasks.data ?? []), [tasks.data]);

  if (tasks.isPending) return <Loading />;
  if ((tasks.isError && tasks.data === undefined))
    return (
      <View style={{ padding: 16, backgroundColor: t.bg, flex: 1 }}>
        <LoadError error={tasks.error} onRetry={() => tasks.refetch()} />
      </View>
    );
  return (
    <SectionList
      style={{ backgroundColor: t.bg }}
      sections={sections}
      keyExtractor={(task) => task.id}
      renderItem={({ item, section }) => (
        <View style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
          <TaskRow task={item} overdue={(section as Section).tone === "danger"} />
        </View>
      )}
      renderSectionHeader={({ section }) => (
        <Text
          accessibilityRole="header"
          style={{
            paddingHorizontal: 16,
            paddingTop: 16,
            paddingBottom: 6,
            fontSize: 13,
            fontWeight: "700",
            letterSpacing: 0.4,
            textTransform: "uppercase",
            color: (section as Section).tone === "danger" ? t.danger : t.muted,
            backgroundColor: t.bg,
          }}
        >
          {section.title} · {section.data.length}
        </Text>
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
  );
}
