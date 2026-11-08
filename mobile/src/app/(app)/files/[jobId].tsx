import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, FlatList, Modal, Pressable, RefreshControl, ScrollView, SectionList, Text, TextInput, useWindowDimensions, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import Ionicons from "@expo/vector-icons/Ionicons";
import { PHONE_DOC_CATEGORIES, UPLOAD_MIME, type GalleryItemDto } from "@crm/mobile-api";
import { useJob, useJobFiles, useJobGallery } from "@/api/queries";
import { SavedNote } from "@/cache/SavedNote";
import { docProblem, docType } from "@/docs/rules";
import { prepareDocument } from "@/docs/prepare";
import { addressLine, shortDate } from "@/lib/format";
import { useOutbox } from "@/outbox/useOutbox";
import type { UploadBody } from "@/outbox/upload";
import { AuthImage } from "@/ui/AuthImage";
import { Button, Card, s } from "@/ui/components";
import { DocList } from "@/ui/DocList";
import { OpRow } from "@/ui/OpRow";
import { Empty, LoadError, Loading } from "@/ui/states";
import { TOUCH, useTheme } from "@/ui/theme";

type Tab = "docs" | "photos";

function dayLabel(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/**
 * A job's files on the phone: its documents (and its customer's), searchable
 * and opened in the phone's viewer; its photos from both stores (daily logs
 * and files) with a full-screen viewer; and documents added from the phone,
 * queued like photos so they wait for signal.
 */
export default function JobFiles() {
  const t = useTheme();
  const router = useRouter();
  const { jobId, tab: tabParam, upload } = useLocalSearchParams<{ jobId: string; tab?: string; upload?: string }>();
  const [tab, setTab] = useState<Tab>(tabParam === "photos" ? "photos" : "docs");
  const [query, setQuery] = useState("");
  const [viewing, setViewing] = useState<number | null>(null);
  const job = useJob(jobId);
  const files = useJobFiles(jobId);
  const gallery = useJobGallery(jobId);
  const outbox = useOutbox();
  const address = addressLine(job.data?.lead) ?? job.data?.jobNumber ?? "Job";

  const allFiles = useMemo(() => [...(files.data?.files ?? []), ...(files.data?.leadFiles ?? [])], [files.data]);
  // Photos are under Photos; an image filed as a document (a scanned permit) stays here too.
  const docs = allFiles.filter((f) => f.category !== "PHOTOS");
  const shown = query.trim() ? docs.filter((f) => f.fileName.toLowerCase().includes(query.trim().toLowerCase())) : docs;
  const photos = gallery.data?.items ?? [];
  const waiting = outbox.ops.filter((o) => o.kind === "file.upload" && (o.body as UploadBody).fields?.jobId === jobId && (o.body as UploadBody).mimeType);

  const pickDocuments = async (category: string) => {
    const r = await DocumentPicker.getDocumentAsync({ type: [...UPLOAD_MIME], multiple: true, copyToCacheDirectory: true });
    if (r.canceled) return;
    const refused: string[] = [];
    for (const a of r.assets) {
      const type = docType(a.name, a.mimeType);
      const problem = docProblem(a.name, a.size, type);
      if (problem || !type) {
        refused.push(problem ?? a.name);
        continue;
      }
      const p = prepareDocument(a);
      await outbox.enqueue({
        kind: "file.upload",
        targetId: jobId,
        method: "POST",
        path: "/api/files",
        body: { filePath: p.path, mimeType: type, fields: { jobId, category } } satisfies UploadBody,
        label: `Document · ${a.name} · ${address}`,
      });
    }
    if (refused.length) Alert.alert("Not added", refused.join("\n"));
  };

  const chooseCategory = () =>
    Alert.alert("File it as", "Contracts and plan sets are added on the web.", [
      ...PHONE_DOC_CATEGORIES.map((c) => ({ text: c.label, onPress: () => void pickDocuments(c.value) })),
      { text: "Cancel", style: "cancel" as const },
    ]);

  // From the Add sheet's "Upload document": straight to the choice.
  const asked = useRef(false);
  useEffect(() => {
    if (upload === "1" && !asked.current) {
      asked.current = true;
      setTimeout(chooseCategory, 300);
    }
  });

  if (job.isPending) return <Loading />;

  const tabs = (
    <View style={{ flexDirection: "row", gap: 8 }} accessibilityRole="tablist">
      {(
        [
          ["docs", `Documents${files.data ? ` · ${docs.length}` : ""}`],
          ["photos", `Photos${gallery.data ? ` · ${photos.length}` : ""}`],
        ] as const
      ).map(([key, label]) => {
        const on = tab === key;
        return (
          <Pressable
            key={key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => setTab(key)}
            style={{ flex: 1, minHeight: TOUCH, borderRadius: 10, borderWidth: 1, borderColor: on ? t.brand : t.border, backgroundColor: on ? t.brandSoft : t.card, alignItems: "center", justifyContent: "center" }}
          >
            <Text style={{ color: on ? t.brand : t.text, fontWeight: on ? "700" : "500", fontSize: 15 }}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );

  if (tab === "docs")
    return (
      <ScrollView
        style={{ backgroundColor: t.bg }}
        contentContainerStyle={s.scroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={files.isRefetching} onRefresh={() => void files.refetch()} tintColor={t.brand} />}
      >
        <Stack.Screen options={{ title: `Files · ${address}` }} />
        <SavedNote />
        {tabs}
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search file names"
          placeholderTextColor={t.muted}
          clearButtonMode="while-editing"
          autoCorrect={false}
          accessibilityLabel="Search file names"
          style={{ minHeight: TOUCH, borderRadius: 10, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, color: t.text, paddingHorizontal: 14, fontSize: 16 }}
        />
        <Button label="Add a document" kind="secondary" onPress={chooseCategory} />
        {waiting.map((op) => (
          <OpRow key={op.id} op={op} />
        ))}
        {files.isPending ? (
          <Loading />
        ) : files.isError && files.data === undefined ? (
          <LoadError error={files.error} onRetry={() => files.refetch()} />
        ) : query.trim() && shown.length === 0 ? (
          <Empty title="No file by that name" />
        ) : (
          <DocList files={shown} hidePhotoCount />
        )}
      </ScrollView>
    );

  // Photos: by day, three across.
  const sections = groupPhotos(photos);
  return (
    <>
      <SectionList
        style={{ backgroundColor: t.bg }}
        contentContainerStyle={{ padding: 16, gap: 6 }}
        sections={sections}
        keyExtractor={(row) => row.map((p) => p.item.key).join("|")}
        stickySectionHeadersEnabled={false}
        refreshControl={<RefreshControl refreshing={gallery.isRefetching} onRefresh={() => void gallery.refetch()} tintColor={t.brand} />}
        ListHeaderComponent={
          <View style={{ gap: 12, marginBottom: 6 }}>
            <Stack.Screen options={{ title: `Files · ${address}` }} />
            <SavedNote />
            {tabs}
            <Button label="Add photos" kind="secondary" onPress={() => router.push({ pathname: "/photo", params: { jobId, label: address } })} />
            {gallery.isPending ? <Loading /> : null}
            {gallery.isError && gallery.data === undefined ? <LoadError error={gallery.error} onRetry={() => gallery.refetch()} /> : null}
            {gallery.data && photos.length === 0 ? <Empty title="No photos on this job yet" body="Photos from tasks, daily logs and the Files tab show here." /> : null}
          </View>
        }
        renderSectionHeader={({ section }) => <Text style={[s.label, { color: t.muted, marginTop: 10 }]}>{section.title}</Text>}
        renderItem={({ item: row }) => (
          <View style={{ flexDirection: "row", gap: 6 }}>
            {row.map(({ item, index }) => (
              <Pressable
                key={item.key}
                accessibilityRole="imagebutton"
                accessibilityLabel={`${item.origin}, ${item.caption ?? item.fileName}`}
                onPress={() => setViewing(index)}
                style={{ flex: 1, aspectRatio: 1 }}
              >
                <AuthImage path={item.url} missing={item.missing} style={{ width: "100%", height: "100%", borderRadius: 8 }} />
              </Pressable>
            ))}
            {Array.from({ length: 3 - row.length }).map((_, i) => (
              <View key={`pad${i}`} style={{ flex: 1 }} />
            ))}
          </View>
        )}
      />
      <PhotoViewer items={photos} index={viewing} onClose={() => setViewing(null)} />
    </>
  );
}

type Cell = { item: GalleryItemDto; index: number };
function groupPhotos(items: GalleryItemDto[]): { title: string; data: Cell[][] }[] {
  const out: { title: string; data: Cell[][] }[] = [];
  items.forEach((item, index) => {
    const title = dayLabel(item.day);
    let sec = out[out.length - 1];
    if (!sec || sec.title !== title) {
      sec = { title, data: [] };
      out.push(sec);
    }
    const row = sec.data[sec.data.length - 1];
    if (row && row.length < 3) row.push({ item, index });
    else sec.data.push([{ item, index }]);
  });
  return out;
}

/** Full screen, swipe between photos, pinch to zoom; where each came from underneath. */
function PhotoViewer({ items, index, onClose }: { items: GalleryItemDto[]; index: number | null; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const [at, setAt] = useState(index ?? 0);
  useEffect(() => {
    if (index != null) setAt(index);
  }, [index]);
  const current = items[at];
  return (
    <Modal visible={index != null} animationType="fade" onRequestClose={onClose} supportedOrientations={["portrait", "landscape"]}>
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        {index != null ? (
          <FlatList
            data={items}
            horizontal
            pagingEnabled
            initialScrollIndex={index}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            keyExtractor={(p) => p.key}
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => setAt(Math.round(e.nativeEvent.contentOffset.x / width))}
            renderItem={({ item }) => (
              <ScrollView style={{ width, height }} maximumZoomScale={4} minimumZoomScale={1} centerContent showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}>
                <AuthImage path={item.url} missing={item.missing} contentFit="contain" style={{ width, height }} />
              </ScrollView>
            )}
          />
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          style={{ position: "absolute", top: 54, right: 16, width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="close" size={28} color="#fff" />
        </Pressable>
        {current ? (
          <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: 16, paddingBottom: 36, backgroundColor: "rgba(0,0,0,0.6)", gap: 2 }}>
            <Text style={{ color: "#fff", fontSize: 15, fontWeight: "600" }}>
              {current.origin}
              {current.missing ? " · missing from storage" : ""}
            </Text>
            {current.caption || current.area ? <Text style={{ color: "#ddd", fontSize: 14 }}>{[current.caption, current.area].filter(Boolean).join(" · ")}</Text> : null}
            <Text style={{ color: "#bbb", fontSize: 13 }}>
              {`${current.by.firstName} ${current.by.lastName}`.trim()} · {shortDate(current.at)} · {at + 1} of {items.length}
            </Text>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}
