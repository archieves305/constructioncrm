import { track } from "@/usage/track";
import { useState } from "react";
import { Alert, Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import Ionicons from "@expo/vector-icons/Ionicons";
import { createExpenseRequest, PHONE_EXPENSE_TYPES } from "@crm/mobile-api";
import { useJob } from "@/api/queries";
import { parseAmount } from "@/lib/crewpay";
import { addDays, addressLine, dayKey } from "@/lib/format";
import { clientId } from "@/lib/ids";
import { useOutbox } from "@/outbox/useOutbox";
import { preparePhoto } from "@/photos/prepare";
import { Button, Notice, s } from "@/ui/components";
import { Chips } from "@/ui/Chips";
import { Loading } from "@/ui/states";
import { TOUCH, useTheme } from "@/ui/theme";

const TYPE_LABEL: Record<(typeof PHONE_EXPENSE_TYPES)[number], string> = { MATERIAL: "Materials", EQUIPMENT: "Equipment", PERMIT_FEE: "Permit fee", OTHER: "Other" };

/**
 * A purchase for the job, with its receipt photo: queued, so it works at the
 * store without signal. The receipt is attached to the charge once it is in.
 * Whether it counts at once or waits for approval is the CRM's rule (office
 * roles approve their own; everyone else's waits under Approvals).
 */
export default function NewExpense() {
  const t = useTheme();
  const router = useRouter();
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const job = useJob(jobId);
  const outbox = useOutbox();
  const [amount, setAmount] = useState("");
  const [vendor, setVendor] = useState("");
  const [type, setType] = useState<(typeof PHONE_EXPENSE_TYPES)[number]>("MATERIAL");
  const [day, setDay] = useState<"today" | "yesterday">("today");
  const [note, setNote] = useState("");
  const [receipts, setReceipts] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [saving, setSaving] = useState(false);
  const address = addressLine(job.data?.lead) ?? job.data?.jobNumber ?? "job";

  const addReceipt = async (camera: boolean) => {
    if (camera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return Alert.alert("Camera is off for KNU Field", "Turn it on in Settings → KNU Field → Camera.");
    }
    const r = camera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: "images", quality: 1 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: "images", allowsMultipleSelection: true, selectionLimit: 5, quality: 1 });
    if (!r.canceled) setReceipts((x) => [...x, ...r.assets].slice(0, 5));
  };

  const save = async () => {
    const value = parseAmount(amount);
    if (value == null) return Alert.alert("Enter the amount", "What the receipt says, e.g. 182.40.");
    const id = clientId();
    const body = createExpenseRequest.safeParse({
      id,
      type,
      amount: value,
      incurredDate: day === "today" ? dayKey() : addDays(dayKey(), -1),
      ...(vendor.trim() ? { vendor: vendor.trim() } : {}),
      ...(note.trim() ? { description: note.trim() } : {}),
    });
    if (!body.success) return Alert.alert("Check the expense", body.error.issues[0]?.message ?? "Something is not right");
    setSaving(true);
    try {
      const target = `expense:${id}`;
      const label = `Expense · ${vendor.trim() || TYPE_LABEL[type]} · ${address}`;
      await outbox.enqueue({ kind: "expense.create", targetId: target, method: "POST", path: `/api/jobs/${jobId}/expenses`, body: body.data, label });
      for (const r of receipts) {
        const p = await preparePhoto(r);
        // Behind the charge in its lane: sent only once the charge exists.
        await outbox.enqueue({ kind: "file.upload", targetId: target, method: "POST", path: "/api/files", body: { filePath: p.path, fields: { expenseId: id, category: "RECEIPT" } }, label: `Receipt · ${label}` });
      }
      track("expense_added");
      router.back();
    } finally {
      setSaving(false);
    }
  };

  if (job.isPending) return <Loading />;
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets keyboardDismissMode="on-drag">
      <Stack.Screen options={{ title: "Add an expense" }} />
      <Text style={{ color: t.muted, fontSize: 15 }}>{address}</Text>
      <Text style={[s.label, { color: t.muted }]}>Amount</Text>
      <TextInput
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        placeholder="182.40"
        placeholderTextColor={t.muted}
        accessibilityLabel="Amount"
        autoFocus
        style={{ minHeight: TOUCH, borderRadius: 10, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, color: t.text, paddingHorizontal: 12, fontSize: 22 }}
      />
      <TextInput
        value={vendor}
        onChangeText={setVendor}
        placeholder="Store or vendor (e.g. Home Depot)"
        placeholderTextColor={t.muted}
        maxLength={120}
        accessibilityLabel="Store or vendor"
        style={{ minHeight: TOUCH, borderRadius: 10, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, color: t.text, paddingHorizontal: 12, fontSize: 16 }}
      />
      <Chips label="What for" value={type} onChange={setType} options={PHONE_EXPENSE_TYPES.map((v) => ({ value: v, label: TYPE_LABEL[v] }))} />
      <Chips label="When" value={day} onChange={setDay} options={[{ value: "today", label: "Today" }, { value: "yesterday", label: "Yesterday" }]} />
      <TextInput
        value={note}
        onChangeText={setNote}
        multiline
        maxLength={2000}
        placeholder="What was bought (optional)"
        placeholderTextColor={t.muted}
        accessibilityLabel="Note"
        style={{ minHeight: TOUCH * 1.5, borderRadius: 10, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, color: t.text, padding: 12, fontSize: 16, textAlignVertical: "top" }}
      />
      <Text style={[s.label, { color: t.muted }]}>Receipt</Text>
      {receipts.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {receipts.map((r, i) => (
            <Pressable key={`${r.uri}${i}`} accessibilityRole="button" accessibilityLabel="Remove receipt photo" onPress={() => setReceipts((x) => x.filter((_, j) => j !== i))}>
              <Image source={{ uri: r.uri }} style={{ width: 72, height: 72, borderRadius: 8 }} />
              <Ionicons name="close-circle" size={20} color="#fff" style={{ position: "absolute", top: 2, right: 2 }} />
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button label="Photo of receipt" kind="secondary" onPress={() => void addReceipt(true)} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="From library" kind="secondary" onPress={() => void addReceipt(false)} />
        </View>
      </View>
      {!receipts.length ? <Notice text="A receipt photo saves the office a question later." /> : null}
      <Button label={saving ? "Saving…" : "Save expense"} disabled={saving || !amount.trim()} onPress={() => void save()} />
      <Text style={{ color: t.muted, fontSize: 13 }}>Saved on this phone and sent when there is signal. Charges from most roles wait for the office to approve them.</Text>
    </ScrollView>
  );
}
