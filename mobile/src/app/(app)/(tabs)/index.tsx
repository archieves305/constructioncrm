import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import type { CalendarItemDto } from "@crm/mobile-api";
import { useSession } from "@/auth/session";
import { useOverdue, useToday } from "@/api/queries";
import { dayKey } from "@/lib/format";
import { Notice, s } from "@/ui/components";
import { ItemCard } from "@/ui/ItemCard";
import { Empty, LoadError, Loading } from "@/ui/states";
import { useTheme } from "@/ui/theme";

function greeting(d = new Date()): string {
  const h = d.getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** Read-only records first, then timed items by start, then all-day. */
function order(items: CalendarItemDto[]): CalendarItemDto[] {
  const rank = (i: CalendarItemDto) => (i.kind !== "task" ? 0 : i.allDay ? 2 : 1);
  return [...items].sort((a, b) => rank(a) - rank(b) || (a.start ?? "").localeCompare(b.start ?? ""));
}

/** Today: what to do now, as the web's /field/day shows it. */
export default function Today() {
  const t = useTheme();
  const qc = useQueryClient();
  const { user, offline } = useSession();
  const day = dayKey();
  const today = useToday(day);
  const overdue = useOverdue(day);
  const [refreshing, setRefreshing] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [showOverdue, setShowOverdue] = useState(false);

  const { open, done } = useMemo(() => {
    const items = order(today.data?.items ?? []);
    return {
      open: items.filter((i) => i.status !== "COMPLETED" && i.status !== "CANCELLED"),
      done: items.filter((i) => i.status === "COMPLETED"),
    };
  }, [today.data]);

  const onRefresh = async () => {
    setRefreshing(true);
    await qc.invalidateQueries({ queryKey: ["calendar"] });
    setRefreshing(false);
  };

  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={s.scroll}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.brand} />}
    >
      <View>
        <Text style={[s.h1, { color: t.text }]}>
          {greeting()}, {user?.firstName ?? ""}
        </Text>
        <Text style={[s.body, { color: t.muted }]}>
          {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          {today.data ? ` · ${open.filter((i) => i.kind === "task").length} to do` : ""}
        </Text>
      </View>
      {offline ? <Notice tone="warn" text="No connection. Showing what this phone already had." /> : null}

      {(overdue.data?.length ?? 0) > 0 ? (
        <View style={{ gap: 8 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showOverdue }}
            onPress={() => setShowOverdue((v) => !v)}
            style={{ minHeight: 48, justifyContent: "center", paddingHorizontal: 14, borderRadius: 10, backgroundColor: t.card, borderWidth: 1, borderColor: t.danger }}
          >
            <Text style={{ color: t.danger, fontSize: 16, fontWeight: "700" }}>
              {overdue.data!.length} overdue from earlier days {showOverdue ? "▴" : "▾"}
            </Text>
          </Pressable>
          {showOverdue ? overdue.data!.map((i) => <ItemCard key={i.id} item={i} />) : null}
        </View>
      ) : null}

      {today.isPending ? (
        <Loading />
      ) : today.isError ? (
        <LoadError error={today.error} onRetry={() => today.refetch()} />
      ) : open.length === 0 && done.length === 0 ? (
        <Empty title="Nothing on your calendar today" body="Tasks with today's date, inspections and job starts show here." />
      ) : (
        <View style={{ gap: 8 }}>
          {open.map((i) => (
            <ItemCard key={i.id} item={i} />
          ))}
          {open.length === 0 ? <Empty title="All done for today" /> : null}
        </View>
      )}

      {done.length > 0 ? (
        <View style={{ gap: 8 }}>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: showDone }} onPress={() => setShowDone((v) => !v)} style={{ minHeight: 44, justifyContent: "center" }}>
            <Text style={{ color: t.muted, fontSize: 15, fontWeight: "600" }}>
              Done · {done.length} {showDone ? "▴" : "▾"}
            </Text>
          </Pressable>
          {showDone ? done.map((i) => <ItemCard key={i.id} item={i} />) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}
