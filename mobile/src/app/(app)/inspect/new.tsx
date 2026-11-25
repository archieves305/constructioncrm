import { useState } from "react";
import { Alert, FlatList, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { startQualityInspectionRequest } from "@crm/mobile-api";
import { q, useMyJobs } from "@/api/queries";
import { useSession } from "@/auth/session";
import { addressLine } from "@/lib/format";
import { clientId } from "@/lib/ids";
import { isCrewRole } from "@/lib/crew";
import { PHONE_KINDS, PHONE_KIND_TEXT } from "@/lib/inspector";
import { useOutbox } from "@/outbox/useOutbox";
import { Button, Card, Notice, s } from "@/ui/components";
import { Chips } from "@/ui/Chips";
import { Loading } from "@/ui/states";
import { TOUCH, useTheme } from "@/ui/theme";

type Kind = (typeof PHONE_KINDS)[number];

/**
 * Start an AI Field Inspection: what kind, which job (or an address for a
 * quick look), whose work. Saved on the phone at once and sent by the outbox,
 * so it works without signal; the walk screen opens straight away.
 */
export default function NewInspection() {
  const t = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ jobId?: string; label?: string }>();
  const { user } = useSession();
  const crew = isCrewRole(user?.role);
  const outbox = useOutbox();
  const jobs = useMyJobs();
  const [jobId, setJobId] = useState<string | null>(params.jobId ?? null);
  const [label, setLabel] = useState<string | undefined>(params.label);
  const [noJob, setNoJob] = useState(false);
  const [address, setAddress] = useState("");
  const [kind, setKind] = useState<Kind>("COMPLETION");
  const [moreKinds, setMoreKinds] = useState(false);
  const [contractId, setContractId] = useState("");
  const [saving, setSaving] = useState(false);
  const options = useQuery({ ...q.qualityOptions(jobId ?? undefined), enabled: Boolean(jobId) || noJob, retry: false });

  const start = async () => {
    const id = clientId();
    const body = startQualityInspectionRequest.safeParse({ id, kind, jobId, laborContractId: contractId || null, addressText: jobId ? null : address.trim() || null });
    if (!body.success) return Alert.alert("Check the details", body.error.issues[0]?.message ?? "Something is missing");
    if (!jobId && !address.trim()) return Alert.alert("Where is it?", "Type the address, or pick a job.");
    setSaving(true);
    try {
      await outbox.enqueue({ kind: "inspection.create", targetId: `insp:${id}`, method: "POST", path: "/api/quality-inspections", body: body.data, label: `Inspection · ${label ?? address.trim()}` });
      router.replace({ pathname: "/inspect/[id]", params: { id, label: label ?? address.trim(), jobId: jobId ?? "" } });
    } finally {
      setSaving(false);
    }
  };

  // No job yet: pick one of mine, or (office) inspect an address with no job.
  if (!jobId && !noJob)
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <Stack.Screen options={{ title: "Inspect which job?" }} />
        {jobs.isPending ? (
          <Loading />
        ) : (
          <FlatList
            data={jobs.data?.data ?? []}
            keyExtractor={(j) => j.id}
            contentContainerStyle={{ padding: 16, gap: 8 }}
            ListHeaderComponent={crew ? undefined : <Button label="No job — just an address" kind="secondary" onPress={() => setNoJob(true)} />}
            ListEmptyComponent={<Notice text="You have no open jobs." />}
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setJobId(item.id);
                  setLabel(addressLine(item.lead) ?? item.jobNumber);
                }}
                style={{ minHeight: TOUCH + 8, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, justifyContent: "center" }}
              >
                <Text style={[s.body, { color: t.text, fontWeight: "600" }]}>{addressLine(item.lead) ?? item.title}</Text>
                <Text style={{ color: t.muted, fontSize: 13 }}>{item.lead?.fullName ?? ""} · {item.jobNumber}</Text>
              </Pressable>
            )}
          />
        )}
      </View>
    );

  const kinds = moreKinds ? PHONE_KINDS : PHONE_KINDS.slice(0, 4);
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: "New inspection" }} />
      <Card>
        <Text style={[s.label, { color: t.muted }]}>Inspecting</Text>
        {jobId ? (
          <Text style={[s.body, { color: t.text, fontWeight: "600" }]}>{label ?? "This job"}</Text>
        ) : (
          <TextInput
            accessibilityLabel="Address"
            value={address}
            onChangeText={setAddress}
            placeholder="Street, unit, city"
            placeholderTextColor={t.muted}
            style={[s.body, { color: t.text, minHeight: TOUCH, borderWidth: 1, borderColor: t.border, borderRadius: 10, paddingHorizontal: 12 }]}
          />
        )}
      </Card>
      <Chips<Kind> label="What is this?" value={kind} onChange={setKind} options={kinds.map((k) => ({ value: k, label: PHONE_KIND_TEXT[k] }))} />
      {!moreKinds ? <Button label="More kinds" kind="secondary" onPress={() => setMoreKinds(true)} /> : null}
      {options.data?.contracts.length ? (
        <Chips<string>
          label="Whose work (optional)"
          value={contractId}
          onChange={setContractId}
          options={[{ value: "", label: "Not one contractor" }, ...options.data.contracts.map((c) => ({ value: c.id, label: c.name }))]}
        />
      ) : null}
      <Button label="Start" busy={saving} onPress={() => void start()} />
      <Text style={{ color: t.muted, fontSize: 13 }}>
        You will walk the property room by room. The AI looks at each room's photos while you keep going; nothing it says is acted on until someone confirms it. It is a look at the workmanship, not a code or permit inspection.
      </Text>
    </ScrollView>
  );
}
