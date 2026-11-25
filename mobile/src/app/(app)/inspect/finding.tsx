import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { q } from "@/api/queries";
import { boxOnScreen, SEVERITY_TEXT, severityTone } from "@/lib/inspector";
import { AuthImage } from "@/ui/AuthImage";
import { Card, s } from "@/ui/components";
import { useTheme } from "@/ui/theme";

/**
 * One photo, full width, with the numbered boxes of what was found on it.
 * Opened from a photo (all its findings) or from a finding (that one marked).
 */
export default function InspectionPhoto() {
  const t = useTheme();
  const { id, photoId, findingId } = useLocalSearchParams<{ id: string; photoId: string; findingId?: string }>();
  const insp = useQuery(q.qualityInspection(id));
  const [frame, setFrame] = useState<{ width: number; height: number } | null>(null);
  const d = insp.data;
  const photo = d?.photos.find((p) => p.id === photoId);
  if (!d || !photo) return null;
  const onPhoto = d.findings.filter((f) => f.photoId === photoId && f.review !== "DISMISSED");
  const height = frame ? Math.min(frame.width * (photo.height / photo.width), 560) : 300;

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={s.scroll}>
      <Stack.Screen options={{ title: "Photo" }} />
      <View onLayout={(e) => setFrame({ width: e.nativeEvent.layout.width, height })} style={{ width: "100%", height, borderRadius: 10, overflow: "hidden", backgroundColor: "#000" }}>
        <AuthImage path={photo.url} contentFit="contain" style={{ width: "100%", height: "100%" }} />
        {frame
          ? onPhoto.flatMap((f, i) =>
              f.boxes.map((b, j) => {
                const r = boxOnScreen(b, photo, { width: frame.width, height });
                const tone = t.tones[severityTone(f.severity)];
                const active = !findingId || f.id === findingId;
                return (
                  <View key={`${f.id}:${j}`} pointerEvents="none" style={{ position: "absolute", left: r.left, top: r.top, width: r.width, height: r.height, borderWidth: active ? 3 : 1.5, borderColor: tone.dot, opacity: active ? 1 : 0.5 }}>
                    <Text style={{ position: "absolute", top: -2, left: -2, backgroundColor: tone.dot, color: "#fff", fontWeight: "700", paddingHorizontal: 5 }}>{i + 1}</Text>
                  </View>
                );
              }),
            )
          : null}
      </View>
      {onPhoto.length === 0 ? <Text style={{ color: t.muted }}>{photo.state === "done" ? "Nothing marked on this photo." : "Still being looked at."}</Text> : null}
      {onPhoto.map((f, i) => (
        <Card key={f.id} style={{ borderColor: f.id === findingId ? t.brand : t.border }}>
          <Text style={[s.body, { color: t.text, fontWeight: "600" }]}>
            {i + 1}. {f.title}
          </Text>
          <Text style={{ color: t.tones[severityTone(f.severity)].fg }}>{SEVERITY_TEXT[f.severity]}{f.boxes.length ? "" : " · not placed on the photo"}</Text>
          <Text style={{ color: t.muted }}>{f.evidence}</Text>
          {f.action ? <Text style={{ color: t.text }}>Fix: {f.action}</Text> : null}
        </Card>
      ))}
    </ScrollView>
  );
}
