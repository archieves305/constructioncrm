import { useState } from "react";
import { Alert, FlatList, Image, Pressable, ScrollView, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useMyJobs } from "@/api/queries";
import { addressLine } from "@/lib/format";
import { preparePhoto } from "@/photos/prepare";
import { useOutbox } from "@/outbox/useOutbox";
import { Button, Card, Notice, s } from "@/ui/components";
import { Chips } from "@/ui/Chips";
import { Loading } from "@/ui/states";
import { TOUCH, useTheme } from "@/ui/theme";

type Shot = { key: string; asset: ImagePicker.ImagePickerAsset };

/**
 * Take or pick photos and attach them to a job or a task. Opened from a task
 * (taskId), a job (jobId) or the Add sheet (no target: pick a job first).
 * Photos are shrunk, kept on the phone and sent by the outbox.
 */
export default function PhotoScreen() {
  const t = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ jobId?: string; taskId?: string; label?: string }>();
  const outbox = useOutbox();
  const jobs = useMyJobs();
  const [jobId, setJobId] = useState<string | undefined>(params.jobId);
  const [targetLabel, setTargetLabel] = useState<string | undefined>(params.label);
  const [shots, setShots] = useState<Shot[]>([]);
  const [saving, setSaving] = useState(false);
  // Before / during / after: one tap, optional. It tells the office what the photo shows.
  const [phase, setPhase] = useState<"" | "BEFORE" | "DURING" | "AFTER">("");
  const taskId = params.taskId;
  const hasTarget = Boolean(taskId || jobId);

  const add = (assets: ImagePicker.ImagePickerAsset[]) =>
    setShots((cur) => [...cur, ...assets.map((asset) => ({ key: `${asset.uri}-${Math.random()}`, asset }))]);

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Camera is off for KNU Field", "Turn it on in Settings → KNU Field → Camera to take photos here.");
      return;
    }
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: "images", exif: true, quality: 1 });
    if (!r.canceled) add(r.assets);
  };

  const pickPhotos = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: "images", allowsMultipleSelection: true, selectionLimit: 20, exif: true, quality: 1 });
    if (!r.canceled) add(r.assets);
  };

  const save = async () => {
    if (!hasTarget || shots.length === 0) return;
    setSaving(true);
    try {
      for (const shot of shots) {
        const p = await preparePhoto(shot.asset);
        const fields: Record<string, string> = { category: "PHOTOS" };
        if (taskId) fields.taskId = taskId;
        else if (jobId) fields.jobId = jobId;
        if (p.takenAt) fields.takenAt = p.takenAt;
        if (phase) fields.phase = phase;
        await outbox.enqueue({
          kind: "file.upload",
          targetId: taskId ?? jobId!,
          method: "POST",
          path: "/api/files",
          body: { filePath: p.path, fields },
          label: `Photo · ${targetLabel ?? "job"}`,
        });
      }
      router.back();
    } catch (e) {
      Alert.alert("Couldn't save the photos", e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  // No target yet (opened from the Add sheet): choose one of my jobs.
  if (!hasTarget) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <Stack.Screen options={{ title: "Photo for which job?" }} />
        {jobs.isPending ? (
          <Loading />
        ) : (
          <FlatList
            data={jobs.data?.data ?? []}
            keyExtractor={(j) => j.id}
            contentContainerStyle={{ padding: 16, gap: 8 }}
            ListEmptyComponent={<Notice text="You have no open jobs to attach photos to." />}
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setJobId(item.id);
                  setTargetLabel(addressLine(item.lead) ?? item.jobNumber);
                }}
                style={{ minHeight: TOUCH + 8, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, justifyContent: "center" }}
              >
                <Text style={[s.body, { color: t.text, fontWeight: "600" }]}>{addressLine(item.lead) ?? item.title}</Text>
                <Text style={{ color: t.muted, fontSize: 13 }}>
                  {item.lead?.fullName ?? ""} · {item.jobNumber}
                </Text>
              </Pressable>
            )}
          />
        )}
      </View>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={s.scroll}>
      <Stack.Screen options={{ title: "Photos" }} />
      <Card>
        <Text style={[s.label, { color: t.muted }]}>Attaching to</Text>
        <Text style={[s.body, { color: t.text, fontWeight: "600" }]}>{targetLabel ?? "This job"}</Text>
      </Card>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Button label="Take photo" onPress={() => void takePhoto()} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="From library" kind="secondary" onPress={() => void pickPhotos()} />
        </View>
      </View>
      <Chips<"" | "BEFORE" | "DURING" | "AFTER">
        label="These photos show"
        value={phase}
        onChange={setPhase}
        options={[
          { value: "BEFORE", label: "Before" },
          { value: "DURING", label: "During" },
          { value: "AFTER", label: "After" },
          { value: "", label: "Not sure" },
        ]}
      />
      {shots.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {shots.map((shot) => (
            <View key={shot.key}>
              <Image source={{ uri: shot.asset.uri }} style={{ width: 100, height: 100, borderRadius: 8 }} accessibilityIgnoresInvertColors />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Remove this photo"
                onPress={() => setShots((cur) => cur.filter((x) => x.key !== shot.key))}
                hitSlop={8}
                style={{ position: "absolute", top: 4, right: 4, backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 14, width: 28, height: 28, alignItems: "center", justifyContent: "center" }}
              >
                <Ionicons name="close" size={18} color="#fff" />
              </Pressable>
            </View>
          ))}
        </View>
      ) : (
        <Text style={[s.body, { color: t.muted }]}>Take as many photos as you need; they are sent together when you tap Upload.</Text>
      )}
      <Button
        label={shots.length ? `Upload ${shots.length} ${shots.length === 1 ? "photo" : "photos"}` : "Upload"}
        disabled={shots.length === 0}
        busy={saving}
        onPress={() => void save()}
      />
      <Text style={{ color: t.muted, fontSize: 13 }}>
        Photos are kept on this phone until they reach the CRM, even without signal. Location is not sent.
      </Text>
    </ScrollView>
  );
}
