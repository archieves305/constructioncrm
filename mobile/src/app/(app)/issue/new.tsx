import { useMemo, useState } from "react";
import { Alert, FlatList, Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { assignableUsers, createFieldIssueRequest, issueDescription, type FieldIssueDto } from "@crm/mobile-api";
import { api } from "@/api/client";
import { useMyJobs } from "@/api/queries";
import { useSession } from "@/auth/session";
import { addDays, addressLine, dayKey } from "@/lib/format";
import { clientId } from "@/lib/ids";
import { preparePhoto } from "@/photos/prepare";
import { useOutbox } from "@/outbox/useOutbox";
import { Chips } from "@/ui/Chips";
import { Button, Notice, s } from "@/ui/components";
import { Loading } from "@/ui/states";
import { TOUCH, useTheme } from "@/ui/theme";

type Shot = { key: string; asset: ImagePicker.ImagePickerAsset };
type IssueType = FieldIssueDto["type"];

const TYPES: { value: IssueType; label: string }[] = [
  { value: "PUNCH", label: "Punch item" },
  { value: "SAFETY", label: "Safety" },
  { value: "MATERIAL_REQUEST", label: "Materials" },
  { value: "OFFICE_FOLLOW_UP", label: "Office follow-up" },
  { value: "CO_REVIEW", label: "Change order" },
];

/**
 * Report a field issue or punch item: photo first, then what and where, who
 * fixes it and by when. The issue and its photos are queued together (the
 * photos wait for the issue), so this works without signal. The CRM makes
 * the issue's task for the person it is assigned to.
 */
export default function NewIssue() {
  const t = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ jobId?: string }>();
  const { user } = useSession();
  const outbox = useOutbox();
  const jobs = useMyJobs();
  const users = useQuery({ queryKey: ["users", "assignable"], queryFn: () => api("/api/users/assignable", { schema: assignableUsers }) });

  const [jobId, setJobId] = useState(params.jobId ?? "");
  const [shots, setShots] = useState<Shot[]>([]);
  const [type, setType] = useState<IssueType>("PUNCH");
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [details, setDetails] = useState("");
  const [assignee, setAssignee] = useState<string>("");
  const [due, setDue] = useState<"none" | "tomorrow" | "week">("week");
  const [priority, setPriority] = useState<"MEDIUM" | "HIGH" | "URGENT">("MEDIUM");
  const [saving, setSaving] = useState(false);

  const job = jobs.data?.data.find((j) => j.id === jobId);
  const people = useMemo(() => {
    const list = users.data ?? [];
    const me = list.find((u) => u.id === user?.id);
    return me ? [me, ...list.filter((u) => u.id !== user?.id)] : list;
  }, [users.data, user?.id]);

  const add = (assets: ImagePicker.ImagePickerAsset[]) =>
    setShots((cur) => [...cur, ...assets.map((asset) => ({ key: `${asset.uri}-${Math.random()}`, asset }))]);
  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return Alert.alert("Camera is off for KNU Field", "Turn it on in Settings → KNU Field → Camera.");
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: "images", exif: true, quality: 1 });
    if (!r.canceled) add(r.assets);
  };
  const pickPhotos = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: "images", allowsMultipleSelection: true, selectionLimit: 10, exif: true, quality: 1 });
    if (!r.canceled) add(r.assets);
  };

  const save = async () => {
    const id = clientId();
    const dueKey = due === "tomorrow" ? addDays(dayKey(), 1) : due === "week" ? addDays(dayKey(), 7) : null;
    const body = createFieldIssueRequest.safeParse({
      id,
      type,
      title: title.trim(),
      description: issueDescription(location, details),
      priority,
      ...(assignee ? { assignedUserId: assignee } : {}),
      ...(dueKey ? { dueAt: `${dueKey}T16:00:00.000Z` } : {}),
    });
    if (!body.success) return Alert.alert("Check the issue", body.error.issues[0]?.message ?? "Something is missing");
    setSaving(true);
    try {
      const target = `issue:${id}`;
      const label = `${TYPES.find((x) => x.value === type)?.label ?? "Issue"} · ${body.data.title}`;
      await outbox.enqueue({ kind: "issue.create", targetId: target, method: "POST", path: `/api/jobs/${jobId}/field-issues`, body: body.data, label });
      for (const shot of shots) {
        const p = await preparePhoto(shot.asset);
        const fields: Record<string, string> = { fieldIssueId: id, category: "PHOTOS" };
        if (p.takenAt) fields.takenAt = p.takenAt;
        await outbox.enqueue({ kind: "file.upload", targetId: target, method: "POST", path: "/api/files", body: { filePath: p.path, fields }, label: `Photo · ${label}` });
      }
      router.back();
    } catch (e) {
      Alert.alert("Couldn't save the issue", e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (!jobId) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <Stack.Screen options={{ title: "Issue on which job?" }} />
        {jobs.isPending ? (
          <Loading />
        ) : (
          <FlatList
            data={jobs.data?.data ?? []}
            keyExtractor={(j) => j.id}
            contentContainerStyle={{ padding: 16, gap: 8 }}
            ListEmptyComponent={<Notice text="You have no open jobs to report an issue on." />}
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                onPress={() => setJobId(item.id)}
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
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={s.scroll}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      keyboardDismissMode="on-drag"
    >
      <Stack.Screen options={{ title: "Report an issue" }} />
      {job ? <Text style={{ color: t.muted, fontSize: 15 }}>{addressLine(job.lead) ?? job.jobNumber}</Text> : null}

      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Button label="Take photo" onPress={() => void takePhoto()} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="From library" kind="secondary" onPress={() => void pickPhotos()} />
        </View>
      </View>
      {shots.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {shots.map((shot) => (
            <View key={shot.key}>
              <Image source={{ uri: shot.asset.uri }} style={{ width: 88, height: 88, borderRadius: 8 }} />
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
      ) : null}

      <Chips label="What kind" value={type} onChange={setType} options={TYPES} />

      <View style={{ gap: 6 }}>
        <Text style={[s.label, { color: t.muted }]}>What's wrong</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="e.g. Cracked grout by the kitchen sink"
          placeholderTextColor={t.muted}
          accessibilityLabel="What's wrong"
          style={{ minHeight: TOUCH, borderRadius: 10, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, color: t.text, paddingHorizontal: 12, fontSize: 17 }}
        />
        <TextInput
          value={location}
          onChangeText={setLocation}
          placeholder="Where (e.g. Unit 2, kitchen)"
          placeholderTextColor={t.muted}
          accessibilityLabel="Where"
          style={{ minHeight: TOUCH, borderRadius: 10, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, color: t.text, paddingHorizontal: 12, fontSize: 16 }}
        />
        <TextInput
          value={details}
          onChangeText={setDetails}
          placeholder="Details (optional)"
          placeholderTextColor={t.muted}
          multiline
          accessibilityLabel="Details"
          style={{ minHeight: TOUCH * 1.5, borderRadius: 10, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, color: t.text, padding: 12, fontSize: 16, textAlignVertical: "top" }}
        />
      </View>

      <Chips
        label="Who fixes it"
        value={assignee}
        onChange={setAssignee}
        options={[{ value: "", label: "Office decides" }, ...people.slice(0, 7).map((u) => ({ value: u.id, label: u.id === user?.id ? "Me" : `${u.firstName} ${u.lastName}`.trim() }))]}
      />
      <Chips
        label="By when"
        value={due}
        onChange={setDue}
        options={[
          { value: "tomorrow", label: "Tomorrow" },
          { value: "week", label: "In a week" },
          { value: "none", label: "No date" },
        ]}
      />
      <Chips
        label="How urgent"
        value={priority}
        onChange={setPriority}
        options={[
          { value: "MEDIUM", label: "Normal" },
          { value: "HIGH", label: "High" },
          { value: "URGENT", label: "Urgent" },
        ]}
      />

      <Button
        label={shots.length ? `Report with ${shots.length} ${shots.length === 1 ? "photo" : "photos"}` : "Report issue"}
        disabled={!title.trim()}
        busy={saving}
        onPress={() => void save()}
      />
      <Text style={{ color: t.muted, fontSize: 13 }}>
        The issue becomes a task for the person who fixes it. It and its photos are kept on this phone until they reach the CRM.
      </Text>
    </ScrollView>
  );
}
