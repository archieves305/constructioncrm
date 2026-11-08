import { useState } from "react";
import { track } from "@/usage/track";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { FileItemDto } from "@crm/mobile-api";
import { ApiError } from "@/api/client";
import { isOnPhone, openDocument } from "@/docs/open";
import { shortDate } from "@/lib/format";
import { s } from "./components";
import { TOUCH, useTheme } from "./theme";

const CATEGORY: Record<string, string> = {
  PLAN_SET: "Plans",
  PERMIT: "Permits",
  CONTRACT: "Contracts",
  CUSTOMER_CONTRACT: "Contracts",
  SIGNED_DOC: "Signed documents",
  ESTIMATE: "Estimates",
  INVOICE: "Invoices",
  CHANGE_ORDER: "Change orders",
  INSPECTION: "Inspections",
  PHOTOS: "Photos",
  RECEIPT: "Receipts",
  MEASUREMENT_REPORT: "Measurements",
  INSURANCE: "Insurance",
  VIDEO: "Videos",
  LABOR_CONTRACT: "Labor contracts",
  INTERIOR_RENOVATION_LABOR_CONTRACT: "Labor contracts",
  CONTRACT_ADDENDUM: "Contracts",
  OTHER: "Other",
};

function icon(f: FileItemDto): keyof typeof Ionicons.glyphMap {
  if (f.fileType.startsWith("image/")) return "image-outline";
  if (f.fileType.startsWith("video/")) return "play-circle-outline";
  if (f.fileType === "application/pdf") return "document-text-outline";
  return "document-outline";
}

function size(bytes: number): string {
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

export function DocRow({ file }: { file: FileItemDto }) {
  const t = useTheme();
  const [opening, setOpening] = useState(false);
  const kept = isOnPhone(file);
  const open = async () => {
    setOpening(true);
    try {
      track("document_opened", "file");
      await openDocument(file);
    } catch (e) {
      Alert.alert("Can't open this file", e instanceof ApiError || e instanceof Error ? e.message : String(e));
    } finally {
      setOpening(false);
    }
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${file.fileName}, ${size(file.fileSize)}${file.missing ? ", missing" : ""}`}
      disabled={file.missing || opening}
      onPress={() => void open()}
      style={({ pressed }) => ({
        minHeight: TOUCH + 8,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: t.border,
        backgroundColor: t.card,
        opacity: pressed || file.missing ? 0.6 : 1,
      })}
    >
      <Ionicons name={icon(file)} size={24} color={t.brand} />
      <View style={{ flex: 1 }}>
        <Text style={[s.body, { color: t.text, fontWeight: "600" }]} numberOfLines={2}>
          {file.fileName}
        </Text>
        <Text style={{ color: file.missing ? t.danger : t.muted, fontSize: 13 }}>
          {file.missing ? "Missing from storage — re-upload it from the web" : `${size(file.fileSize)} · ${shortDate(file.takenAt ?? file.createdAt)}${kept ? " · on this phone" : ""}`}
        </Text>
      </View>
      {opening ? <ActivityIndicator color={t.brand} /> : <Ionicons name="open-outline" size={20} color={t.muted} />}
    </Pressable>
  );
}

/** Files grouped by category, photos counted rather than listed. */
export function DocList({ files, hidePhotoCount }: { files: FileItemDto[]; hidePhotoCount?: boolean }) {
  const t = useTheme();
  const docs = files.filter((f) => f.category !== "PHOTOS");
  const photos = files.length - docs.length;
  const groups = new Map<string, FileItemDto[]>();
  for (const f of docs) {
    const g = CATEGORY[f.category] ?? "Other";
    groups.set(g, [...(groups.get(g) ?? []), f]);
  }
  return (
    <View style={{ gap: 12 }}>
      {[...groups.entries()].map(([name, list]) => (
        <View key={name} style={{ gap: 6 }}>
          <Text style={[s.label, { color: t.muted }]}>
            {name} · {list.length}
          </Text>
          {list.map((f) => (
            <DocRow key={f.id} file={f} />
          ))}
        </View>
      ))}
      {docs.length === 0 ? <Text style={[s.body, { color: t.muted }]}>No documents on this job yet.</Text> : null}
      {photos > 0 && !hidePhotoCount ? (
        <Text style={{ color: t.muted, fontSize: 14 }}>
          {photos} {photos === 1 ? "photo" : "photos"} on this job: open Files → Photos.
        </Text>
      ) : null}
    </View>
  );
}
