import { track } from "@/usage/track";
import { useState } from "react";
import { Alert, Image, Pressable, RefreshControl, ScrollView, Share, Text, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import Ionicons from "@expo/vector-icons/Ionicons";
import { createPaymentRequestBody, guestLinkCreated, statusLabel, type PhoneLaborContractDto } from "@crm/mobile-api";
import { api, ApiError } from "@/api/client";
import { useJob, useLaborContracts, usePaymentRequests } from "@/api/queries";
import { useOnline } from "@/cache/net";
import { contractName, contractTotals, dollars, parseAmount } from "@/lib/crewpay";
import { addDays, addressLine, dayKey, shortDate } from "@/lib/format";
import { useOutbox } from "@/outbox/useOutbox";
import { preparePhoto } from "@/photos/prepare";
import { Button, Card, Notice, s } from "@/ui/components";
import { Chips } from "@/ui/Chips";
import { Empty, LoadError, Loading } from "@/ui/states";
import { TOUCH, useTheme } from "@/ui/theme";


/**
 * A job's crew contracts on the phone: what each is worth, what has been
 * paid, what is left, and the payment requests — with "Request a payment"
 * (amount, needed by, a note, completion photos). The request is a task for
 * the job's accounting person, exactly as from the web; recording the payment
 * stays in the office. Full money viewers only (office roles, the job's PM).
 */
export default function CrewPayments() {
  const t = useTheme();
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const job = useJob(jobId);
  const full = job.data?.moneyView === "full";
  const contracts = useLaborContracts(jobId, full);
  const address = addressLine(job.data?.lead) ?? job.data?.jobNumber ?? "Job";

  if (job.isPending) return <Loading />;
  if (!full)
    return (
      <View style={{ padding: 16, backgroundColor: t.bg, flex: 1 }}>
        <Empty title="Not for your role" body="Crew pay is shown to the office and the job's project manager." />
      </View>
    );

  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={s.scroll}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      refreshControl={<RefreshControl refreshing={contracts.isRefetching} onRefresh={() => void contracts.refetch()} tintColor={t.brand} />}
    >
      <Stack.Screen options={{ title: `Crew payments · ${address}` }} />
      {contracts.isPending ? (
        <Loading />
      ) : contracts.isError && !contracts.data ? (
        <LoadError error={contracts.error} noun="crew contract list" onRetry={() => contracts.refetch()} />
      ) : contracts.data && contracts.data.length === 0 ? (
        <Empty title="No crew contracts on this job" body="Crew contracts are set up on the web, under the job's Field → Labor." />
      ) : (
        (contracts.data ?? []).map((c) => <ContractCard key={c.id} contract={c} jobId={jobId} address={address} />)
      )}
      <Text style={{ color: t.muted, fontSize: 13 }}>
        A request becomes a task for the job's accounting person. Payments are recorded in the office. Crew pay is read live and not kept on this phone.
      </Text>
    </ScrollView>
  );
}

/**
 * A crew link (payment request or photos) sent with the phone's own share
 * sheet: text or WhatsApp, from your number, in the crew's language. What the
 * crew sends waits under More → From crews until someone accepts it.
 */
function sendLink(contractId: string, crewName: string) {
  const make = async (purpose: "CREW_PAYMENT" | "CREW_PHOTOS") => {
    try {
      const link = await api("/api/guest-links", { method: "POST", body: { purpose, laborContractId: contractId }, schema: guestLinkCreated });
      track("crew_link_sent");
      await Share.share({ message: link.message });
    } catch (e) {
      Alert.alert("Couldn't make the link", e instanceof ApiError ? e.message : String(e));
    }
  };
  Alert.alert(`Link for ${crewName}`, "What should the crew send? The link works once.", [
    { text: "Payment request with photos", onPress: () => void make("CREW_PAYMENT") },
    { text: "Photos of the work", onPress: () => void make("CREW_PHOTOS") },
    { text: "Cancel", style: "cancel" },
  ]);
}

