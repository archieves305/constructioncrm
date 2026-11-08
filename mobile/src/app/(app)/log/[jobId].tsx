import { useEffect, useMemo, useRef, useState } from "react";
import { track } from "@/usage/track";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import Ionicons from "@expo/vector-icons/Ionicons";
import { LOG_SAFETY_CHECKS, LOG_TEXT_FIELDS, logDraft, saveDailyLogRequest, type LogDraftDto } from "@crm/mobile-api";
import { api, ApiError } from "@/api/client";
import { useOnline } from "@/cache/net";
import { mergeLogDraft } from "@/lib/voice";
import { useDailyLog, useJob } from "@/api/queries";
import { addressLine, dayKey } from "@/lib/format";
import { clearDraft, readDraft, writeDraft } from "@/lib/drafts";
import { clientId } from "@/lib/ids";
import { preparePhoto } from "@/photos/prepare";
import { useOutbox } from "@/outbox/useOutbox";
import { Button, Card, Notice, s } from "@/ui/components";
import { OpRow } from "@/ui/OpRow";
import { LoadError, Loading } from "@/ui/states";
import { TOUCH, useTheme } from "@/ui/theme";

type TextKey = (typeof LOG_TEXT_FIELDS)[number];
type CheckKey = (typeof LOG_SAFETY_CHECKS)[number];
type Draft = Partial<Record<TextKey, string>> & Partial<Record<CheckKey, boolean>>;

const LABEL: Record<TextKey, { title: string; hint: string; tall?: boolean }> = {
  workPerformed: { title: "Work performed", hint: "What got done today", tall: true },
  areasWorked: { title: "Areas worked", hint: "e.g. Unit 2 kitchen, roof south slope" },
  delays: { title: "Delays", hint: "Weather, materials, inspections…" },
  safetyIssues: { title: "Safety issues", hint: "Anything unsafe seen or fixed" },
  materialsDelivered: { title: "Materials delivered", hint: "What arrived, from whom" },
  subcontractorsOnsite: { title: "Subcontractors on site", hint: "Company and trade" },
  tomorrowPlan: { title: "Tomorrow's plan", hint: "What's next" },
  notes: { title: "Notes", hint: "Anything else", tall: true },
};
const CHECK_LABEL: Record<CheckKey, string> = {
  safetyToolboxTalk: "Toolbox talk held",
  safetyPpeVerified: "PPE checked",
  safetyHousekeeping: "Site left clean",
};

function longDay(key: string): string {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
}

/**
 * A job's daily log for one day: the write-up, safety checks and photos.
 * Typing is kept on the phone as a draft; Save queues it (only the latest
 * unsent save is sent, with the copy it was based on, so a web edit made
 * meanwhile is never overwritten silently). Photos and Submit queue behind it.
 */
