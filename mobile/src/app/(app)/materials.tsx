import { useState } from "react";
import { Alert, FlatList, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { createFieldIssueRequest, type MaterialLine } from "@crm/mobile-api";
import { useMyJobs } from "@/api/queries";
import { addDays, addressLine, dayKey } from "@/lib/format";
import { clientId } from "@/lib/ids";
import { filledLines, materialsText, materialsTitle } from "@/lib/materials";
import { useOutbox } from "@/outbox/useOutbox";
import { Button, Notice, s } from "@/ui/components";
import { Chips } from "@/ui/Chips";
import { Loading } from "@/ui/states";
import { TOUCH, useTheme } from "@/ui/theme";

const UNITS = ["ea", "sheets", "boxes", "bags", "rolls", "LF", "SF", "gal"];
const blank = (): MaterialLine => ({ qty: "", unit: "", item: "" });

function niceDay(key: string): string {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * Ask the office for materials: what, how many, by when, where to deliver.
 * Saved as a field issue of type "Material request" (queued, so it works
 * without signal); the CRM gives it to the job's Purchasing person when no
 * one is named, and it shows under the job's Issues & punch.
 */
export default function RequestMaterials() {
  const t = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ jobId?: string }>();
  const jobs = useMyJobs();
  const outbox = useOutbox();
  const [jobId, setJobId] = useState(params.jobId ?? "");
  const [lines, setLines] = useState<MaterialLine[]>([blank()]);
  const [needed, setNeeded] = useState<"tomorrow" | "two" | "week" | "none">("tomorrow");
  const [deliverTo, setDeliverTo] = useState("");
  const [notes, setNotes] = useState("");
  const [priority, setPriority] = useState<"MEDIUM" | "HIGH" | "URGENT">("MEDIUM");
  const [saving, setSaving] = useState(false);

  const job = jobs.data?.data.find((j) => j.id === jobId);
  const setLine = (i: number, patch: Partial<MaterialLine>) =>
    setLines((ls) => {
      const next = ls.map((l, j) => (j === i ? { ...l, ...patch } : l));
      // Always one empty line at the end to type the next item into.
      return next[next.length - 1].item.trim() ? [...next, blank()] : next;
    });

  const save = async () => {
    const filled = filledLines(lines);
    if (!filled.length) return Alert.alert("Add an item", "Type at least one thing you need.");
    const neededKey = needed === "tomorrow" ? addDays(dayKey(), 1) : needed === "two" ? addDays(dayKey(), 2) : needed === "week" ? addDays(dayKey(), 7) : null;
    const id = clientId();
    const body = createFieldIssueRequest.safeParse({
      id,
      type: "MATERIAL_REQUEST",
      title: materialsTitle(lines),
      description: materialsText(lines, neededKey ? niceDay(neededKey) : null, deliverTo, notes),
      priority,
      ...(neededKey ? { dueAt: `${neededKey}T16:00:00.000Z` } : {}),
    });
    if (!body.success) return Alert.alert("Check the request", body.error.issues[0]?.message ?? "Something is too long");
    setSaving(true);
    try {
      await outbox.enqueue({
        kind: "issue.create",
        targetId: `issue:${id}`,
        method: "POST",
        path: `/api/jobs/${jobId}/field-issues`,
        body: body.data,
        label: `Materials · ${body.data.title}`,
      });
      router.back();
    } finally {
      setSaving(false);
    }
  };

  if (!jobId)
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <Stack.Screen options={{ title: "Materials for which job?" }} />
        {jobs.isPending ? (
          <Loading />
        ) : (
          <FlatList
            data={jobs.data?.data ?? []}
            keyExtractor={(j) => j.id}
            contentContainerStyle={{ padding: 16, gap: 8 }}
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                onPress={() => setJobId(item.id)}
                style={{ minHeight: TOUCH + 8, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, justifyContent: "center" }}
              >
                <Text style={[s.body, { color: t.text, fontWeight: "600" }]}>{addressLine(item.lead) ?? item.title}</Text>
                <Text style={{ color: t.muted, fontSize: 13 }}>{item.jobNumber}</Text>
              </Pressable>
            )}
          />
        )}
      </View>
    );

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets keyboardDismissMode="on-drag">
      <Stack.Screen options={{ title: "Request materials" }} />
      {job ? <Text style={{ color: t.muted, fontSize: 15 }}>{addressLine(job.lead) ?? job.title}</Text> : null}

      <Text style={[s.label, { color: t.muted }]}>What you need</Text>
      {lines.map((l, i) => (
        <View key={i} style={{ gap: 6, paddingBottom: 8, borderBottomWidth: i < lines.length - 1 ? 1 : 0, borderBottomColor: t.border }}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TextInput
              value={l.qty}
              onChangeText={(v) => setLine(i, { qty: v })}
              placeholder="Qty"
              placeholderTextColor={t.muted}
              keyboardType="decimal-pad"
              maxLength={20}
              accessibilityLabel={`Quantity, line ${i + 1}`}
              style={{ width: 72, minHeight: TOUCH, borderRadius: 10, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, color: t.text, paddingHorizontal: 10, fontSize: 16 }}
            />
            <TextInput
              value={l.item}
              onChangeText={(v) => setLine(i, { item: v })}
              placeholder={i === 0 ? "e.g. 5/8 drywall" : "Another item"}
              placeholderTextColor={t.muted}
              maxLength={200}
              accessibilityLabel={`Item, line ${i + 1}`}
              style={{ flex: 1, minHeight: TOUCH, borderRadius: 10, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, color: t.text, paddingHorizontal: 12, fontSize: 16 }}
            />
            {lines.length > 1 && l.item.trim() ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`Remove line ${i + 1}`} onPress={() => setLines((ls) => ls.filter((_, j) => j !== i))} style={{ width: TOUCH, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="trash-outline" size={20} color={t.muted} />
              </Pressable>
            ) : null}
          </View>
          {l.item.trim() || l.qty.trim() ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 6 }}>
              {UNITS.map((u) => {
                const on = l.unit === u;
                return (
                  <Pressable
                    key={u}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    onPress={() => setLine(i, { unit: on ? "" : u })}
                    style={{ minHeight: 36, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: on ? t.brand : t.border, backgroundColor: on ? t.brandSoft : t.card, justifyContent: "center" }}
                  >
                    <Text style={{ color: on ? t.brand : t.text, fontSize: 14 }}>{u}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}
        </View>
      ))}

      <Chips
        label="Needed on site"
        value={needed}
        onChange={setNeeded}
        options={[
          { value: "tomorrow", label: "Tomorrow" },
          { value: "two", label: "In 2 days" },
          { value: "week", label: "In a week" },
          { value: "none", label: "No rush" },
        ]}
      />
      <TextInput
        value={deliverTo}
        onChangeText={setDeliverTo}
        placeholder="Deliver to (e.g. front driveway, or 'I'll pick up')"
        placeholderTextColor={t.muted}
        maxLength={300}
        accessibilityLabel="Deliver to"
        style={{ minHeight: TOUCH, borderRadius: 10, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, color: t.text, paddingHorizontal: 12, fontSize: 16 }}
      />
      <TextInput
        value={notes}
        onChangeText={setNotes}
        multiline
        maxLength={1500}
        placeholder="Notes (brand, color, supplier, gate code…)"
        placeholderTextColor={t.muted}
        accessibilityLabel="Notes"
        style={{ minHeight: TOUCH * 1.5, borderRadius: 10, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, color: t.text, padding: 12, fontSize: 16, textAlignVertical: "top" }}
      />
      <Chips
        label="How urgent"
        value={priority}
        onChange={setPriority}
        options={[
          { value: "MEDIUM", label: "Normal" },
          { value: "HIGH", label: "High" },
          { value: "URGENT", label: "Work is stopped" },
        ]}
      />
      <Notice text="Goes to the job's purchasing person as a task, and shows under the job's Issues & punch. Works without signal." />
      <Button label={saving ? "Saving…" : "Send request"} disabled={saving || !filledLines(lines).length} onPress={() => void save()} />
    </ScrollView>
  );
}
