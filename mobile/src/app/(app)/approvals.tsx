import { track } from "@/usage/track";
import { useEffect, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import { approvalsInbox, type ApprovalsInboxDto } from "@crm/mobile-api";
import { api, ApiError } from "@/api/client";
import { useOnline } from "@/cache/net";
import { dollars } from "@/lib/crewpay";
import { shortDate } from "@/lib/format";
import { Button, Card, Notice, s } from "@/ui/components";
import { Empty, LoadError, Loading } from "@/ui/states";
import { TOUCH, useTheme } from "@/ui/theme";

/**
 * What waits on you: charges to approve, daily logs to approve or send back,
 * what crews sent, and crew payment requests waiting to be paid (paid at the
 * desk). Each decision goes through the CRM's own route and rules. Online
 * only, never kept on the phone.
 */
export default function Approvals() {
  const t = useTheme();
  const router = useRouter();
  const online = useOnline();
  useEffect(() => track("approvals_opened"), []);
  const inbox = useQuery({ queryKey: ["approvals"], queryFn: () => api("/api/mobile/approvals", { schema: approvalsInbox }) });
  const d = inbox.data;
  const empty = d && !d.expenses.length && !d.logs.length && !d.paymentRequests.length && !d.crewSubmissionsWaiting;
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={inbox.isRefetching} onRefresh={() => void inbox.refetch()} tintColor={t.brand} />}>
      <Stack.Screen options={{ title: "Approvals" }} />
      {!online ? <Notice tone="warn" text="No signal. Approvals are read and decided live." /> : null}
      {inbox.isPending && online ? <Loading /> : null}
      {inbox.isError && !d ? <LoadError error={inbox.error} onRetry={() => inbox.refetch()} /> : null}
      {empty ? <Empty title="Nothing waiting on you" /> : null}

      {d && d.crewSubmissionsWaiting > 0 ? (
        <Pressable accessibilityRole="button" onPress={() => router.push("/crew-submissions")} style={{ minHeight: TOUCH + 8, flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: t.warn, backgroundColor: t.card }}>
          <Ionicons name="people-outline" size={22} color={t.warn} />
          <Text style={[s.body, { color: t.text, flex: 1, fontWeight: "600" }]}>
            {d.crewSubmissionsWaiting} from crews to review
          </Text>
          <Ionicons name="chevron-forward" size={18} color={t.muted} />
        </Pressable>
      ) : null}

      {d?.expenses.length ? <Text style={[s.h2, { color: t.text }]}>Charges to approve · {d.expenses.length}</Text> : null}
      {(d?.expenses ?? []).map((e) => (
        <ExpenseCard key={e.id} e={e} />
      ))}

      {d?.logs.length ? <Text style={[s.h2, { color: t.text }]}>Daily logs to approve · {d.logs.length}</Text> : null}
      {(d?.logs ?? []).map((l) => (
        <LogCard key={l.id} l={l} />
      ))}

      {d?.paymentRequests.length ? <Text style={[s.h2, { color: t.text }]}>Crew payments waiting · {d.paymentRequests.length}</Text> : null}
      {(d?.paymentRequests ?? []).map((r) => (
        <Card key={r.id}>
          <Text style={[s.body, { color: t.text, fontWeight: "600" }]}>
            {r.crew} · {dollars(r.amount)}
          </Text>
          <Text style={{ color: t.muted, fontSize: 13 }}>
            {r.street}
            {r.neededBy ? ` · needed ${shortDate(r.neededBy)}` : ""}
          </Text>
        </Card>
      ))}
      {d?.paymentRequests.length ? <Text style={{ color: t.muted, fontSize: 13 }}>Payments are recorded on the web, under the job&apos;s Field → Labor.</Text> : null}
    </ScrollView>
  );
}

