import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as Crypto from "expo-crypto";
import { useQueryClient } from "@tanstack/react-query";
import { inspectionOutcome, recordInspectionRequest, type InspectionOutcomeDto } from "@crm/mobile-api";
import { api, ApiError } from "@/api/client";
import { useInspections } from "@/api/queries";
import { addressLine, shortDate, time } from "@/lib/format";
import { RESULT_EFFECT, RESULT_LABEL, TYPE_LABEL } from "@/lib/inspections";
import { Button, Card, Notice, s } from "@/ui/components";
import { Empty, LoadError, Loading } from "@/ui/states";
import { TOUCH, useTheme } from "@/ui/theme";

type Recordable = "PASS" | "FAIL" | "CONDITIONAL" | "CANCELLED";
const CHOICES: { value: Recordable; label: string }[] = [
  { value: "PASS", label: "Passed" },
  { value: "FAIL", label: "Failed" },
  { value: "CONDITIONAL", label: "Passed with conditions" },
  { value: "CANCELLED", label: "Cancelled" },
];

function Row({ label, value }: { label: string; value: string | null }) {
  const t = useTheme();
  if (!value) return null;
  return (
    <View style={{ gap: 2, paddingVertical: 3 }}>
      <Text style={[s.label, { color: t.muted }]}>{label}</Text>
      <Text style={[s.body, { color: t.text }]}>{value}</Text>
    </View>
  );
}

/**
 * One inspection. Recording a result needs signal: the CRM runs the
 * workflow on it (blocks the step and raises a correction task on a fail,
 * completes the step on a pass, closes the permit on a passed final), and
 * says what it did.
 */
