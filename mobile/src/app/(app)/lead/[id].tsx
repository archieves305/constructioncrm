import { useState } from "react";
import { Alert, Linking, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { logContactRequest, phoneLead } from "@crm/mobile-api";
import { api, ApiError } from "@/api/client";
import { useOnline } from "@/cache/net";
import { addDays, dayKey, dialable, mapsUrl, shortDate } from "@/lib/format";
import { FOLLOW_UP_CHOICES, followUpLine } from "@/lib/leads";
import { useOutbox } from "@/outbox/useOutbox";
import { preparePhoto } from "@/photos/prepare";
import { track } from "@/usage/track";
import { AuthImage } from "@/ui/AuthImage";
import { Chips } from "@/ui/Chips";
import { Button, Card, Notice, s } from "@/ui/components";
import { NotesSection } from "@/ui/NotesSection";
import { PickSheet } from "@/ui/PickSheet";
import { LoadError, Loading } from "@/ui/states";
import { TOUCH, useTheme } from "@/ui/theme";
import { Platform } from "react-native";

const TYPE = { CALL: "Call", SMS: "Text", EMAIL: "Email" } as const;

/**
 * One lead on the phone: call or text, then log what happened (queued, so it
 * works without signal) and pick the next follow-up; move the stage (Won is
 * chosen at the desk, where the estimate is picked); site photos and notes.
 */
export default function LeadScreen() {
  const t = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const online = useOnline();
  const outbox = useOutbox();
  const { id } = useLocalSearchParams<{ id: string }>();
  const lead = useQuery({ queryKey: ["lead", id], queryFn: () => api(`/api/mobile/leads/${encodeURIComponent(id)}`, { schema: phoneLead }) });
  const [logging, setLogging] = useState<null | "CALL" | "SMS" | "EMAIL">(null);
  const [what, setWhat] = useState("");
  const [direction, setDirection] = useState<"OUTBOUND" | "INBOUND">("OUTBOUND");
  const [follow, setFollow] = useState<(typeof FOLLOW_UP_CHOICES)[number]["key"]>("3");
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  if (lead.isPending) return <Loading />;
  if (lead.isError || !lead.data) return <LoadError error={lead.error} onRetry={() => lead.refetch()} />;
  const l = lead.data;
  const tel = dialable(l.phone);
  const due = followUpLine(l.nextFollowUpAt, l.lastContactAt);
  const target = `lead:${l.id}`;

  const startCall = (kind: "CALL" | "SMS") => {
    if (!tel) return;
    track(kind === "CALL" ? "lead_called" : "lead_texted");
    void Linking.openURL(`${kind === "CALL" ? "tel" : "sms"}:${tel}`);
    // Back from the call: the log is ready to fill in.
    setLogging(kind);
    setDirection("OUTBOUND");
  };

  const saveLog = async () => {
    if (!logging) return;
    const body = logContactRequest.safeParse({ communicationType: logging, direction, body: what.trim() });
    if (!body.success) return Alert.alert("Say what happened", "A line is enough, e.g. “Left a voicemail”.");
    setBusy(true);
    try {
      await outbox.enqueue({ kind: "lead.contact", targetId: target, method: "POST", path: `/api/leads/${l.id}/communications`, body: body.data, label: `${TYPE[logging]} logged · ${l.name}` });
      const choice = FOLLOW_UP_CHOICES.find((c) => c.key === follow);
      if (choice?.days) {
        // Noon in the office on that day.
        const at = `${addDays(dayKey(), choice.days)}T16:00:00.000Z`;
        await outbox.enqueue({ kind: "lead.update", targetId: target, method: "PATCH", path: `/api/leads/${l.id}`, body: { nextFollowUpAt: at }, label: `Follow-up ${choice.label.toLowerCase()} · ${l.name}` });
      }
      setLogging(null);
      setWhat("");
    } finally {
      setBusy(false);
    }
  };

  const moveTo = async (stageId: string) => {
    setPicking(false);
    const stage = l.stages.find((x) => x.id === stageId);
    if (!stage || stage.id === l.stageId) return;
    const send = async (reason?: string) => {
      try {
        await api(`/api/leads/${l.id}/stage`, { method: "POST", body: reason ? { stageId, reason } : { stageId } });
        await qc.invalidateQueries({ queryKey: ["lead", id] });
        void qc.invalidateQueries({ queryKey: ["leads"] });
      } catch (e) {
        Alert.alert("Not moved", e instanceof ApiError ? e.message : String(e));
      }
    };
    if (stage.isLost) {
      Alert.prompt?.("Mark as lost", "Why? (kept on the lead)", (reason) => void send(reason?.trim() || undefined)) ?? void send();
    } else void send();
  };

  const addPhotos = async (camera: boolean) => {
    if (camera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return Alert.alert("Camera is off for KNU Field", "Turn it on in Settings → KNU Field → Camera.");
    }
    const r = camera ? await ImagePicker.launchCameraAsync({ mediaTypes: "images", quality: 1 }) : await ImagePicker.launchImageLibraryAsync({ mediaTypes: "images", allowsMultipleSelection: true, selectionLimit: 10, quality: 1 });
    if (r.canceled) return;
    for (const a of r.assets) {
      const p = await preparePhoto(a);
      await outbox.enqueue({ kind: "file.upload", targetId: target, method: "POST", path: "/api/files", body: { filePath: p.path, fields: { leadId: l.id, category: "PHOTOS" } }, label: `Site photo · ${l.street}` });
    }
    track("lead_photo_added");
  };

  const address = [l.street, l.cityLine].filter(Boolean).join(", ");
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets refreshControl={<RefreshControl refreshing={lead.isRefetching} onRefresh={() => void lead.refetch()} tintColor={t.brand} />}>
      <Stack.Screen options={{ title: l.name }} />
      {!online ? <Notice tone="warn" text="No signal. Calls you log and photos are saved and sent later; the stage moves only with signal." /> : null}
      <View style={{ gap: 2 }}>
        <Text style={[s.h1, { color: t.text }]}>{l.name}</Text>
        <Text style={{ color: t.muted, fontSize: 15 }}>{address}</Text>
        <Text style={{ color: due.late ? t.danger : t.muted, fontSize: 14 }}>
          {l.stage} · {due.text}
          {l.lastContactAt ? ` · last contact ${shortDate(l.lastContactAt)}` : ""}
        </Text>
      </View>

      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button label="Call" disabled={!tel} onPress={() => startCall("CALL")} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Text" kind="secondary" disabled={!tel} onPress={() => startCall("SMS")} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Directions" kind="secondary" onPress={() => void Linking.openURL(mapsUrl(address, Platform.OS === "android" ? "android" : "ios"))} />
        </View>
      </View>

      {logging ? (
        <Card>
          <Text style={[s.h2, { color: t.text }]}>Log the {TYPE[logging].toLowerCase()}</Text>
          <Chips label="Who reached out" value={direction} onChange={setDirection} options={[{ value: "OUTBOUND", label: "I did" }, { value: "INBOUND", label: "They did" }]} />
          <TextInput
            value={what}
            onChangeText={setWhat}
            multiline
            autoFocus
            maxLength={4000}
            placeholder="What happened (e.g. Left a voicemail; wants a quote for the roof)"
            placeholderTextColor={t.muted}
            accessibilityLabel="What happened"
            style={{ minHeight: TOUCH * 1.6, borderRadius: 10, borderWidth: 1, borderColor: t.border, backgroundColor: t.bg, color: t.text, padding: 12, fontSize: 16, textAlignVertical: "top" }}
          />
          <Chips label="Next follow-up" value={follow} onChange={setFollow} options={FOLLOW_UP_CHOICES.map((c) => ({ value: c.key, label: c.label }))} />
          <Button label={busy ? "Saving…" : "Save"} disabled={busy || !what.trim()} onPress={() => void saveLog()} />
          <Button label="Not now" kind="secondary" onPress={() => setLogging(null)} />
        </Card>
      ) : (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button label="Log a call…" kind="secondary" onPress={() => setLogging("CALL")} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label={`Stage: ${l.stage}`} kind="secondary" disabled={!online || l.closed} onPress={() => setPicking(true)} />
          </View>
        </View>
      )}
      {l.jobs.length ? (
        <Button label={`Open ${l.jobs[0].jobNumber}`} kind="secondary" onPress={() => router.push({ pathname: "/job/[id]", params: { id: l.jobs[0].id } })} />
      ) : null}

      <Text style={[s.h2, { color: t.text }]}>Site photos{l.photoIds.length ? ` · ${l.photoIds.length}` : ""}</Text>
      {l.photoIds.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {l.photoIds.map((pid) => (
            <AuthImage key={pid} path={`/api/files/${pid}`} style={{ width: 96, height: 96, borderRadius: 8 }} />
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button label="Take photos" kind="secondary" onPress={() => void addPhotos(true)} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="From library" kind="secondary" onPress={() => void addPhotos(false)} />
        </View>
      </View>

      {l.contacts.length ? <Text style={[s.h2, { color: t.text }]}>Recent contact</Text> : null}
      {l.contacts.map((c) => (
        <Card key={c.id}>
          <Text style={{ color: t.muted, fontSize: 13 }}>
            {TYPE[c.type as keyof typeof TYPE] ?? c.type} · {c.direction === "INBOUND" ? "from them" : "to them"} · {shortDate(c.at)}
            {c.by ? ` · ${c.by}` : ""}
          </Text>
          <Text style={[s.body, { color: t.text }]}>{c.body}</Text>
        </Card>
      ))}

      <NotesSection leadId={l.id} label={l.name} />
      <PickSheet title="Move to" visible={picking} onClose={() => setPicking(false)} onPick={(k) => void moveTo(k)} options={l.stages.map((x) => ({ key: x.id, label: x.name, selected: x.id === l.stageId }))} />
      <Text style={{ color: t.muted, fontSize: 13 }}>Won is marked at the desk, where the estimate is picked.</Text>
    </ScrollView>
  );
}
