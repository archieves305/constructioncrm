import { useMemo, useState, useEffect } from "react";
import { track } from "@/usage/track";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQueryClient } from "@tanstack/react-query";
import type { CalendarItemDto } from "@crm/mobile-api";
import { useSession } from "@/auth/session";
import { useCalendarRange, useOverdue, useToday } from "@/api/queries";
import { SavedNote } from "@/cache/SavedNote";
import { OwnerStrip } from "@/ui/OwnerStrip";
import { NeedsAttention } from "@/ui/NeedsAttention";
import { usePush } from "@/push/push";
import { addDays, dayKey } from "@/lib/format";
import { groupByDay, orderDay } from "@/lib/calendar";
import { Button, Card, Notice, s } from "@/ui/components";
import { ItemCard } from "@/ui/ItemCard";
import { Empty, LoadError, Loading } from "@/ui/states";
import { TOUCH, useTheme } from "@/ui/theme";

function greeting(d = new Date()): string {
  const h = d.getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** "Monday, November 9" for a yyyy-MM-dd day (noon UTC keeps it on that date). */
function longDay(key: string): string {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
}
function shortDay(key: string): string {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * Today: what to do now, as the web's /field/day shows it. The arrows move
 * a day at a time; Week shows the next seven days grouped by date, from the
 * same calendar the web uses.
 */
export default function Today() {
  const t = useTheme();
  useEffect(() => track("today_opened"), []);
  const qc = useQueryClient();
  const { user } = useSession();
  const todayKey = dayKey();
  const [day, setDay] = useState(todayKey);
  const [view, setView] = useState<"day" | "week">("day");
  const isToday = day === todayKey;
  const dayQ = useToday(day);
  const weekQ = useCalendarRange(day, addDays(day, 6), view === "week");
  const overdue = useOverdue(todayKey);
  const [refreshing, setRefreshing] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [showOverdue, setShowOverdue] = useState(false);
  const push = usePush();

  const { open, done } = useMemo(() => {
    const items = orderDay(dayQ.data?.items ?? []);
    return {
      open: items.filter((i) => i.status !== "COMPLETED" && i.status !== "CANCELLED"),
      done: items.filter((i) => i.status === "COMPLETED"),
    };
  }, [dayQ.data]);
  const week = useMemo(() => groupByDay(weekQ.data?.items ?? [], day, 7), [weekQ.data, day]);

  const onRefresh = async () => {
    setRefreshing(true);
    await qc.invalidateQueries({ queryKey: ["calendar"] });
    setRefreshing(false);
  };

  const step = view === "week" ? 7 : 1;

  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={s.scroll}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.brand} />}
    >
      <View>
        <Text style={[s.h1, { color: t.text }]}>
          {isToday ? `${greeting()}, ${user?.firstName ?? ""}` : view === "week" ? `Week of ${shortDay(day)}` : longDay(day)}
        </Text>
        <Text style={[s.body, { color: t.muted }]}>
          {view === "week"
            ? `${shortDay(day)} – ${shortDay(addDays(day, 6))}`
            : `${isToday ? longDay(day) : "Not today"}${dayQ.data ? ` · ${open.filter((i) => i.kind === "task").length} to do` : ""}`}
        </Text>
      </View>

      {/* ‹ day › and Day | Week */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={view === "week" ? "Previous week" : "Previous day"}
          onPress={() => setDay((d) => addDays(d, -step))}
          style={{ width: TOUCH, height: TOUCH, borderRadius: 10, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-back" size={22} color={t.text} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to today"
          disabled={isToday}
          onPress={() => setDay(todayKey)}
          style={{ minHeight: TOUCH, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, justifyContent: "center", opacity: isToday ? 0.5 : 1 }}
        >
          <Text style={{ color: t.text, fontWeight: "600", fontSize: 15 }}>Today</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={view === "week" ? "Next week" : "Next day"}
          onPress={() => setDay((d) => addDays(d, step))}
          style={{ width: TOUCH, height: TOUCH, borderRadius: 10, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="chevron-forward" size={22} color={t.text} />
        </Pressable>
        <View style={{ flex: 1 }} />
        <View style={{ flexDirection: "row", borderRadius: 10, borderWidth: 1, borderColor: t.border, overflow: "hidden" }} accessibilityRole="tablist">
          {(["day", "week"] as const).map((v) => (
            <Pressable
              key={v}
              accessibilityRole="tab"
              accessibilityState={{ selected: view === v }}
              onPress={() => setView(v)}
              style={{ minHeight: TOUCH, paddingHorizontal: 14, justifyContent: "center", backgroundColor: view === v ? t.brand : t.card }}
            >
              <Text style={{ color: view === v ? t.brandText : t.text, fontWeight: "700", fontSize: 15 }}>{v === "day" ? "Day" : "Week"}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <SavedNote />
      {/* Act first, as the web dashboard: what needs you, then the day, then the figures. */}
      <NeedsAttention />
      {push.state === "undetermined" ? (
        <Card>
          <Text style={[s.h2, { color: t.text }]}>Get a buzz when work comes in</Text>
          <Text style={[s.body, { color: t.muted }]}>
            KNU Field tells you when a task is assigned to you, when you are mentioned, and when something is escalated. It shows the job address, never prices or customer details.
          </Text>
          <Button label="Turn on notifications" onPress={() => void push.ask()} />
        </Card>
      ) : null}

      {isToday && (overdue.data?.length ?? 0) > 0 ? (
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

      {view === "week" ? (
        weekQ.isPending ? (
          <Loading />
        ) : (weekQ.isError && weekQ.data === undefined) ? (
          <LoadError error={weekQ.error} onRetry={() => weekQ.refetch()} />
        ) : (
          week.map((d) => (
            <View key={d.day} style={{ gap: 8 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${longDay(d.day)}, ${d.items.length} items. Open this day.`}
                onPress={() => {
                  setDay(d.day);
                  setView("day");
                }}
                style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 40, marginTop: 4 }}
              >
                <Text accessibilityRole="header" style={{ color: d.day === todayKey ? t.brand : t.text, fontSize: 16, fontWeight: "700" }}>
                  {d.day === todayKey ? "Today · " : ""}
                  {shortDay(d.day)}
                </Text>
                <Text style={{ color: t.muted, fontSize: 14 }}>
                  {d.items.length ? `${d.items.length} ${d.items.length === 1 ? "item" : "items"}` : "Nothing"} ›
                </Text>
              </Pressable>
              {d.items.map((i) => (
                <ItemCard key={`${d.day}-${i.id}`} item={i} />
              ))}
            </View>
          ))
        )
      ) : dayQ.isPending ? (
        <Loading />
      ) : (dayQ.isError && dayQ.data === undefined) ? (
        <LoadError error={dayQ.error} onRetry={() => dayQ.refetch()} />
      ) : open.length === 0 && done.length === 0 ? (
        <Empty
          title={isToday ? "Nothing on your calendar today" : "Nothing on your calendar this day"}
          body="Tasks with this date, inspections and job starts show here."
        />
      ) : (
        <View style={{ gap: 8 }}>
          {open.map((i) => (
            <ItemCard key={i.id} item={i} />
          ))}
          {open.length === 0 ? <Empty title={isToday ? "All done for today" : "All done for this day"} /> : null}
        </View>
      )}

      {view === "day" && done.length > 0 ? (
        <View style={{ gap: 8 }}>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: showDone }} onPress={() => setShowDone((v) => !v)} style={{ minHeight: 44, justifyContent: "center" }}>
            <Text style={{ color: t.muted, fontSize: 15, fontWeight: "600" }}>
              Done · {done.length} {showDone ? "▴" : "▾"}
            </Text>
          </Pressable>
          {showDone ? done.map((i) => <ItemCard key={i.id} item={i} />) : null}
        </View>
      ) : null}
      <OwnerStrip />
    </ScrollView>
  );
}