export default function InspectionScreen() {
  const t = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useInspections();
  const [choice, setChoice] = useState<Recordable | null>(null);
  const [notes, setNotes] = useState("");
  const [inspector, setInspector] = useState("");
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState<InspectionOutcomeDto | null>(null);

  if (q.isPending) return <Loading />;
  if ((q.isError && q.data === undefined))
    return (
      <View style={{ padding: 16, flex: 1, backgroundColor: t.bg }}>
        <LoadError error={q.error} onRetry={() => q.refetch()} />
      </View>
    );
  const i = q.data.find((x) => x.id === id);
  if (!i)
    return (
      <View style={{ padding: 16, flex: 1, backgroundColor: t.bg }}>
        <Empty title="Inspection not found" body="It may be older than 30 days, or on a job you can't see." />
      </View>
    );

  const address = addressLine(i.permit.job.lead);
  const notesNeeded = choice === "FAIL" || choice === "CONDITIONAL";

  const save = async () => {
    if (!choice) return;
    if (notesNeeded && !notes.trim()) {
      Alert.alert("Add the inspector's comments", "They become the correction task, so the crew knows what to fix.");
      return;
    }
    const body = recordInspectionRequest.parse({
      result: choice,
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...(inspector.trim() ? { inspectorName: inspector.trim() } : {}),
      completedAt: new Date().toISOString(),
    });
    setSaving(true);
    try {
      const res = await api(`/api/inspections/${i.id}`, {
        method: "PATCH",
        body,
        schema: inspectionOutcome,
        idempotencyKey: Crypto.randomUUID(),
      });
      setOutcome(res);
      void qc.invalidateQueries({ queryKey: ["inspections"] });
      void qc.invalidateQueries({ queryKey: ["calendar"] });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
    } catch (e) {
      const msg = e instanceof ApiError ? (e.offline ? "No signal. A result needs the CRM: try again when you're connected." : e.message) : String(e);
      Alert.alert("Result not saved", msg);
    } finally {
      setSaving(false);
    }
  };

  const outcomeText = (o: InspectionOutcomeDto): string => {
    const parts: string[] = [`${RESULT_LABEL[o.result]} recorded.`];
    if (o.workflow?.correctionTaskId) parts.push("A correction task was created.");
    if (o.workflow?.applied && o.workflow.stepStatus === "BLOCKED") parts.push("The workflow step is blocked until the correction is done.");
    if (o.workflow?.applied && o.workflow.stepStatus === "COMPLETED") parts.push("The workflow step is completed.");
    if (o.permitClosed) parts.push("The permit is closed.");
    return parts.join(" ");
  };

  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={s.scroll}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      keyboardDismissMode="on-drag"
    >
      <Stack.Screen options={{ title: "Inspection" }} />
      {address ? (
        <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: "/job/[id]", params: { id: i.permit.job.id } })}>
          <Text style={{ color: t.brand, fontSize: 15, fontWeight: "600" }}>{address} ›</Text>
        </Pressable>
      ) : null}
      <Text style={[s.h1, { color: t.text, fontSize: 24 }]}>{TYPE_LABEL[i.type]} inspection</Text>
      <Card>
        <Row label="Status" value={RESULT_LABEL[i.result]} />
        <Row label="When" value={i.scheduledFor ? `${shortDate(i.scheduledFor)}, ${time(i.scheduledFor)}` : "Not booked for a date yet"} />
        <Row label="Permit" value={[i.permit.permitType, i.permit.permitNumber].filter(Boolean).join(" · ") || null} />
        <Row label="Department" value={i.permit.municipality} />
        <Row label="Inspector" value={i.inspectorName} />
        <Row label="Notes" value={i.notes} />
      </Card>

      {outcome ? (
        <Card style={{ borderColor: outcome.result === "FAIL" ? t.danger : t.ok }}>
          <Text style={[s.body, { color: t.text, fontWeight: "600" }]}>{outcomeText(outcome)}</Text>
          {outcome.workflow?.correctionTaskId ? (
            <Button
              label="Open the correction task"
              kind="secondary"
              onPress={() => router.push({ pathname: "/task/[id]", params: { id: outcome.workflow!.correctionTaskId! } })}
            />
          ) : null}
        </Card>
      ) : i.result === "SCHEDULED" ? (
        <>
          <Text style={[s.h2, { color: t.text }]}>Record the result</Text>
          <View style={{ gap: 8 }} accessibilityRole="radiogroup">
            {CHOICES.map((c) => {
              const on = choice === c.value;
              return (
                <Pressable
                  key={c.value}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  onPress={() => setChoice(c.value)}
                  style={{
                    minHeight: TOUCH,
                    justifyContent: "center",
                    paddingHorizontal: 14,
                    borderRadius: 10,
                    borderWidth: on ? 2 : 1,
                    borderColor: on ? t.brand : t.border,
                    backgroundColor: on ? t.brandSoft : t.card,
                  }}
                >
                  <Text style={{ color: t.text, fontSize: 16, fontWeight: on ? "700" : "500" }}>{c.label}</Text>
                </Pressable>
              );
            })}
          </View>
          {choice ? <Notice text={RESULT_EFFECT[choice]} /> : null}
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder={notesNeeded ? "What the inspector wants fixed (required)" : "Notes (optional)"}
            placeholderTextColor={t.muted}
            multiline
            accessibilityLabel="Inspector's comments"
            style={{ minHeight: TOUCH * 1.6, borderRadius: 10, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, color: t.text, padding: 12, fontSize: 16, textAlignVertical: "top" }}
          />
          <TextInput
            value={inspector}
            onChangeText={setInspector}
            placeholder="Inspector's name (optional)"
            placeholderTextColor={t.muted}
            accessibilityLabel="Inspector's name"
            style={{ minHeight: TOUCH, borderRadius: 10, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, color: t.text, paddingHorizontal: 12, fontSize: 16 }}
          />
          <Button label="Save result" disabled={!choice} busy={saving} onPress={() => void save()} />
        </>
      ) : (
        <Notice text="This result is recorded. To change it, use the job's Permits tab on the web." />
      )}
    </ScrollView>
  );
}
