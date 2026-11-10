import { useState } from "react";
import { Alert, FlatList, Image, Linking, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import Ionicons from "@expo/vector-icons/Ionicons";
import { createFieldIssueRequest } from "@crm/mobile-api";
import { useJob, useMyJobs } from "@/api/queries";
import { addressLine, dialable } from "@/lib/format";
import { clientId } from "@/lib/ids";
import { PROBLEMS, problemIssue, type ProblemKind } from "@/lib/crew";
import { preparePhoto } from "@/photos/prepare";
import { useOutbox } from "@/outbox/useOutbox";
import { Button, Card, Notice, s } from "@/ui/components";
import { Loading } from "@/ui/states";
import { TOUCH, useTheme } from "@/ui/theme";

type Shot = { key: string; asset: ImagePicker.ImagePickerAsset };

/**
 * Report a problem from the site, the crew way: what kind, a photo, a few
 * words (say them with the keyboard's microphone), urgent or not. It becomes
 * a field issue with a task for the job's PM (materials go to purchasing).
 * Queued like every field change, so it works without signal. Safety first
 * says to call 911 if anyone is hurt: an app message is not an emergency call.
 */
export default function Problem() {
  const t = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ jobId?: string }>();
  const outbox = useOutbox();
  const jobs = useMyJobs();
  const [jobId, setJobId] = useState(params.jobId ?? "");
  const job = useJob(jobId);
  const [kind, setKind] = useState<ProblemKind | null>(null);
  const [note, setNote] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [shots, setShots] = useState<Shot[]>([]);
  const [saving, setSaving] = useState(false);

  const add = (assets: ImagePicker.ImagePickerAsset[]) => setShots((cur) => [...cur, ...assets.map((asset) => ({ key: `${asset.uri}-${Math.random()}`, asset }))]);
  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return Alert.alert("Camera is off for KNU Field", "Turn it on in Settings → KNU Field → Camera.");
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: "images", exif: true, quality: 1 });
    if (!r.canceled) add(r.assets);
  };

  const send = async () => {
    if (!kind) return;
    const id = clientId();
    const issue = problemIssue(kind, note, urgent);
    const body = createFieldIssueRequest.safeParse({ id, ...issue });
    if (!body.success) return Alert.alert("Check the problem", body.error.issues[0]?.message ?? "Something is missing");
    setSaving(true);
    try {
      const target = `issue:${id}`;
      await outbox.enqueue({ kind: "issue.create", targetId: target, method: "POST", path: `/api/jobs/${jobId}/field-issues`, body: body.data, label: `Problem · ${body.data.title}` });
      for (const shot of shots) {
        const p = await preparePhoto(shot.asset);
        const fields: Record<string, string> = { fieldIssueId: id, category: "PHOTOS" };
        if (p.takenAt) fields.takenAt = p.takenAt;
        await outbox.enqueue({ kind: "file.upload", targetId: target, method: "POST", path: "/api/files", body: { filePath: p.path, fields }, label: `Photo · ${body.data.title}` });
      }
      Alert.alert("Sent", "The PM has it. It sends by itself if there's no signal right now.");
      router.back();
    } catch (e) {
      Alert.alert("Couldn't send it", e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (!jobId) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <Stack.Screen options={{ title: "Problem on which job?" }} />
        {jobs.isPending ? (
          <Loading />
        ) : (
          <FlatList
            data={jobs.data?.data ?? []}
            keyExtractor={(j) => j.id}
            contentContainerStyle={{ padding: 16, gap: 8 }}
            ListEmptyComponent={<Notice text="You have no open jobs." />}
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={addressLine(item.lead) ?? item.title}
                onPress={() => setJobId(item.id)}
                style={{ minHeight: TOUCH + 8, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, justifyContent: "center" }}
              >
                <Text style={[s.body, { color: t.text, fontWeight: "600" }]}>{addressLine(item.lead) ?? item.title}</Text>
              </Pressable>
            )}
          />
        )}
      </View>
    );
  }

  const pmPhone = dialable(job.data?.projectManager?.phone ?? null);

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={[s.scroll, { gap: 14 }]} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: "Report a problem" }} />
      {job.data ? <Text style={{ color: t.muted, fontSize: 15 }}>{addressLine(job.data.lead) ?? job.data.title}</Text> : null}

      <Text style={[s.h2, { color: t.text }]} accessibilityRole="header">What's wrong?</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {PROBLEMS.map((p) => {
          const on = kind === p.kind;
          return (
            <Pressable
              key={p.kind}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={p.label}
              onPress={() => setKind(p.kind)}
              style={{ minHeight: TOUCH, width: "48%", flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, borderRadius: 12, borderWidth: on ? 2 : 1, borderColor: on ? t.brand : t.border, backgroundColor: on ? t.brandSoft : t.card }}
            >
              <Ionicons name={p.icon as keyof typeof Ionicons.glyphMap} size={22} color={p.kind === "safety" ? t.danger : t.brand} />
              <Text style={{ color: t.text, fontSize: 15, fontWeight: "600", flexShrink: 1 }}>{p.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {kind === "safety" ? (
        <Card style={{ borderColor: t.danger, borderWidth: 2 }}>
          <Text style={[s.h2, { color: t.danger }]} accessibilityRole="header">If anyone is hurt or in danger, call 911 now.</Text>
          <Text style={[s.body, { color: t.text }]}>Then tell the PM. This report reaches the office, but it is not an emergency call.</Text>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Button label="Call 911" onPress={() => void Linking.openURL("tel:911")} />
            </View>
            {pmPhone ? (
              <View style={{ flex: 1 }}>
                <Button label="Call PM" kind="secondary" onPress={() => void Linking.openURL(`tel:${pmPhone}`)} />
              </View>
            ) : null}
          </View>
        </Card>
      ) : null}

      {kind ? (
        <>
          <Button label={shots.length ? `Photo · ${shots.length} taken` : "Take a photo"} kind="secondary" onPress={() => void takePhoto()} />
          {shots.length ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {shots.map((x) => (
                <Pressable key={x.key} accessibilityRole="button" accessibilityLabel="Remove photo" onPress={() => setShots((cur) => cur.filter((y) => y.key !== x.key))}>
                  <Image source={{ uri: x.asset.uri }} style={{ width: 64, height: 64, borderRadius: 8 }} />
                </Pressable>
              ))}
            </View>
          ) : null}
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="What happened? Tap the microphone on the keyboard to speak it."
            placeholderTextColor={t.muted}
            accessibilityLabel="What happened"
            multiline
            style={{ minHeight: 96, borderRadius: 10, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, color: t.text, padding: 12, fontSize: 16, textAlignVertical: "top" }}
          />
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: TOUCH }}>
            <Text style={[s.body, { color: t.text, flex: 1 }]}>Urgent: needs the PM today</Text>
            <Switch accessibilityLabel="Urgent" value={urgent} onValueChange={setUrgent} />
          </View>
          <Button label={saving ? "Sending…" : "Send to the PM"} disabled={saving} onPress={() => void send()} />
        </>
      ) : null}
    </ScrollView>
  );
}
