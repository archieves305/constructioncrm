import { useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { JobListItemDto } from "@crm/mobile-api";
import { useMyJobs } from "@/api/queries";
import { addressLine } from "@/lib/format";
import { s } from "@/ui/components";
import { Empty, LoadError, Loading } from "@/ui/states";
import { TOUCH, useTheme } from "@/ui/theme";

function JobRow({ job }: { job: JobListItemDto }) {
  const t = useTheme();
  const router = useRouter();
  const address = addressLine(job.lead) ?? job.title;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${address}, ${job.lead?.fullName ?? ""}, ${job.currentStage.name}`}
      onPress={() => router.push({ pathname: "/job/[id]", params: { id: job.id } })}
      style={({ pressed }) => ({
        minHeight: TOUCH + 20,
        padding: 14,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: t.border,
        backgroundColor: t.card,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={[s.body, { color: t.text, fontWeight: "700" }]}>{address}</Text>
        <Text style={{ color: t.muted, fontSize: 14 }}>
          {job.lead?.fullName ?? ""} · {job.jobNumber}
        </Text>
        <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
          <Text style={{ color: t.brand, fontSize: 13, fontWeight: "700" }}>{job.currentStage.name}</Text>
          {job.taskCounts && job.taskCounts.pending > 0 ? (
            <Text style={{ color: t.muted, fontSize: 13 }}>{job.taskCounts.pending} open tasks</Text>
          ) : null}
          {job.taskCounts && job.taskCounts.overdue > 0 ? (
            <Text style={{ color: t.danger, fontSize: 13, fontWeight: "700" }}>{job.taskCounts.overdue} overdue</Text>
          ) : null}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={20} color={t.muted} />
    </Pressable>
  );
}

/** My jobs: the web's "Mine" list (jobs you have a role on), open ones. */
export default function Jobs() {
  const t = useTheme();
  const jobs = useMyJobs();
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const all = jobs.data?.data ?? [];
    const needle = q.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((j) =>
      [addressLine(j.lead), j.lead?.fullName, j.jobNumber, j.title].some((v) => v?.toLowerCase().includes(needle)),
    );
  }, [jobs.data, q]);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ padding: 16, paddingBottom: 8 }}>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search address, customer or job number"
          placeholderTextColor={t.muted}
          accessibilityLabel="Search jobs"
          clearButtonMode="while-editing"
          autoCorrect={false}
          style={{ minHeight: TOUCH, borderRadius: 10, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, color: t.text, paddingHorizontal: 14, fontSize: 16 }}
        />
      </View>
      {jobs.isPending ? (
        <Loading />
      ) : jobs.isError ? (
        <View style={{ padding: 16 }}>
          <LoadError error={jobs.error} onRetry={() => jobs.refetch()} />
        </View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(j) => j.id}
          renderItem={({ item }) => <JobRow job={item} />}
          contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 8 }}
          refreshControl={<RefreshControl refreshing={jobs.isRefetching} onRefresh={() => void jobs.refetch()} tintColor={t.brand} />}
          ListEmptyComponent={
            <Empty
              title={q ? "No job matches" : "No open jobs of yours"}
              body={q ? undefined : "Jobs where you are the project manager, sales rep, on the workflow team or field-assigned show here."}
            />
          }
        />
      )}
    </View>
  );
}
