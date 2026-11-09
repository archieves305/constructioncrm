import { useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { crewSubmissions, type CrewSubmissionDto } from "@crm/mobile-api";
import { api, ApiError } from "@/api/client";
import { useOnline } from "@/cache/net";
import { dollars } from "@/lib/crewpay";
import { shortDate } from "@/lib/format";
import { AuthImage } from "@/ui/AuthImage";
import { Button, Card, Notice, s } from "@/ui/components";
import { Empty, LoadError, Loading } from "@/ui/states";
import { TOUCH, useTheme } from "@/ui/theme";

const WHAT = { CREW_PHOTOS: "Photos of the work", CREW_PAYMENT: "Payment request", INSTALL_CONFIRM: "Install day answer" } as const;
const DAY = { yes: "Will be there", no: "Can't make it", change: "Needs a different day" } as const;

/**
 * What crews sent through their links, to accept or reject. Accepting makes it
 * count (photos join the job's files, a payment request goes to accounting, a
 * day answer is recorded). Read live, never kept on the phone.
 */
export default function CrewSubmissions() {
  const t = useTheme();
  const online = useOnline();
  const list = useQuery({ queryKey: ["crewSubmissions"], queryFn: () => api("/api/guest-submissions", { schema: crewSubmissions }) });
  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={s.scroll}
      refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} tintColor={t.brand} />}
    >
      <Stack.Screen options={{ title: "From crews" }} />
      {!online ? <Notice tone="warn" text="No signal. Crew submissions are read live." /> : null}
      {list.isPending && online ? <Loading /> : null}
      {list.isError && !list.data ? <LoadError error={list.error} onRetry={() => list.refetch()} /> : null}
      {list.data && list.data.length === 0 ? <Empty title="Nothing waiting" body="Send a crew a link from a job's Crew payments." /> : null}
      {(list.data ?? []).map((sub) => (
        <SubmissionCard key={sub.id} sub={sub} />
      ))}
    </ScrollView>
  );
}

function SubmissionCard({ sub }: { sub: CrewSubmissionDto }) {
  const t = useTheme();
  const qc = useQueryClient();
  const router = useRouter();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const decide = async (decision: "accept" | "reject") => {
    setBusy(true);
    try {
      await api(`/api/guest-submissions/${sub.id}`, { method: "POST", body: decision === "reject" ? { decision, note: reason.trim() } : { decision } });
      await qc.invalidateQueries({ queryKey: ["crewSubmissions"] });
      if (decision === "accept" && sub.purpose === "CREW_PAYMENT") Alert.alert("Accepted", "The payment request went to the job's accounting person.");
    } catch (e) {
      Alert.alert("Not saved", e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: "/job/[id]", params: { id: sub.jobId } })}>
        <Text style={[s.body, { color: t.text, fontWeight: "700" }]}>{sub.street}</Text>
      </Pressable>
      <Text style={{ color: t.muted, fontSize: 14 }}>
        {WHAT[sub.purpose]} from {sub.from ?? "a crew"} · {shortDate(sub.createdAt)}
        {sub.language === "es" ? " · in Spanish" : ""}
      </Text>
      {sub.purpose === "CREW_PAYMENT" && typeof sub.answer.amount === "number" ? <Text style={{ color: t.text, fontSize: 24, fontWeight: "700" }}>{dollars(sub.answer.amount)}</Text> : null}
      {sub.purpose === "INSTALL_CONFIRM" && sub.answer.answer ? <Text style={{ color: sub.answer.answer === "yes" ? t.ok : t.warn, fontSize: 17, fontWeight: "700" }}>{DAY[sub.answer.answer]}</Text> : null}
      {sub.answer.note ? <Text style={[s.body, { color: t.text, fontStyle: "italic" }]}>“{sub.answer.note}”</Text> : null}
      {sub.photoCount ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {Array.from({ length: sub.photoCount }).map((_, n) => (
            <AuthImage key={n} path={`/api/guest-submissions/${sub.id}/photos/${n}`} style={{ width: 96, height: 96, borderRadius: 8 }} />
          ))}
        </View>
      ) : null}
      {rejecting ? (
        <View style={{ gap: 8 }}>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="Why (the crew can be told)"
            placeholderTextColor={t.muted}
            accessibilityLabel="Reason for rejecting"
            style={{ minHeight: TOUCH, borderRadius: 10, borderWidth: 1, borderColor: t.border, backgroundColor: t.bg, color: t.text, paddingHorizontal: 12, fontSize: 16 }}
          />
          <Button label="Reject" kind="danger" disabled={busy || !reason.trim()} onPress={() => void decide("reject")} />
          <Button label="Cancel" kind="secondary" onPress={() => setRejecting(false)} />
        </View>
      ) : (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 2 }}>
            <Button label={sub.purpose === "CREW_PAYMENT" ? "Accept, send to accounting" : "Accept"} disabled={busy} onPress={() => void decide("accept")} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="Reject…" kind="secondary" disabled={busy} onPress={() => setRejecting(true)} />
          </View>
        </View>
      )}
    </Card>
  );
}
