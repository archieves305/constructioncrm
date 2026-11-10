import { Text, View } from "react-native";
import { useJobGallery, useJobIssues } from "@/api/queries";
import { personName } from "@/lib/format";
import { AuthImage } from "./AuthImage";
import { Card, s } from "./components";
import { StatusBadge } from "./StatusBadge";
import { useTheme } from "./theme";

/**
 * On the foreman's daily log: what the crew sent from the site that day —
 * photos taken on the job and problems raised — so the write-up can point to
 * them instead of retyping. Read from the job's gallery and issues; nothing new
 * is stored.
 */
export function CrewContributions({ jobId, date }: { jobId: string; date: string }) {
  const t = useTheme();
  const gallery = useJobGallery(jobId);
  const issues = useJobIssues(jobId);
  const photos = (gallery.data?.items ?? []).filter((p) => p.day === date && !p.missing);
  const problems = (issues.data ?? []).filter((i) => i.createdAt.slice(0, 10) === date);
  if (!photos.length && !problems.length) return null;
  return (
    <Card>
      <Text style={[s.h2, { color: t.text }]} accessibilityRole="header">
        From the crew today
      </Text>
      {photos.length ? (
        <View style={{ gap: 6 }}>
          <Text style={{ color: t.muted, fontSize: 14 }}>
            {photos.length} photo{photos.length === 1 ? "" : "s"} on this job today
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {photos.slice(0, 8).map((p) => (
              <AuthImage key={p.key} path={p.url} style={{ width: 64, height: 64, borderRadius: 8 }} />
            ))}
          </View>
        </View>
      ) : null}
      {problems.map((i) => (
        <View key={i.id} style={{ gap: 2 }}>
          <Text style={[s.body, { color: t.text }]} numberOfLines={2}>
            {i.title}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <StatusBadge kind="task" value={i.status} />
            <Text style={{ color: t.muted, fontSize: 13 }}>{personName(i.raisedBy) ?? ""}</Text>
          </View>
        </View>
      ))}
    </Card>
  );
}
