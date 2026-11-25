import { useState } from "react";
import { ActionSheetIOS, Alert, Image, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { api } from "@/api/client";
import { q } from "@/api/queries";
import { clientId } from "@/lib/ids";
import { areaFindings, DISMISS_TEXT, KIND_TEXT, SEVERITY_TEXT, severityTone, VERDICT_TEXT, type Finding } from "@/lib/inspector";
import { preparePhoto } from "@/photos/prepare";
import { useOutbox } from "@/outbox/useOutbox";
import { AuthImage } from "@/ui/AuthImage";
import { Button, Card, Notice, s } from "@/ui/components";
import { useTheme } from "@/ui/theme";

const REASONS = ["false_positive", "not_this_contractor", "out_of_scope", "duplicate", "other"] as const;

/**
 * One room or area: take photos (each is queued the moment it is taken, so
 * the next shot never waits), see what the AI made of them, and — for the
 * office or the job's PM — confirm, dismiss or mark fixed right there.
 */
export default function InspectionArea() {
  const t = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { id, areaId, name } = useLocalSearchParams<{ id: string; areaId: string; name?: string }>();
  const outbox = useOutbox();
  const queued = outbox.forTarget(`insp:${id}`);
  const unsent = queued.some((o) => o.kind === "inspection.create");
  const insp = useQuery({
    ...q.qualityInspection(id),
    enabled: !unsent,
    retry: false,
    refetchInterval: (query) => {
      const d = query.state.data;
      return d && d.photos.some((p) => p.areaId === areaId && (p.state === "waiting" || p.state === "analysing")) ? 3000 : false;
    },
  });
  const [busy, setBusy] = useState(false);
  const d = insp.data;
  const area = d?.areas.find((a) => a.id === areaId);
  const photos = d?.photos.filter((p) => p.areaId === areaId) ?? [];
  const onPhone = queued.filter((o) => o.kind === "file.upload" && (o.body as { fields?: Record<string, string> }).fields?.qualityAreaId === areaId);
  const findings = d ? areaFindings(d.findings, areaId) : [];
  const failed = d?.failedAnalyses.filter((f) => f.areaId === areaId) ?? [];
  const analysing = photos.filter((p) => p.state === "waiting" || p.state === "analysing").length;
  const canShoot = d ? d.rights.canAddPhotos : true;

  const queue = async (assets: ImagePicker.ImagePickerAsset[]) => {
    for (const asset of assets) {
      const p = await preparePhoto(asset);
      const fields: Record<string, string> = { category: "PHOTOS", qualityInspectionId: id, qualityAreaId: areaId };
      if (p.takenAt) fields.takenAt = p.takenAt;
      await outbox.enqueue({ kind: "file.upload", targetId: `insp:${id}`, method: "POST", path: "/api/files", body: { filePath: p.path, fields }, label: `Inspection photo · ${name ?? "area"}` });
    }
  };

  const shoot = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return Alert.alert("Camera is off for KNU Field", "Turn it on in Settings → KNU Field → Camera.");
    setBusy(true);
    try {
      // keep shooting: each photo is queued, then the camera opens again until cancelled
      for (;;) {
        const r = await ImagePicker.launchCameraAsync({ mediaTypes: "images", exif: true, quality: 1 });
        if (r.canceled) break;
        await queue(r.assets);
      }
    } finally {
      setBusy(false);
    }
  };
  const pick = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: "images", allowsMultipleSelection: true, selectionLimit: 12, exif: true, quality: 1 });
    if (!r.canceled) {
      setBusy(true);
      await queue(r.assets).finally(() => setBusy(false));
    }
  };

  const review = (f: Finding, body: { op: "confirm" | "dismiss" | "resolve"; dismissReason?: string }, words: string) =>
    outbox.enqueue({ kind: "finding.review", targetId: `insp:${id}`, method: "PATCH", path: `/api/quality-findings/${f.id}`, body, label: `${words} · ${f.title}` });
  const dismiss = (f: Finding) => {
    const labels = REASONS.map((r) => DISMISS_TEXT[r]);
    if (Platform.OS === "ios")
      ActionSheetIOS.showActionSheetWithOptions({ title: "Why dismiss it?", options: [...labels, "Cancel"], cancelButtonIndex: labels.length }, (i) => {
        if (i < labels.length) void review(f, { op: "dismiss", dismissReason: REASONS[i] }, "Dismiss");
      });
    else Alert.alert("Why dismiss it?", undefined, [...REASONS.slice(0, 2).map((r) => ({ text: DISMISS_TEXT[r], onPress: () => void review(f, { op: "dismiss", dismissReason: r }, "Dismiss") })), { text: "Cancel", style: "cancel" as const }]);
  };
  const closer = useMutation({
    mutationFn: (mode: "closer" | "retry") => api(`/api/quality-inspections/${id}/analyze`, { method: "POST", body: { areaId, mode } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["qualityInspection"] }),
    onError: (e) => Alert.alert("Couldn't ask again", e instanceof Error ? e.message : String(e)),
  });
  // a review waiting in the outbox shows as done here
  const pendingReview = (f: Finding) => queued.find((o) => o.kind === "finding.review" && o.path.endsWith(`/${f.id}`))?.label.split(" · ")[0] ?? null;

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={s.scroll}>
      <Stack.Screen options={{ title: name ?? area?.name ?? "Area" }} />
      {canShoot && d?.status !== "ACCEPTED" ? (
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button label="Take photos" busy={busy} onPress={() => void shoot()} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="From library" kind="secondary" onPress={() => void pick()} />
          </View>
        </View>
      ) : null}
      {photos.length || onPhone.length ? (
        <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>
          {onPhone.map((o) => (
            <View key={o.id}>
              <Image source={{ uri: (o.body as { filePath: string }).filePath }} style={{ width: 84, height: 84, borderRadius: 8, opacity: 0.6 }} accessibilityIgnoresInvertColors />
              <Text style={{ position: "absolute", bottom: 4, left: 4, color: "#fff", fontSize: 11 }}>On phone</Text>
            </View>
          ))}
          {photos.map((p) => (
            <Pressable key={p.id} accessibilityRole="button" accessibilityLabel="Open this photo" onPress={() => router.push({ pathname: "/inspect/finding", params: { id, photoId: p.id } })}>
              <AuthImage path={p.url} style={{ width: 84, height: 84, borderRadius: 8 }} />
              {p.state !== "done" ? <Text style={{ position: "absolute", bottom: 4, left: 4, color: "#fff", fontSize: 11, backgroundColor: "rgba(0,0,0,0.6)", paddingHorizontal: 3 }}>{p.state === "failed" ? "Not read" : "Analysing"}</Text> : null}
            </Pressable>
          ))}
        </ScrollView>
      ) : (
        <Text style={{ color: t.muted }}>Take a few photos of the work in this room: one wide, then close-ups of anything that matters.</Text>
      )}
      {onPhone.length ? <Text style={{ color: t.muted, fontSize: 13 }}>{onPhone.length} photo{onPhone.length === 1 ? "" : "s"} waiting to send. Keep going.</Text> : null}
      {analysing ? <Notice text={`The AI is looking at ${analysing} photo${analysing === 1 ? "" : "s"}…`} /> : null}
      {failed.map((f) => <Notice key={f.id} tone="danger" text={f.error ?? "These photos could not be read."} />)}
      {failed.length ? <Button label="Try again" kind="secondary" onPress={() => closer.mutate("retry")} /> : null}

      {area?.verdict && d?.rights.canSeeProposed ? (
        <Card>
          <Text style={[s.label, { color: t.muted }]}>{VERDICT_TEXT[area.verdict] ?? area.verdict}</Text>
          {area.summary ? <Text style={{ color: t.text }}>{area.summary}</Text> : null}
          {area.photosNeeded.length ? (
            <View style={{ gap: 2, marginTop: 6 }}>
              <Text style={{ color: t.tones.warning.fg, fontWeight: "600" }}>Take these photos</Text>
              {area.photosNeeded.map((p) => <Text key={p} style={{ color: t.text }}>• {p}</Text>)}
            </View>
          ) : null}
        </Card>
      ) : null}

      {findings.map((f) => {
        const tone = t.tones[severityTone(f.severity)];
        const waiting = pendingReview(f);
        return (
          <Card key={f.id} style={{ opacity: f.review === "DISMISSED" || f.resolved ? 0.55 : 1 }}>
            <Pressable accessibilityRole="button" onPress={() => f.photoId && router.push({ pathname: "/inspect/finding", params: { id, photoId: f.photoId, findingId: f.id } })}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                <Text style={{ backgroundColor: tone.soft, color: tone.fg, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, fontWeight: "600", overflow: "hidden" }}>{SEVERITY_TEXT[f.severity]}</Text>
                <Text style={{ color: t.muted, fontSize: 13 }}>
                  {KIND_TEXT[f.kind] ?? f.kind}
                  {f.review === "PROPOSED" ? " · AI proposed" : f.review === "CONFIRMED" ? " · Confirmed" : " · Dismissed"}
                  {f.resolved ? " · Fixed" : ""}
                  {f.punch ? " · On the punch list" : ""}
                </Text>
              </View>
              <Text style={[s.body, { color: t.text, fontWeight: "600", marginTop: 4 }]}>{f.title}</Text>
              <Text style={{ color: t.muted }}>{f.evidence}</Text>
              {f.action ? <Text style={{ color: t.text, marginTop: 4 }}>Fix: {f.action}</Text> : null}
              {f.physicalCheck ? <Text style={{ color: t.text, marginTop: 4 }}>Check in person: {f.physicalCheck}</Text> : null}
            </Pressable>
            {waiting ? <Text style={{ color: t.muted, fontSize: 13, marginTop: 6 }}>{waiting} — waiting to send</Text> : null}
            {d?.rights.canReview && !waiting ? (
              <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                {f.review === "PROPOSED" ? (
                  <>
                    <View style={{ flex: 1 }}><Button label="Confirm" onPress={() => void review(f, { op: "confirm" }, "Confirm")} /></View>
                    <View style={{ flex: 1 }}><Button label="Dismiss" kind="secondary" onPress={() => dismiss(f)} /></View>
                  </>
                ) : null}
                {f.review === "CONFIRMED" && !f.resolved ? <View style={{ flex: 1 }}><Button label="Fixed now" kind="secondary" onPress={() => void review(f, { op: "resolve" }, "Fixed")} /></View> : null}
              </View>
            ) : null}
          </Card>
        );
      })}
      {d?.rights.canSeeProposed && photos.length && d.status === "OPEN" ? (
        <Button label="Have a closer look (slower, more careful)" kind="secondary" busy={closer.isPending} onPress={() => closer.mutate("closer")} />
      ) : null}
      {d && !d.rights.canSeeProposed ? <Text style={{ color: t.muted, fontSize: 13 }}>The office reviews what the AI finds; confirmed items show here.</Text> : null}
    </ScrollView>
  );
}