function useDecide() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const run = async (path: string, body?: unknown) => {
    setBusy(true);
    try {
      await api(path, { method: "POST", body: body ?? {} });
      await qc.invalidateQueries({ queryKey: ["approvals"] });
      return true;
    } catch (e) {
      Alert.alert("Not saved", e instanceof ApiError ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

function NoteBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const t = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      accessibilityLabel={placeholder}
      placeholderTextColor={t.muted}
      multiline
      style={{ minHeight: TOUCH, borderRadius: 10, borderWidth: 1, borderColor: t.border, backgroundColor: t.bg, color: t.text, padding: 10, fontSize: 16 }}
    />
  );
}

function ExpenseCard({ e }: { e: ApprovalsInboxDto["expenses"][number] }) {
  const t = useTheme();
  const { busy, run } = useDecide();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
        <Text style={[s.body, { color: t.text, fontWeight: "600", flex: 1 }]}>{e.vendor ?? e.type.replace(/_/g, " ").toLowerCase()}</Text>
        <Text style={{ color: t.text, fontSize: 18, fontWeight: "700" }}>{dollars(e.amount)}</Text>
      </View>
      <Text style={{ color: t.muted, fontSize: 13 }}>
        {e.street} · {shortDate(e.date)} · by {e.enteredBy}
        {e.receipts ? ` · ${e.receipts} receipt${e.receipts === 1 ? "" : "s"}` : " · no receipt"}
      </Text>
      {e.description ? <Text style={[s.body, { color: t.text }]}>{e.description}</Text> : null}
      {rejecting ? (
        <View style={{ gap: 8 }}>
          <NoteBox value={note} onChange={setNote} placeholder="Why it is rejected" />
          <Button label="Reject" kind="danger" disabled={busy || !note.trim()} onPress={() => void run(`/api/expenses/${e.id}/review`, { decision: "REJECT", note: note.trim() })} />
          <Button label="Cancel" kind="secondary" onPress={() => setRejecting(false)} />
        </View>
      ) : (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 2 }}>
            <Button label="Approve" disabled={busy} onPress={() => void run(`/api/expenses/${e.id}/review`, { decision: "APPROVE" })} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="Reject…" kind="secondary" disabled={busy} onPress={() => setRejecting(true)} />
          </View>
        </View>
      )}
    </Card>
  );
}

function LogCard({ l }: { l: ApprovalsInboxDto["logs"][number] }) {
  const t = useTheme();
  const router = useRouter();
  const { busy, run } = useDecide();
  const [returning, setReturning] = useState(false);
  const [note, setNote] = useState("");
  return (
    <Card>
      <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: "/log/[jobId]", params: { jobId: l.jobId, date: l.date } })}>
        <Text style={[s.body, { color: t.text, fontWeight: "600" }]}>
          {l.street} · {shortDate(`${l.date}T12:00:00.000Z`)} ›
        </Text>
      </Pressable>
      <Text style={{ color: t.muted, fontSize: 13 }}>
        {l.submittedBy ? `From ${l.submittedBy}` : "Submitted"} · {l.crewEntries} crew {l.crewEntries === 1 ? "entry" : "entries"}
      </Text>
      {l.workPerformed ? <Text style={[s.body, { color: t.text }]}>{l.workPerformed}</Text> : null}
      {returning ? (
        <View style={{ gap: 8 }}>
          <NoteBox value={note} onChange={setNote} placeholder="What needs fixing (the crew lead sees this)" />
          <Button label="Send back" kind="danger" disabled={busy || !note.trim()} onPress={() => void run(`/api/jobs/${l.jobId}/daily-logs/${l.date}/return`, { note: note.trim() })} />
          <Button label="Cancel" kind="secondary" onPress={() => setReturning(false)} />
        </View>
      ) : (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 2 }}>
            <Button label="Approve" disabled={busy} onPress={() => void run(`/api/jobs/${l.jobId}/daily-logs/${l.date}/approve`)} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="Send back…" kind="secondary" disabled={busy} onPress={() => setReturning(true)} />
          </View>
        </View>
      )}
    </Card>
  );
}
