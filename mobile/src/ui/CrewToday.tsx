import { useState } from "react";
import { Linking, Platform, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { CrewJobCardDto } from "@crm/mobile-api";
import { useCrewToday } from "@/api/queries";
import { useSession } from "@/auth/session";
import { dayKey, dialable, mapsUrl } from "@/lib/format";
import { isForeman, startLabel } from "@/lib/crew";
import { Button, Card, s } from "./components";
import { StatusBadge } from "./StatusBadge";
import { Empty, LoadError, Loading } from "./states";
import { TOUCH, useTheme } from "./theme";

function greeting(d = new Date()): string {
  const h = d.getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/**
 * Today for a crew lead (and, later, a crew member): what am I doing today.
 * One card per job they're on, with the start time, the PM to call, the way
 * there, their own tasks and the day's log, then the three things they do
 * most. The data is the crew projection: no money, no customer contact.
 */
export function CrewToday() {
  const t = useTheme();
  const router = useRouter();
  const { user } = useSession();
  const day = dayKey();
  const q = useCrewToday(day);
  const [refreshing, setRefreshing] = useState(false);

  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={[s.scroll, { gap: 14 }]}
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
      <View>
        <Text style={[s.h1, { color: t.text }]}>
          {greeting()}
          {user?.firstName ? `, ${user.firstName}` : ""}
        </Text>
        <Text style={{ color: t.muted, fontSize: 15 }}>{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</Text>
      </View>

      {q.isPending ? <Loading /> : null}
      {q.isError && q.data === undefined ? <LoadError error={q.error} noun="day" onRetry={() => q.refetch()} /> : null}
      {q.data && q.data.jobs.length === 0 ? (
        <Empty title="No job today" body={q.data.next ? `Next: ${q.data.next.street}, ${new Date(`${q.data.next.date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" })}` : "Nothing scheduled yet. Pull down to check again."} />
      ) : null}
      {q.data?.jobs.map((j) => <JobCard key={j.jobId} job={j} />)}

      <View style={{ flexDirection: "row", gap: 8 }}>
        <Quick icon="camera-outline" label="Photo" onPress={() => router.push(q.data?.jobs.length === 1 ? { pathname: "/photo", params: { jobId: q.data.jobs[0].jobId, label: q.data.jobs[0].street } } : "/photo")} />
        <Quick icon="warning-outline" label="Problem" onPress={() => router.push(q.data?.jobs.length === 1 ? { pathname: "/problem", params: { jobId: q.data.jobs[0].jobId } } : "/problem")} />
        <Quick icon="cube-outline" label="Materials" onPress={() => router.push(q.data?.jobs.length === 1 ? { pathname: "/materials", params: { jobId: q.data.jobs[0].jobId } } : "/materials")} />
      </View>
    </ScrollView>
  );
}

function Quick({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({ flex: 1, minHeight: TOUCH + 16, alignItems: "center", justifyContent: "center", gap: 4, borderRadius: 12, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, opacity: pressed ? 0.7 : 1 })}
    >
      <Ionicons name={icon} size={26} color={t.brand} />
      <Text style={{ color: t.text, fontSize: 14, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

function JobCard({ job }: { job: CrewJobCardDto }) {
  const t = useTheme();
  const { user } = useSession();
  const foreman = isForeman(user?.role);
  const router = useRouter();
  const start = startLabel(job.startMinutes);
  const pmPhone = dialable(job.pm?.phone ?? null);
  const address = [job.street, job.city].filter(Boolean).join(", ");
  const open = job.tasks.filter((x) => x.status !== "COMPLETED" && x.status !== "CANCELLED");
  return (
    <Card>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open ${job.street}`} onPress={() => router.push({ pathname: "/job/[id]", params: { id: job.jobId } })}>
        <Text style={[s.h2, { color: t.text }]}>{job.street}</Text>
        <Text style={{ color: t.muted, fontSize: 15 }}>
          {[start ? `Start ${start}` : null, job.pm ? `PM: ${job.pm.name}` : null].filter(Boolean).join(" · ") || job.title}
        </Text>
        {job.installToday ? <Text style={{ color: t.brandFg, fontSize: 14, fontWeight: "600", marginTop: 2 }}>Crew install day</Text> : null}
      </Pressable>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Button label="Directions" disabled={!address} onPress={() => void Linking.openURL(mapsUrl(address, Platform.OS === "android" ? "android" : "ios"))} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Call PM" kind="secondary" disabled={!pmPhone} onPress={() => pmPhone && void Linking.openURL(`tel:${pmPhone}`)} />
        </View>
      </View>
      {open.length ? (
        <View style={{ gap: 2 }}>
          <Text style={[s.label, { color: t.muted }]}>Your work here · {open.length}</Text>
          {open.slice(0, 5).map((x) => (
            <Pressable
              key={x.id}
              accessibilityRole="button"
              accessibilityLabel={`${x.title}${x.priority === "URGENT" || x.priority === "HIGH" ? `, ${x.priority.toLowerCase()} priority` : ""}`}
              onPress={() => router.push({ pathname: "/task/[id]", params: { id: x.id } })}
              style={{ minHeight: TOUCH - 4, flexDirection: "row", alignItems: "center", gap: 8 }}
            >
              <Ionicons name={x.status === "BLOCKED" ? "pause-circle-outline" : "ellipse-outline"} size={20} color={x.status === "BLOCKED" ? t.warn : t.muted} />
              <Text style={[s.body, { color: t.text, flex: 1 }]} numberOfLines={2}>
                {x.title}
              </Text>
              {x.priority === "URGENT" || x.priority === "HIGH" ? <StatusBadge kind="priority" value={x.priority} /> : null}
            </Pressable>
          ))}
          {open.length > 5 ? <Text style={{ color: t.muted, fontSize: 14 }}>and {open.length - 5} more on the job</Text> : null}
        </View>
      ) : (
        <Text style={{ color: t.muted, fontSize: 15 }}>No open tasks for you here.</Text>
      )}
      {foreman ? (
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={{ color: t.muted, fontSize: 14 }}>Today's log</Text>
          {job.logStatus === "NONE" ? <Text style={{ color: t.muted, fontSize: 14, fontWeight: "600" }}>not started</Text> : <StatusBadge kind="dailyLog" value={job.logStatus} />}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Open today's log" onPress={() => router.push({ pathname: "/log/[jobId]", params: { jobId: job.jobId } })} style={{ minHeight: TOUCH - 8, justifyContent: "center" }}>
          <Text style={{ color: t.brand, fontSize: 15, fontWeight: "600" }}>Open log</Text>
        </Pressable>
      </View>
      ) : null}
      {job.openIssues > 0 ? <Text style={{ color: t.warn, fontSize: 14 }}>{job.openIssues} open problem{job.openIssues === 1 ? "" : "s"} on this job</Text> : null}
    </Card>
  );
}
