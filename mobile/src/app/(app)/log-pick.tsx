import { FlatList, Pressable, Text } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMyJobs } from "@/api/queries";
import { addressLine } from "@/lib/format";
import { Notice, s } from "@/ui/components";
import { Loading } from "@/ui/states";
import { TOUCH, useTheme } from "@/ui/theme";

/** From the Add sheet: which job's daily log, or which job a document goes on. */
export default function LogPick() {
  const t = useTheme();
  const router = useRouter();
  // The same job list serves "Daily log" and "Upload document" (next=files).
  const { next } = useLocalSearchParams<{ next?: string }>();
  const forFiles = next === "files";
  const jobs = useMyJobs();
  if (jobs.isPending) return <Loading />;
  return (
    <FlatList
      style={{ backgroundColor: t.bg }}
      data={jobs.data?.data ?? []}
      keyExtractor={(j) => j.id}
      contentContainerStyle={{ padding: 16, gap: 8 }}
      ListHeaderComponent={<Stack.Screen options={{ title: forFiles ? "Add a document to which job?" : "Daily log for which job?" }} />}
      ListEmptyComponent={<Notice text="You have no open jobs." />}
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            forFiles
              ? router.replace({ pathname: "/files/[jobId]", params: { jobId: item.id, upload: "1" } })
              : router.replace({ pathname: "/log/[jobId]", params: { jobId: item.id } })
          }
          style={{ minHeight: TOUCH + 8, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, justifyContent: "center" }}
        >
          <Text style={[s.body, { color: t.text, fontWeight: "600" }]}>{addressLine(item.lead) ?? item.title}</Text>
          <Text style={{ color: t.muted, fontSize: 13 }}>
            {item.lead?.fullName ?? ""} · {item.jobNumber}
          </Text>
        </Pressable>
      )}
    />
  );
}
