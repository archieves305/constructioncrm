import { FlatList, Pressable, Text } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useMyJobs } from "@/api/queries";
import { addressLine } from "@/lib/format";
import { Notice, s } from "@/ui/components";
import { Loading } from "@/ui/states";
import { TOUCH, useTheme } from "@/ui/theme";

/** From the Add sheet: which job's daily log to open. */
export default function LogPick() {
  const t = useTheme();
  const router = useRouter();
  const jobs = useMyJobs();
  if (jobs.isPending) return <Loading />;
  return (
    <FlatList
      style={{ backgroundColor: t.bg }}
      data={jobs.data?.data ?? []}
      keyExtractor={(j) => j.id}
      contentContainerStyle={{ padding: 16, gap: 8 }}
      ListHeaderComponent={<Stack.Screen options={{ title: "Daily log for which job?" }} />}
      ListEmptyComponent={<Notice text="You have no open jobs." />}
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace({ pathname: "/log/[jobId]", params: { jobId: item.id } })}
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
