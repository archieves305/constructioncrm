import { useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { taskDraft } from "@crm/mobile-api";
import { api, ApiError } from "@/api/client";
import { useOnline } from "@/cache/net";
import { Button, Card, Notice, s } from "@/ui/components";
import { TOUCH, useTheme } from "@/ui/theme";

/**
 * Say a task. iOS dictation (the microphone on the keyboard) turns speech
 * into text on the phone; the CRM's AI turns the text into a draft; the New
 * task form opens filled, and nothing is created until the person taps
 * Create task. Needs signal: without it, the form is offered to type into.
 */
export default function VoiceTask() {
  const t = useTheme();
  const router = useRouter();
  const online = useOnline();
  const { jobId } = useLocalSearchParams<{ jobId?: string }>();
  const [speech, setSpeech] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draft = async () => {
    setBusy(true);
    setError(null);
    try {
      const d = await api("/api/mobile/ai/task-draft", {
        method: "POST",
        body: { speech: speech.trim(), ...(jobId ? { jobId } : {}) },
        schema: taskDraft,
      });
      router.replace({ pathname: "/new-task", params: { draft: JSON.stringify(d), ...(jobId ? { jobId } : {}) } });
    } catch (e) {
      setError(e instanceof ApiError ? (e.offline ? "No signal. Type the task instead, or try again with signal." : e.message) : "The draft could not be made.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <Stack.Screen options={{ title: "Speak a task" }} />
      <Card>
        <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
          <Ionicons name="mic-outline" size={26} color={t.brand} />
          <Text style={[s.body, { color: t.text, flex: 1 }]}>Tap the microphone on the keyboard and say what needs doing.</Text>
        </View>
        <Text style={{ color: t.muted, fontSize: 14 }}>
          For example: "Order twelve sheets of five-eighths drywall for Wind Trace, Lisette, by Friday."
        </Text>
      </Card>
      <TextInput
        value={speech}
        onChangeText={setSpeech}
        autoFocus
        multiline
        maxLength={4000}
        placeholder="What needs doing…"
        placeholderTextColor={t.muted}
        accessibilityLabel="What needs doing"
        style={{ minHeight: TOUCH * 3, borderRadius: 10, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, color: t.text, padding: 12, fontSize: 17, textAlignVertical: "top" }}
      />
      {!online ? <Notice tone="warn" text="No signal: a draft needs the CRM. You can type the task yourself." /> : null}
      {error ? <Notice tone="danger" text={error} /> : null}
      <Button label={busy ? "Making a draft…" : "Make a draft"} disabled={busy || !online || speech.trim().length < 3} onPress={() => void draft()} />
      <Button label="Type it instead" kind="secondary" onPress={() => router.replace({ pathname: "/new-task", params: jobId ? { jobId } : {} })} />
      <Text style={{ color: t.muted, fontSize: 13 }}>
        The CRM's AI suggests the title, job, person and date. You check it on the next screen; nothing is created until you tap Create task.
      </Text>
    </ScrollView>
  );
}
