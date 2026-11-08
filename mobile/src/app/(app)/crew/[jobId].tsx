import { useEffect, useMemo, useRef, useState } from "react";
import { track } from "@/usage/track";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import { saveLaborSheetRequest, type CrewMemberDto, type LaborEntryInput } from "@crm/mobile-api";
import { api, ApiError } from "@/api/client";
import { useCrewList, useDailySheet, useJob } from "@/api/queries";
import { addressLine, dayKey } from "@/lib/format";
import { clearDraft, readDraft, writeDraft } from "@/lib/drafts";
import { clientId } from "@/lib/ids";
import { BREAKS, DEFAULT_END, DEFAULT_START, clock, clockIn, clockOut, entryHours, hoursSoFar, isOnSite, markAbsent, newEntry, nowMinutes, personName, sheetHours, stepTime, toInput } from "@/lib/labor";
import { useOutbox } from "@/outbox/useOutbox";
import { Button, Card, Notice, s } from "@/ui/components";
import { Chips } from "@/ui/Chips";
import { OpRow } from "@/ui/OpRow";
import { LoadError, Loading } from "@/ui/states";
import { TOUCH, useTheme } from "@/ui/theme";

function shortDay(key: string): string {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * The day's crew sheet: who was on site, start / end / break, absences.
 * The whole sheet is one save (the CRM replaces the day's sheet), kept on the
 * phone until saved and queued like the write-up. "Start now" / "Stop now"
 * fill the time from the phone's clock, so they work without signal too.
 */
export default function CrewHours() {
  const t = useTheme();
  useEffect(() => track("crew_hours_opened", "log"), []);
  const qc = useQueryClient();
  const { jobId, date: dateParam } = useLocalSearchParams<{ jobId: string; date?: string }>();
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : dayKey();
  const job = useJob(jobId);
  const sheet = useDailySheet(jobId, date);
  const crew = useCrewList();
  const outbox = useOutbox();
  const target = `log:${jobId}:${date}`;
  const draftKey = `crew:${jobId}:${date}`;

  const [entries, setEntries] = useState<LaborEntryInput[]>([]);
  const [dirty, setDirty] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [copying, setCopying] = useState(false);
  const loaded = useRef(false);

  const mine = outbox.ops.filter((o) => o.targetId === target);
  const waiting = mine.filter((o) => o.state === "queued");
  const failed = mine.filter((o) => o.state === "failed" && o.kind === "labor.save");
  const queuedSave = mine.filter((o) => o.kind === "labor.save" && o.state !== "failed").at(-1);
  const submitQueued = waiting.some((o) => o.kind === "log.submit");

  // Newest first: unsaved changes, then a save still waiting to send, then the CRM's sheet.
  useEffect(() => {
    if (sheet.isPending || loaded.current) return;
    loaded.current = true;
    void (async () => {
      const draft = await readDraft<LaborEntryInput[]>(draftKey);
      const queued = (queuedSave?.body as { entries?: LaborEntryInput[] } | undefined)?.entries;
      setEntries(draft ?? queued ?? (sheet.data?.entries ?? []).map(toInput));
      setDirty(Boolean(draft));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once, when the screen opens
  }, [sheet.isPending, sheet.data, draftKey]);

  useEffect(() => {
    if (!dirty) return;
    const id = setTimeout(() => void writeDraft(draftKey, entries), 400);
    return () => clearTimeout(id);
  }, [entries, dirty, draftKey]);

  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of sheet.data?.entries ?? []) if (e.personnel) m.set(e.personnelId, personName(e.personnel));
    for (const p of crew.data ?? []) m.set(p.id, personName(p));
    return m;
  }, [sheet.data, crew.data]);
  const serverHours = useMemo(() => new Map((sheet.data?.entries ?? []).map((e) => [e.id, e])), [sheet.data]);

  const status = submitQueued ? "SUBMITTED" : sheet.data?.status ?? "DRAFT";
  const editable = status === "DRAFT";
  const onSheet = new Set(entries.map((e) => e.personnelId));
  const notOnSheet = (crew.data ?? []).filter((p) => !onSheet.has(p.id));
  const present = entries.filter((e) => !e.isAbsent);
  const isToday = date === dayKey();
  const onSite = entries.filter(isOnSite);
  // "Hours so far" moves on by itself while people are on site.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!onSite.length) return;
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, [onSite.length]);
  const address = addressLine(job.data?.lead);

  const change = (next: LaborEntryInput[]) => {
    setEntries(next);
    setDirty(true);
  };
  const update = (id: string, patch: Partial<LaborEntryInput>) => change(entries.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const add = (people: CrewMemberDto[]) => {
    const added = people.map((p) => newEntry(p, clientId()));
    change([...entries, ...added]);
    if (added.length === 1) setOpen(added[0].id);
  };
  // Clocking saves at once (queued without signal): nothing to remember to save.
  const clockTo = async (next: LaborEntryInput[]) => {
    setEntries(next);
    await save(next);
  };
  const clockInPeople = (people: CrewMemberDto[]) => void clockTo(clockIn(entries, people, clientId));
  const clockOutIds = (ids: string[] | null) => void clockTo(clockOut(entries, ids));

  const remove = (e: LaborEntryInput) =>
    Alert.alert(`Take ${names.get(e.personnelId) ?? "this worker"} off the sheet?`, "Use Absent instead if they were expected but did not come.", [
      { text: "Keep", style: "cancel" },
      { text: "Take off", style: "destructive", onPress: () => change(entries.filter((x) => x.id !== e.id)) },
    ]);

  const save = async (list: LaborEntryInput[] = entries) => {
    const body = saveLaborSheetRequest.safeParse({
      entries: list.map(toInput),
      ...(sheet.data?.updatedAt ? { baseUpdatedAt: sheet.data.updatedAt } : {}),
    });
    if (!body.success) return Alert.alert("Check the sheet", body.error.issues[0]?.message ?? "Something is not right");
    const bad = list.find((e) => !e.isAbsent && e.startMinutes != null && e.endMinutes != null && e.endMinutes <= e.startMinutes);
    if (bad) return Alert.alert("Check the times", `${names.get(bad.personnelId) ?? "A worker"} stops before they start.`);
    await outbox.enqueue({
      kind: "labor.save",
      targetId: target,
      method: "PUT",
      path: `/api/jobs/${jobId}/daily-logs/${date}/labor`,
      body: body.data,
      label: `Crew hours · ${address ?? "job"} · ${date}`,
    });
    await clearDraft(draftKey);
    setDirty(false);
  };

  // Written by the CRM (it finds the job's last log), so only with signal and an empty sheet.
  const copyYesterday = async () => {
    setCopying(true);
    try {
      await api(`/api/jobs/${encodeURIComponent(jobId)}/daily-logs/${date}/copy-previous`, { method: "POST", body: {} });
      const fresh = await sheet.refetch();
      setEntries((fresh.data?.entries ?? []).map(toInput));
      setDirty(false);
      await qc.invalidateQueries({ queryKey: ["dailyLog", jobId, date] });
    } catch (e) {
      Alert.alert("Could not copy", e instanceof ApiError ? e.message : "Try again when there is signal.");
    } finally {
      setCopying(false);
    }
  };

  if (sheet.isPending || job.isPending) return <Loading />;
  if ((sheet.isError && sheet.data === undefined))
    return (
      <View style={{ padding: 16, flex: 1, backgroundColor: t.bg }}>
        <LoadError error={sheet.error} onRetry={() => sheet.refetch()} />
      </View>
    );
  const noCrewAccess = crew.error instanceof ApiError && crew.error.status === 403;

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets keyboardDismissMode="on-drag">
      <Stack.Screen options={{ title: `Crew · ${shortDay(date)}` }} />
      <View>
        {address ? <Text style={{ color: t.muted, fontSize: 15 }}>{address}</Text> : null}
        <Text style={[s.h1, { color: t.text, fontSize: 24 }]}>
          {present.length} on the sheet · {Math.round(entries.reduce((n, e) => n + hoursSoFar(e), 0) * 10) / 10} h{onSite.length ? " so far" : ""}
        </Text>
        <Text style={{ color: t.muted, fontSize: 14 }}>
          {dirty ? "Unsaved changes on this phone" : queuedSave && queuedSave.state === "queued" ? "Saving…" : sheet.data ? "Saved" : "Not started"}
          {sheet.data && !dirty && !queuedSave && sheet.data.totals.otHours > 0 ? ` · ${sheet.data.totals.otHours} h overtime` : ""}
        </Text>
      </View>

      {!editable ? <Notice text={status === "APPROVED" ? "This log is approved." : "This log is submitted. Ask the office to send it back to change hours."} /> : null}
      {failed.map((op) => (
        <OpRow key={op.id} op={op} />
      ))}

      {editable && isToday && onSite.length ? (
        <Card style={{ borderColor: t.ok }}>
          <Text style={[s.h2, { color: t.text }]}>On site now · {onSite.length}</Text>
          {onSite.map((e) => (
            <View key={e.id} style={{ minHeight: TOUCH, flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={[s.body, { color: t.text, fontWeight: "600" }]}>{names.get(e.personnelId) ?? "Worker"}</Text>
                <Text style={{ color: t.muted, fontSize: 13 }}>
                  since {clock(e.startMinutes)} · {hoursSoFar(e)} h so far
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Clock out ${names.get(e.personnelId) ?? "worker"}`}
                onPress={() => clockOutIds([e.id])}
                style={{ minHeight: TOUCH, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: t.border, justifyContent: "center", backgroundColor: t.bg }}
              >
                <Text style={{ color: t.brand, fontWeight: "700" }}>Clock out</Text>
              </Pressable>
            </View>
          ))}
          {onSite.length > 1 ? (
            <Button
              label={`Clock everyone out (${onSite.length})`}
              kind="secondary"
              onPress={() =>
                Alert.alert(`Clock out ${onSite.length} people now?`, "Each gets an end time of now. Breaks stay as they are on each card.", [
                  { text: "Not yet", style: "cancel" },
                  { text: "Clock out", onPress: () => clockOutIds(null) },
                ])
              }
            />
          ) : null}
          <Text style={{ color: t.muted, fontSize: 12 }}>Clocked-in people start with no break; set it on their card below if they took one.</Text>
        </Card>
      ) : null}

      {entries.map((e) => {
        const isOpen = open === e.id && editable;
        const server = serverHours.get(e.id);
        return (
          <Card key={e.id}>
            <Pressable accessibilityRole="button" onPress={() => setOpen(isOpen ? null : e.id)} style={{ minHeight: TOUCH, flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={[s.body, { color: t.text, fontWeight: "600" }]}>{names.get(e.personnelId) ?? "Worker"}</Text>
                <Text style={{ color: e.isAbsent ? t.warn : t.muted, fontSize: 14 }}>
                  {e.isAbsent
                    ? `Absent${e.absenceReason ? ` · ${e.absenceReason}` : ""}`
                    : isOnSite(e)
                      ? `On site since ${clock(e.startMinutes)} · break ${e.breakMinutes} min`
                      : `${clock(e.startMinutes)} – ${clock(e.endMinutes)} · break ${e.breakMinutes} min`}
                </Text>
              </View>
              <Text style={{ color: t.text, fontSize: 18, fontWeight: "700" }}>{hoursSoFar(e)} h</Text>
              {editable ? <Ionicons name={isOpen ? "chevron-up" : "chevron-down"} size={20} color={t.muted} /> : null}
            </Pressable>
            {server && !dirty && server.otHours > 0 ? <Text style={{ color: t.muted, fontSize: 13 }}>{server.regularHours} h regular · {server.otHours} h overtime</Text> : null}

            {isOpen ? (
              <View style={{ gap: 10, marginTop: 6 }}>
                <Chips
                  label="Attendance"
                  value={e.isAbsent ? "absent" : "present"}
                  options={[{ value: "present", label: "On site" }, { value: "absent", label: "Absent" }]}
                  onChange={(v) => update(e.id, markAbsent(e, v === "absent"))}
                />
                {e.isAbsent ? (
                  <TextInput
                    value={e.absenceReason ?? ""}
                    onChangeText={(v) => update(e.id, { absenceReason: v })}
                    placeholder="Reason (sick, no-show…)"
                    placeholderTextColor={t.muted}
                    maxLength={200}
                    style={{ minHeight: TOUCH, borderRadius: 10, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, color: t.text, paddingHorizontal: 12, fontSize: 16 }}
                  />
                ) : (
                  <>
                    <TimeRow
                      label="Start"
                      value={e.startMinutes}
                      onStep={(d) => update(e.id, { startMinutes: stepTime(e.startMinutes, d, DEFAULT_START) })}
                      onNow={() => update(e.id, { startMinutes: nowMinutes() })}
                      nowLabel="Start now"
                    />
                    <TimeRow
                      label="End"
                      value={e.endMinutes}
                      onStep={(d) => update(e.id, { endMinutes: stepTime(e.endMinutes, d, DEFAULT_END) })}
                      onNow={() => update(e.id, { endMinutes: nowMinutes(new Date(), e.startMinutes) })}
                      nowLabel="Stop now"
                    />
                    <Chips
                      label="Break"
                      value={String(e.breakMinutes)}
                      options={BREAKS.map((b) => ({ value: String(b), label: b === 0 ? "None" : `${b} min` }))}
                      onChange={(v) => update(e.id, { breakMinutes: Number(v) })}
                    />
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <Toggle label="Came late" on={e.isLate} onPress={() => update(e.id, { isLate: !e.isLate })} />
                      <Toggle label="Left early" on={e.leftEarly} onPress={() => update(e.id, { leftEarly: !e.leftEarly })} />
                    </View>
                  </>
                )}
                <Button label="Take off the sheet" kind="danger" onPress={() => remove(e)} />
              </View>
            ) : null}
          </Card>
        );
      })}

      {editable ? (
        <>
          {entries.length === 0 && !queuedSave ? (
            <Button label={copying ? "Copying…" : "Copy the last log's crew"} kind="secondary" disabled={copying} onPress={() => void copyYesterday()} />
          ) : null}
          {noCrewAccess ? (
            <Notice text="Only the office and crew leads can add people to the sheet." />
          ) : (
            <>
              <Button label={adding ? "Done" : isToday ? "Clock people in" : "Add people"} kind={adding || !isToday ? "secondary" : "primary"} onPress={() => setAdding((a) => !a)} />
              {adding ? (
                <Card>
                  {crew.isPending ? <Text style={{ color: t.muted }}>Loading the crew list…</Text> : null}
                  {(crew.isError && crew.data === undefined) && !noCrewAccess ? <Text style={{ color: t.danger }}>The crew list did not load. Try again with signal.</Text> : null}
                  {notOnSheet.length > 1 ? (
                    <Button
                      label={isToday ? `Clock everyone in (${notOnSheet.length})` : `Add everyone (${notOnSheet.length})`}
                      kind="secondary"
                      onPress={() => (isToday ? clockInPeople(notOnSheet) : add(notOnSheet))}
                    />
                  ) : null}
                  {isToday && notOnSheet.length ? <Text style={{ color: t.muted, fontSize: 13 }}>Tap a name to clock them in now. Use their card to set other times.</Text> : null}
                  {notOnSheet.map((p) => (
                    <Pressable
                      key={p.id}
                      accessibilityRole="button"
                      accessibilityLabel={isToday ? `Clock in ${personName(p)}` : `Add ${personName(p)}`}
                      onPress={() => (isToday ? clockInPeople([p]) : add([p]))}
                      style={{ minHeight: TOUCH, flexDirection: "row", alignItems: "center", gap: 10 }}
                    >
                      <Ionicons name={isToday ? "log-in-outline" : "add-circle-outline"} size={24} color={t.brand} />
                      <View style={{ flex: 1 }}>
                        <Text style={[s.body, { color: t.text }]}>{personName(p)}</Text>
                        <Text style={{ color: t.muted, fontSize: 13 }}>{[p.trade, p.crew?.name].filter(Boolean).join(" · ") || " "}</Text>
                      </View>
                    </Pressable>
                  ))}
                  {crew.data && notOnSheet.length === 0 ? <Text style={{ color: t.muted }}>Everyone on the crew list is on the sheet.</Text> : null}
                </Card>
              ) : null}
            </>
          )}
          <Button label={dirty ? "Save crew hours" : "Saved"} kind={dirty ? "primary" : "secondary"} disabled={!dirty} onPress={() => void save()} />
        </>
      ) : null}
      <Text style={{ color: t.muted, fontSize: 13 }}>
        Hours are kept on this phone until you save, and sent when there is signal. The office splits regular and overtime.
      </Text>
    </ScrollView>
  );
}

function TimeRow(props: { label: string; value: number | null | undefined; onStep: (d: number) => void; onNow: () => void; nowLabel: string }) {
  const t = useTheme();
  const btn = { minWidth: TOUCH, minHeight: TOUCH, borderRadius: 10, borderWidth: 1, borderColor: t.border, alignItems: "center" as const, justifyContent: "center" as const, backgroundColor: t.card };
  return (
    <View style={{ gap: 6 }}>
      <Text style={[s.label, { color: t.muted }]}>{props.label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${props.label} 15 minutes earlier`} onPress={() => props.onStep(-15)} style={btn}>
          <Ionicons name="remove" size={22} color={t.text} />
        </Pressable>
        <Text style={{ flex: 1, textAlign: "center", color: t.text, fontSize: 18, fontWeight: "600" }}>{clock(props.value)}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`${props.label} 15 minutes later`} onPress={() => props.onStep(15)} style={btn}>
          <Ionicons name="add" size={22} color={t.text} />
        </Pressable>
        <Pressable accessibilityRole="button" onPress={props.onNow} style={[btn, { paddingHorizontal: 12 }]}>
          <Text style={{ color: t.brand, fontWeight: "600" }}>{props.nowLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Toggle({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      onPress={onPress}
      style={{ flex: 1, minHeight: TOUCH, borderRadius: 24, borderWidth: 1, borderColor: on ? t.warn : t.border, backgroundColor: t.card, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }}
    >
      <Ionicons name={on ? "checkbox" : "square-outline"} size={20} color={on ? t.warn : t.muted} />
      <Text style={{ color: t.text, fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
}