export default function DailyLogScreen() {
  const t = useTheme();
  useEffect(() => track("daily_log_opened", "log"), []);
  const router = useRouter();
  const { jobId, date: dateParam } = useLocalSearchParams<{ jobId: string; date?: string }>();
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : dayKey();
  const job = useJob(jobId);
  const log = useDailyLog(jobId, date);
  const outbox = useOutbox();
  const target = `log:${jobId}:${date}`;
  const draftKey = target;

  const [draft, setDraft] = useState<Draft>({});
  const online = useOnline();
  const [speaking, setSpeaking] = useState(false);
  const [speech, setSpeech] = useState("");
  const [sorting, setSorting] = useState(false);
  const [spokenInto, setSpokenInto] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const loaded = useRef(false);

  // Start from the server's log, then lay any unsaved typing over it.
  useEffect(() => {
    if (log.isPending || loaded.current) return;
    loaded.current = true;
    void (async () => {
      const server: Draft = {};
      for (const k of LOG_TEXT_FIELDS) server[k] = (log.data?.[k] as string | null | undefined) ?? "";
      for (const k of LOG_SAFETY_CHECKS) server[k] = Boolean(log.data?.[k]);
      // Newest first: unsaved typing, then a save still waiting to send, then the CRM's copy.
      const queued = outbox.ops.filter((o) => o.targetId === target && o.kind === "log.save" && o.state !== "failed").at(-1);
      const saved = await readDraft<Draft>(draftKey);
      setDraft({ ...server, ...((queued?.body as Draft | undefined) ?? {}), ...(saved ?? {}) });
      setDirty(Boolean(saved));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read the queue once, when the screen opens
  }, [log.isPending, log.data, draftKey]);

  // Keep typing on the phone (half a second after the last key).
  useEffect(() => {
    if (!dirty) return;
    const id = setTimeout(() => void writeDraft(draftKey, draft), 500);
    return () => clearTimeout(id);
  }, [draft, dirty, draftKey]);

  const mine = outbox.ops.filter((o) => o.targetId === target);
  const waiting = mine.filter((o) => o.state === "queued");
  const failed = mine.filter((o) => o.state === "failed");
  const submitQueued = waiting.some((o) => o.kind === "log.submit");
  const photosWaiting = waiting.filter((o) => o.kind === "file.upload").length;

  const status = submitQueued ? "SUBMITTED" : log.data?.status ?? "DRAFT";
  const editable = status === "DRAFT";
  const address = addressLine(job.data?.lead);

  const set = (patch: Draft) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  };

  const save = async (): Promise<boolean> => {
    const body = saveDailyLogRequest.safeParse({
      ...Object.fromEntries(LOG_TEXT_FIELDS.map((k) => [k, draft[k] ?? ""])),
      ...Object.fromEntries(LOG_SAFETY_CHECKS.map((k) => [k, Boolean(draft[k])])),
      ...(log.data?.updatedAt ? { baseUpdatedAt: log.data.updatedAt } : {}),
    });
    if (!body.success) {
      Alert.alert("Check the log", body.error.issues[0]?.message ?? "Something is too long");
      return false;
    }
    await outbox.enqueue({
      kind: "log.save",
      targetId: target,
      method: "PUT",
      path: `/api/jobs/${jobId}/daily-logs/${date}`,
      body: body.data,
      label: `Daily log · ${address ?? "job"} · ${date}`,
    });
    await clearDraft(draftKey);
    setDirty(false);
    setSpokenInto([]);
    return true;
  };

  const addPhotos = async (camera: boolean) => {
    if (camera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return Alert.alert("Camera is off for KNU Field", "Turn it on in Settings → KNU Field → Camera.");
    }
    const r = camera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: "images", exif: true, quality: 1 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: "images", allowsMultipleSelection: true, selectionLimit: 20, exif: true, quality: 1 });
    if (r.canceled) return;
    for (const asset of r.assets) {
      const p = await preparePhoto(asset);
      await outbox.enqueue({
        kind: "file.upload",
        targetId: target,
        method: "POST",
        path: `/api/jobs/${jobId}/photos`,
        // id_0: a phone-made id, so a resend never makes a second photo.
        body: { filePath: p.path, fields: { id_0: clientId(), logDate: date, photoDate: date, category: "PROGRESS" } },
        label: `Log photo · ${address ?? "job"} · ${date}`,
      });
    }
  };

  const submit = () =>
    Alert.alert("Submit this log?", "The office reviews it. After submitting, only the office can change it or send it back.", [
      { text: "Not yet", style: "cancel" },
      {
        text: "Submit",
        onPress: async () => {
          if (dirty && !(await save())) return;
          await outbox.enqueue({
            kind: "log.submit",
            targetId: target,
            method: "POST",
            path: `/api/jobs/${jobId}/daily-logs/${date}/submit`,
            body: {},
            label: `Submit daily log · ${address ?? "job"} · ${date}`,
          });
        },
      },
    ]);

  // What was said, sorted by the CRM's AI into the sections: added after what
  // is written, unsaved, for the person to read and Save.
  const sortSpeech = async () => {
    track("voice_draft_used", "log");
    setSorting(true);
    try {
      const d = (await api("/api/mobile/ai/log-draft", { method: "POST", body: { jobId, date, speech: speech.trim() }, schema: logDraft })) as LogDraftDto;
      const { form, changed } = mergeLogDraft(draft, d);
      if (!changed.length) {
        Alert.alert("Nothing new", "Everything you said is already in the log.");
        return;
      }
      setDraft(form);
      setDirty(true);
      setSpokenInto(changed);
      setSpeech("");
      setSpeaking(false);
    } catch (e) {
      Alert.alert("Could not sort it", e instanceof ApiError ? (e.offline ? "No signal. Type into the sections instead." : e.message) : "Try again, or type into the sections.");
    } finally {
      setSorting(false);
    }
  };

  const filled = useMemo(() => LOG_TEXT_FIELDS.filter((k) => (draft[k] ?? "").trim()).length, [draft]);

  if (log.isPending || job.isPending) return <Loading />;
  if ((log.isError && log.data === undefined))
    return (
      <View style={{ padding: 16, flex: 1, backgroundColor: t.bg }}>
        <LoadError error={log.error} onRetry={() => log.refetch()} />
      </View>
    );

  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={s.scroll}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      keyboardDismissMode="on-drag"
    >
      <Stack.Screen options={{ title: "Daily log" }} />
      <View>
        {address ? <Text style={{ color: t.muted, fontSize: 15 }}>{address}</Text> : null}
        <Text style={[s.h1, { color: t.text, fontSize: 24 }]}>{longDay(date)}</Text>
        <Text style={{ color: status === "APPROVED" ? t.ok : status === "SUBMITTED" ? t.brand : t.muted, fontSize: 14, fontWeight: "600" }}>
          {status === "APPROVED" ? "Approved" : status === "SUBMITTED" ? (submitQueued ? "Submitted · sending" : "Submitted") : log.data ? "Draft" : "Not started"}
          {dirty ? " · unsaved changes on this phone" : waiting.some((o) => o.kind === "log.save") ? " · saving" : ""}
          {photosWaiting ? ` · ${photosWaiting} photo${photosWaiting === 1 ? "" : "s"} waiting` : ""}
        </Text>
      </View>

      {log.data?.returnNote && status === "DRAFT" ? <Notice tone="warn" text={`Sent back by the office: ${log.data.returnNote}`} /> : null}
      {!editable ? (
        <Notice text={status === "APPROVED" ? "This log is approved." : "This log is submitted. Ask the office to send it back if something needs changing."} />
      ) : null}
      {log.data?.weatherSummary ? (
        <Text style={{ color: t.muted, fontSize: 14 }}>
          Weather: {log.data.weatherSummary}
          {log.data.weatherTempHighF != null ? ` · high ${log.data.weatherTempHighF}°F` : ""}
          {log.data.weatherTempLowF != null ? ` · low ${log.data.weatherTempLowF}°F` : ""}
        </Text>
      ) : null}
      {failed.map((op) => (
        <OpRow key={op.id} op={op} />
      ))}

      {editable ? (
        speaking ? (
          <Card>
            <Text style={[s.body, { color: t.text }]}>Tap the microphone on the keyboard and talk through the day: work done, where, delays, deliveries, safety, tomorrow.</Text>
            <TextInput
              value={speech}
              onChangeText={setSpeech}
              autoFocus
              multiline
              maxLength={4000}
              placeholder="Today we…"
              placeholderTextColor={t.muted}
              accessibilityLabel="What happened today"
              style={{ minHeight: TOUCH * 3, borderRadius: 10, borderWidth: 1, borderColor: t.border, backgroundColor: t.bg, color: t.text, padding: 12, fontSize: 16, textAlignVertical: "top" }}
            />
            {!online ? <Notice tone="warn" text="No signal: sorting needs the CRM. Type into the sections below instead." /> : null}
            <Button label={sorting ? "Sorting…" : "Sort into the log"} disabled={sorting || !online || speech.trim().length < 3} onPress={() => void sortSpeech()} />
            <Button label="Cancel" kind="secondary" onPress={() => setSpeaking(false)} />
          </Card>
        ) : (
          <Button label="Say it instead of typing" kind="secondary" onPress={() => setSpeaking(true)} />
        )
      ) : null}
      {spokenInto.length ? <Notice tone="warn" text="Added from what you said (marked below). Read it, change anything, then Save." /> : null}

      {LOG_TEXT_FIELDS.map((k) => (
        <View key={k} style={{ gap: 6 }}>
          <Text style={[s.label, { color: spokenInto.includes(k) ? t.warn : t.muted }]}>
            {LABEL[k].title}
            {spokenInto.includes(k) ? " · from what you said" : ""}
          </Text>
          <TextInput
            value={draft[k] ?? ""}
            onChangeText={(v) => set({ [k]: v })}
            editable={editable}
            placeholder={editable ? LABEL[k].hint : "—"}
            placeholderTextColor={t.muted}
            multiline
            accessibilityLabel={LABEL[k].title}
            style={{
              minHeight: LABEL[k].tall ? TOUCH * 2 : TOUCH,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: t.border,
              backgroundColor: editable ? t.card : t.bg,
              color: t.text,
              padding: 12,
              fontSize: 16,
              textAlignVertical: "top",
            }}
          />
        </View>
      ))}

      <Pressable
        accessibilityRole="button"
        onPress={() => router.push({ pathname: "/crew/[jobId]", params: { jobId, date } })}
        style={{ minHeight: TOUCH + 8, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, flexDirection: "row", alignItems: "center", gap: 12 }}
      >
        <Ionicons name="people-outline" size={24} color={t.brand} />
        <View style={{ flex: 1 }}>
          <Text style={[s.body, { color: t.text, fontWeight: "600" }]}>Crew hours</Text>
          <Text style={{ color: t.muted, fontSize: 13 }}>Who was on site and when</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={t.muted} />
      </Pressable>

      <Card>
        <Text style={[s.h2, { color: t.text }]}>Safety</Text>
        {LOG_SAFETY_CHECKS.map((k) => (
          <Pressable
            key={k}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: Boolean(draft[k]), disabled: !editable }}
            disabled={!editable}
            onPress={() => set({ [k]: !draft[k] })}
            style={{ minHeight: TOUCH, flexDirection: "row", alignItems: "center", gap: 12 }}
          >
            <Ionicons name={draft[k] ? "checkbox" : "square-outline"} size={26} color={draft[k] ? t.ok : t.muted} />
            <Text style={[s.body, { color: t.text }]}>{CHECK_LABEL[k]}</Text>
          </Pressable>
        ))}
      </Card>

      {status !== "APPROVED" ? (
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button label="Add photo" kind="secondary" onPress={() => void addPhotos(true)} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="From library" kind="secondary" onPress={() => void addPhotos(false)} />
          </View>
        </View>
      ) : null}

      {editable ? (
        <>
          <Button label={dirty ? "Save" : "Saved"} kind={dirty ? "primary" : "secondary"} disabled={!dirty} onPress={() => void save()} />
          <Button label="Submit to the office" kind="secondary" disabled={filled === 0 && !log.data} onPress={submit} />
        </>
      ) : null}
      <Text style={{ color: t.muted, fontSize: 13 }}>
        What you type is kept on this phone until you save. Saved changes, photos and submitting are sent when there is signal.
      </Text>
    </ScrollView>
  );
}
