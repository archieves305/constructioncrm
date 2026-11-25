import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import { api, ApiError } from "@/api/client";
import { q } from "@/api/queries";
import { clientId } from "@/lib/ids";
import { areaLine } from "@/lib/inspector";
import { useOutbox } from "@/outbox/useOutbox";
import { Button, Card, Notice, s } from "@/ui/components";
import { Loading } from "@/ui/states";
import { TOUCH, useTheme } from "@/ui/theme";

const COMMON_AREAS = ["Kitchen", "Bathroom", "Bedroom", "Living room", "Laundry", "Hallway", "Front exterior", "Rear exterior", "Roof", "Garage"];

/**
 * The walk: the inspection's rooms and areas, what the AI has said about
 * each, and — for the office or the job's PM — punch items and acceptance.
 * Rooms and photos added without signal show at once from the outbox.
 */
export default function InspectionWalk() {
  const t = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { id, label, jobId } = useLocalSearchParams<{ id: string; label?: string; jobId?: string }>();
  const outbox = useOutbox();
  const queued = outbox.forTarget(`insp:${id}`);
  const unsent = queued.some((o) => o.kind === "inspection.create");
  const insp = useQuery({
    ...q.qualityInspection(id),
    enabled: !unsent,
    retry: false,
    refetchInterval: (query) => {
      const d = query.state.data;
      return d && (d.pendingAnalyses > 0 || d.photos.some((p) => p.state === "waiting" || p.state === "analysing")) ? 4000 : false;
    },
  });
  const options = useQuery({ ...q.qualityOptions(jobId || undefined), enabled: Boolean(jobId), retry: false });
  const [name, setName] = useState("");

  // the rooms the CRM has, plus the ones still on this phone
  const areas = useMemo(() => {
    const server = insp.data?.areas ?? [];
    const pending = queued
      .filter((o) => o.kind === "inspection.area")
      .map((o) => o.body as { id: string; name: string })
      .filter((b) => !server.some((a) => a.id === b.id));
    return [
      ...server.map((a) => ({ id: a.id, name: a.name, line: areaLine(a, insp.data!.photos, insp.data!.findings), warn: a.verdict === "cannot_tell" || a.openFindings > 0 })),
      ...pending.map((b) => ({ id: b.id, name: b.name, line: "Saved on this phone", warn: false })),
    ];
  }, [insp.data, queued]);
  const queuedPhotos = (areaId: string) => queued.filter((o) => o.kind === "file.upload" && (o.body as { fields?: Record<string, string> }).fields?.qualityAreaId === areaId).length;

  const addArea = async (areaName: string) => {
    const n = areaName.trim();
    if (!n) return;
    if (areas.some((a) => a.name.toLowerCase() === n.toLowerCase())) return Alert.alert("Already there", `${n} is already on the list.`);
    const areaId = clientId();
    await outbox.enqueue({ kind: "inspection.area", targetId: `insp:${id}`, method: "POST", path: `/api/quality-inspections/${id}/areas`, body: { id: areaId, name: n }, label: `Area · ${n}` });
    setName("");
    router.push({ pathname: "/inspect/area", params: { id, areaId, name: n } });
  };

  const punch = useMutation({
    mutationFn: () => api(`/api/quality-inspections/${id}/punch`, { method: "POST", body: {}, idempotencyKey: clientId() }) as Promise<{ created: number }>,
    onSuccess: (r) => {
      Alert.alert("Punch items raised", `${r.created} added to the job's punch list.`);
      void qc.invalidateQueries({ queryKey: ["qualityInspection"] });
    },
    onError: (e) => Alert.alert("Couldn't raise them", e instanceof Error ? e.message : String(e)),
  });
  const accept = useMutation({
    mutationFn: (override: string | null) => api(`/api/quality-inspections/${id}/accept`, { method: "POST", body: { override } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["qualityInspection"] }),
    onError: (e) => Alert.alert("Not accepted", e instanceof Error ? e.message : String(e)),
  });

  const d = insp.data;
  const title = d?.job?.label ?? d?.addressText ?? label ?? "Inspection";
  if (!unsent && insp.isPending) return <Loading />;
  const offline = insp.error instanceof ApiError && insp.error.offline;

  const onAccept = () => {
    if (!d) return;
    if (d.blockers.overridable.length) {
      if (!d.rights.canOverride) return Alert.alert("Still open", `${d.blockers.overridable.join(" ")}\n\nFix them, or ask an admin or manager to accept.`);
      Alert.prompt?.("Accept with open items?", `${d.blockers.overridable.join(" ")}\n\nSay why.`, (reason) => reason?.trim() && accept.mutate(reason.trim()));
      return;
    }
    Alert.alert("Accept the work?", "Everything is reviewed and fixed.", [{ text: "Cancel", style: "cancel" }, { text: "Accept", onPress: () => accept.mutate(null) }]);
  };

  const unpunched = d ? d.findings.filter((f) => f.review === "CONFIRMED" && !f.punch && !f.resolved).length : 0;
  const toReview = d ? d.findings.filter((f) => f.review === "PROPOSED").length : 0;

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: d?.number ?? "Inspection" }} />
      <Card>
        <Text style={[s.body, { color: t.text, fontWeight: "600" }]}>{title}</Text>
        <Text style={{ color: t.muted, fontSize: 13 }}>
          {[d?.kindLabel, d?.laborContract?.name, d?.phaseLabel].filter(Boolean).join(" · ") || "Saved on this phone; it reaches the CRM when there is signal."}
        </Text>
      </Card>
      {offline ? <Notice tone="warn" text="No signal. Photos you take are kept on this phone and sent later." /> : null}
      {d?.status === "ACCEPTED" ? <Notice text="This inspection is accepted." /> : null}
      {toReview && d?.rights.canSeeProposed ? <Notice tone="warn" text={`${toReview} finding${toReview === 1 ? "" : "s"} to look at — open a room.`} /> : null}

      <Text style={[s.label, { color: t.muted }]}>Rooms and areas</Text>
      {areas.length === 0 ? <Text style={{ color: t.muted }}>Add the first room you are standing in.</Text> : null}
      {areas.map((a) => {
        const waiting = queuedPhotos(a.id);
        return (
          <Pressable
            key={a.id}
            accessibilityRole="button"
            onPress={() => router.push({ pathname: "/inspect/area", params: { id, areaId: a.id, name: a.name } })}
            style={{ minHeight: TOUCH + 8, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: a.warn ? t.tones.warning.dot : t.border, backgroundColor: t.card, flexDirection: "row", alignItems: "center", gap: 10 }}
          >
            <View style={{ flex: 1 }}>
              <Text style={[s.body, { color: t.text, fontWeight: "600" }]}>{a.name}</Text>
              <Text style={{ color: a.warn ? t.tones.warning.fg : t.muted, fontSize: 13 }}>
                {a.line}
                {waiting ? ` · ${waiting} on this phone` : ""}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={t.muted} />
          </Pressable>
        );
      })}

      {d?.rights.canAddPhotos !== false && d?.status !== "ACCEPTED" ? (
        <Card>
          <Text style={[s.label, { color: t.muted }]}>Add a room</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {[...new Set([...(options.data?.areas.map((x) => x.name) ?? []), ...COMMON_AREAS])]
              .filter((n) => !areas.some((a) => a.name.toLowerCase() === n.toLowerCase()))
              .slice(0, 12)
              .map((n) => (
                <Pressable key={n} accessibilityRole="button" onPress={() => void addArea(n)} style={{ minHeight: 40, paddingHorizontal: 12, borderRadius: 20, borderWidth: 1, borderColor: t.border, justifyContent: "center" }}>
                  <Text style={{ color: t.text }}>+ {n}</Text>
                </Pressable>
              ))}
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TextInput
              accessibilityLabel="Another room or area"
              value={name}
              onChangeText={setName}
              placeholder="Other (Bath 2, Unit B kitchen…)"
              placeholderTextColor={t.muted}
              onSubmitEditing={() => void addArea(name)}
              style={[s.body, { flex: 1, color: t.text, minHeight: TOUCH, borderWidth: 1, borderColor: t.border, borderRadius: 10, paddingHorizontal: 12 }]}
            />
            <Button label="Add" kind="secondary" onPress={() => void addArea(name)} />
          </View>
        </Card>
      ) : null}

      {d?.rights.canReview && d.status === "OPEN" ? (
        <Card>
          <Text style={[s.label, { color: t.muted }]}>Finish</Text>
          {[...d.blockers.hard, ...d.blockers.overridable].map((b) => (
            <Text key={b} style={{ color: t.text }}>• {b}</Text>
          ))}
          {unpunched ? <Button label={`Raise ${unpunched} punch item${unpunched === 1 ? "" : "s"}`} kind="secondary" busy={punch.isPending} disabled={!d.job} onPress={() => punch.mutate()} /> : null}
          {unpunched && !d.job ? <Text style={{ color: t.muted, fontSize: 13 }}>Attach this inspection to a job on the web to raise punch items.</Text> : null}
          <Button label="Accept the work" busy={accept.isPending} disabled={d.blockers.hard.length > 0} onPress={onAccept} />
        </Card>
      ) : null}
    </ScrollView>
  );
}