function ContractCard({ contract: c, jobId, address }: { contract: PhoneLaborContractDto; jobId: string; address: string }) {
  const t = useTheme();
  const qc = useQueryClient();
  const online = useOnline();
  const outbox = useOutbox();
  const requests = usePaymentRequests(c.id);
  const { total, paid, remaining } = contractTotals(c);
  const name = contractName(c);
  const [asking, setAsking] = useState(false);
  const [amount, setAmount] = useState("");
  const [needed, setNeeded] = useState<"today" | "tomorrow" | "week" | "none">("week");
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [sending, setSending] = useState(false);
  const open = (requests.data?.requests ?? []).filter((r) => r.status === "REQUESTED");
  const recent = (requests.data?.requests ?? []).filter((r) => r.status !== "REQUESTED").slice(0, 3);

  const addPhotos = async (camera: boolean) => {
    if (camera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return Alert.alert("Camera is off for KNU Field", "Turn it on in Settings → KNU Field → Camera.");
    }
    const r = camera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: "images", exif: true, quality: 1 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: "images", allowsMultipleSelection: true, selectionLimit: 10, exif: true, quality: 1 });
    if (!r.canceled) setPhotos((p) => [...p, ...r.assets]);
  };

  const send = async () => {
    const value = parseAmount(amount);
    if (value == null) return Alert.alert("Enter the amount", "The amount to pay the crew, e.g. 4,000.");
    if (value > remaining + 0.005 && remaining > 0)
      return Alert.alert("More than what's left", `${name}'s contract has ${dollars(remaining)} left. Ask the office to add a change order first.`);
    const neededBy = needed === "today" ? dayKey() : needed === "tomorrow" ? addDays(dayKey(), 1) : needed === "week" ? addDays(dayKey(), 7) : undefined;
    const body = createPaymentRequestBody.safeParse({ amount: value, ...(note.trim() ? { note: note.trim() } : {}), ...(neededBy ? { neededBy } : {}) });
    if (!body.success) return Alert.alert("Check the request", body.error.issues[0]?.message ?? "Something is not right");
    setSending(true);
    try {
      // Sent now (a money request should be confirmed, not left in a queue); a resend with this key is never a second request.
      const created = (await api(`/api/labor-contracts/${encodeURIComponent(c.id)}/payment-requests`, {
        method: "POST",
        body: body.data,
        idempotencyKey: Crypto.randomUUID(),
      })) as { id: string };
      for (const a of photos) {
        const p = await preparePhoto(a);
        const fields: Record<string, string> = { laborPaymentRequestId: created.id, category: "PHOTOS" };
        if (p.takenAt) fields.takenAt = p.takenAt;
        await outbox.enqueue({ kind: "file.upload", targetId: `payreq:${created.id}`, method: "POST", path: "/api/files", body: { filePath: p.path, fields }, label: `Completion photo · ${name} · ${address}` });
      }
      setAsking(false);
      setAmount("");
      setNote("");
      setPhotos([]);
      await qc.invalidateQueries({ queryKey: ["paymentRequests", c.id] });
      Alert.alert("Request sent", `${dollars(value)} for ${name}. The accounting person has a task to pay it.${photos.length ? " Photos are being sent." : ""}`);
    } catch (e) {
      Alert.alert("Not sent", e instanceof ApiError ? (e.offline ? "No signal. Try again when you're connected." : e.message) : String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <Card>
      <Text style={[s.h2, { color: t.text }]}>{name}</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {[
          ["Contract", total],
          ["Paid", paid],
          ["Left", remaining],
        ].map(([label, v]) => (
          <View key={label as string} style={{ flex: 1 }}>
            <Text style={{ color: t.muted, fontSize: 12 }}>{label}</Text>
            <Text style={{ color: t.text, fontSize: 15, fontWeight: "700" }}>{dollars(v as number)}</Text>
          </View>
        ))}
      </View>

      {open.map((r) => (
        <Text key={r.id} style={{ color: t.warn, fontSize: 14 }}>
          {dollars(r.amount)} requested{r.neededBy ? ` · needed ${shortDate(r.neededBy)}` : ""} · {statusLabel("paymentRequest", r.status)}
        </Text>
      ))}
      {recent.map((r) => (
        <Text key={r.id} style={{ color: t.muted, fontSize: 13 }}>
          {dollars(r.amount)} · {statusLabel("paymentRequest", r.status)} · {shortDate(r.createdAt)}
        </Text>
      ))}

      <Button label="Send a link to the crew…" kind="secondary" disabled={!online} onPress={() => sendLink(c.id, name)} />
      {asking ? (
        <View style={{ gap: 10, marginTop: 6 }}>
          <Text style={[s.label, { color: t.muted }]}>Amount</Text>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            placeholder="e.g. 4,000"
            placeholderTextColor={t.muted}
            accessibilityLabel="Amount to pay"
            style={{ minHeight: TOUCH, borderRadius: 10, borderWidth: 1, borderColor: t.border, backgroundColor: t.bg, color: t.text, paddingHorizontal: 12, fontSize: 18 }}
          />
          <Chips
            label="Needed by"
            value={needed}
            onChange={setNeeded}
            options={[
              { value: "today", label: "Today" },
              { value: "tomorrow", label: "Tomorrow" },
              { value: "week", label: "In a week" },
              { value: "none", label: "No date" },
            ]}
          />
          <TextInput
            value={note}
            onChangeText={setNote}
            multiline
            maxLength={2000}
            placeholder="What it's for (e.g. framing complete, 2nd floor)"
            placeholderTextColor={t.muted}
            accessibilityLabel="Note"
            style={{ minHeight: TOUCH * 1.5, borderRadius: 10, borderWidth: 1, borderColor: t.border, backgroundColor: t.bg, color: t.text, padding: 12, fontSize: 16, textAlignVertical: "top" }}
          />
          <Text style={[s.label, { color: t.muted }]}>Completion photos (optional)</Text>
          {photos.length ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {photos.map((p, i) => (
                <Pressable key={`${p.uri}${i}`} accessibilityRole="button" accessibilityLabel="Remove photo" onPress={() => setPhotos((x) => x.filter((_, j) => j !== i))}>
                  <Image source={{ uri: p.uri }} style={{ width: 64, height: 64, borderRadius: 8 }} />
                  <Ionicons name="close-circle" size={20} color="#fff" style={{ position: "absolute", top: 2, right: 2 }} />
                </Pressable>
              ))}
            </View>
          ) : null}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button label="Take photo" kind="secondary" onPress={() => void addPhotos(true)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="From library" kind="secondary" onPress={() => void addPhotos(false)} />
            </View>
          </View>
          {!online ? <Notice tone="warn" text="No signal: a payment request is sent right away, so it needs a connection." /> : null}
          <Button label={sending ? "Sending…" : "Send request"} disabled={sending || !online || !amount.trim()} onPress={() => void send()} />
          <Button label="Cancel" kind="secondary" onPress={() => setAsking(false)} />
        </View>
      ) : (
        <Button label="Request a payment" kind="secondary" onPress={() => setAsking(true)} />
      )}
    </Card>
  );
}
