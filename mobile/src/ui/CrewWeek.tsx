import { useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { crewAckResponse, type CrewWeekItemDto } from "@crm/mobile-api";
import { api, ApiError } from "@/api/client";
import { useCrewWeek } from "@/api/queries";
import { addDays, dayKey } from "@/lib/format";
import { startLabel } from "@/lib/crew";
import { Button, Card, s } from "./components";
import { Empty, LoadError, Loading } from "./states";
import { TOUCH, useTheme } from "./theme";

function dayTitle(key: string, today: string): string {
  if (key === today) return "Today";
  if (key === addDays(today, 1)) return "Tomorrow";
  return new Date(`${key}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * The crew's week: each install day on their jobs, with the start time and a
 * "Got it" the PM sees. Only the office changes a date; a crew lead answers
 * Got it or Can't make it. The answer needs signal (it is a reply, not a
 * record to queue), and says so when there is none.
 */
export function CrewWeek() {
  const t = useTheme();
  const today = dayKey();
  const [from, setFrom] = useState(today);
  const q = useCrewWeek(from);
  const [refreshing, setRefreshing] = useState(false);

  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={[s.scroll, { gap: 12 }]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={t.brand}
          onRefresh={async () => {
            setRefreshing(true);
            await q.refetch();
            setRefreshing(false);
          }}
        />
      }
    >
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Button label="‹ Earlier" kind="secondary" disabled={from <= today} onPress={() => setFrom(addDays(from, -7))} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Later ›" kind="secondary" onPress={() => setFrom(addDays(from, 7))} />
        </View>
      </View>
      {q.isPending ? <Loading /> : null}
      {q.isError && q.data === undefined ? <LoadError error={q.error} noun="schedule" onRetry={() => q.refetch()} /> : null}
      {q.data && q.data.days.every((d) => d.items.length === 0) ? <Empty title="Nothing scheduled this week" body="Install days the office sets on your jobs show here." /> : null}
      {q.data?.days
        .filter((d) => d.items.length > 0)
        .map((d) => (
          <View key={d.date} style={{ gap: 8 }}>
            <Text style={[s.h2, { color: t.text }]} accessibilityRole="header">
              {dayTitle(d.date, today)}
            </Text>
            {d.items.map((i) => (
              <Item key={i.crewAssignmentId} item={i} from={from} />
            ))}
          </View>
        ))}
    </ScrollView>
  );
}

function Item({ item, from }: { item: CrewWeekItemDto; from: string }) {
  const t = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const start = startLabel(item.startMinutes);

  const answer = async (value: "CONFIRMED" | "CANT_MAKE_IT") => {
    setBusy(true);
    try {
      await api(`/api/crew-assignments/${item.crewAssignmentId}/ack`, { method: "POST", body: { answer: value }, schema: crewAckResponse, idempotencyKey: Crypto.randomUUID() });
      await qc.invalidateQueries({ queryKey: ["crew", "week", from] });
    } catch (e) {
      Alert.alert("Not sent", e instanceof ApiError && e.offline ? "No signal. Try again when you have it." : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.street}`} onPress={() => router.push({ pathname: "/job/[id]", params: { id: item.jobId } })} style={{ minHeight: TOUCH - 8 }}>
        <Text style={[s.body, { color: t.text, fontWeight: "700" }]}>{item.street}</Text>
        <Text style={{ color: t.muted, fontSize: 15 }}>{[start ? `Start ${start}` : "Start time not set", item.crewName].filter(Boolean).join(" · ")}</Text>
      </Pressable>
      {item.confirmation === "CONFIRMED" ? (
        <Text style={{ color: t.ok, fontSize: 15, fontWeight: "600" }}>✓ You confirmed</Text>
      ) : item.confirmation === "CANT_MAKE_IT" ? (
        <Text style={{ color: t.danger, fontSize: 15, fontWeight: "600" }}>You said you can't make it. The PM has been told.</Text>
      ) : (
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button label="Got it" disabled={busy} onPress={() => void answer("CONFIRMED")} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="Can't make it" kind="secondary" disabled={busy} onPress={() => void answer("CANT_MAKE_IT")} />
          </View>
        </View>
      )}
    </Card>
  );
}
