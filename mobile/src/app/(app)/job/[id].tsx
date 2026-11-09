import { useEffect } from "react";
import { SavedNote } from "@/cache/SavedNote";
import { track } from "@/usage/track";
import { Linking, Platform, RefreshControl, ScrollView, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useInspections, useJob, useJobFiles, useJobTasks } from "@/api/queries";
import { splitInspections } from "@/lib/inspections";
import { InspectionRow } from "@/ui/InspectionRow";
import { IssueSection } from "@/ui/IssueSection";
import { DocList } from "@/ui/DocList";
import { NotesSection } from "@/ui/NotesSection";
import { addressLine, dialable, fullAddress, mapsUrl, personName, shortDate } from "@/lib/format";
import { Button, Card, s } from "@/ui/components";
import { TaskRow } from "@/ui/TaskRow";
import { Empty, LoadError, Loading } from "@/ui/states";
import { useTheme } from "@/ui/theme";
import { useSession } from "@/auth/session";

function Row({ label, value }: { label: string; value: string | null }) {
  const t = useTheme();
  useEffect(() => track("job_opened", "job"), []);
  if (!value) return null;
  return (
    <View style={{ gap: 2, paddingVertical: 4 }}>
      <Text style={[s.label, { color: t.muted }]}>{label}</Text>
      <Text style={[s.body, { color: t.text }]}>{value}</Text>
    </View>
  );
}

/** The job card: where it is, who to call, what is open. */
export default function JobScreen() {
  const t = useTheme();
  const router = useRouter();
  const { user } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const job = useJob(id);
  const tasks = useJobTasks(id);
  const files = useJobFiles(id);
  const inspections = useInspections();

  if (job.isPending) return <Loading />;
  if ((job.isError && job.data === undefined))
    return (
      <View style={{ padding: 16, flex: 1, backgroundColor: t.bg }}>
        <LoadError error={job.error} noun="job" onRetry={() => job.refetch()} />
      </View>
    );

  const j = job.data;
  const address = fullAddress(j.lead);
  const phone = dialable(j.lead?.primaryPhone);
  const open = (tasks.data ?? []).filter((x) => x.status !== "COMPLETED" && x.status !== "CANCELLED");

  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={s.scroll}
      refreshControl={
        <RefreshControl
          refreshing={job.isRefetching || tasks.isRefetching}
          onRefresh={() => {
            void job.refetch();
            void tasks.refetch();
            void files.refetch();
          }}
          tintColor={t.brand}
        />
      }
    >
      <Stack.Screen options={{ title: addressLine(j.lead) ?? j.jobNumber }} />
      <SavedNote />
      <View style={{ gap: 4 }}>
        <Text style={[s.h1, { color: t.text, fontSize: 24 }]}>{addressLine(j.lead) ?? j.title}</Text>
        <Text style={[s.body, { color: t.muted }]}>
          {j.lead?.fullName ?? ""} · {j.jobNumber} · {j.currentStage.name}
        </Text>
      </View>

      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Button
            label="Directions"
            disabled={!address}
            onPress={() => address && Linking.openURL(mapsUrl(address, Platform.OS === "android" ? "android" : "ios"))}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Call" kind="secondary" disabled={!phone} onPress={() => phone && Linking.openURL(`tel:${phone}`)} />
        </View>
      </View>

      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Button
            label="Take photos"
            kind="secondary"
            onPress={() => router.push({ pathname: "/photo", params: { jobId: j.id, label: addressLine(j.lead) ?? j.jobNumber } })}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="New task" kind="secondary" onPress={() => router.push({ pathname: "/new-task", params: { jobId: j.id } })} />
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Button label="Files & photos" kind="secondary" onPress={() => router.push({ pathname: "/files/[jobId]", params: { jobId: j.id } })} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Today's log" kind="secondary" onPress={() => router.push({ pathname: "/log/[jobId]", params: { jobId: j.id } })} />
        </View>
      </View>
      <Button label="Clock crew in / out" kind="secondary" onPress={() => router.push({ pathname: "/crew/[jobId]", params: { jobId: j.id } })} />
      {user?.canEnterCosts ? <Button label="Add an expense (receipt)" kind="secondary" onPress={() => router.push({ pathname: "/expense/new", params: { jobId: j.id } })} /> : null}
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Button label="Request materials" kind="secondary" onPress={() => router.push({ pathname: "/materials", params: { jobId: j.id } })} />
        </View>
        {j.moneyView === "full" ? (
          <View style={{ flex: 1 }}>
            <Button label="Crew payments" kind="secondary" onPress={() => router.push({ pathname: "/pay/[jobId]", params: { jobId: j.id } })} />
          </View>
        ) : null}
      </View>

      <Card>
        <Row label="Customer" value={j.lead?.fullName ?? null} />
        <Row label="Phone" value={j.lead?.primaryPhone ?? null} />
        <Row label="Email" value={j.lead?.email ?? null} />
        <Row label="Address" value={address} />
        <Row label="Project manager" value={personName(j.projectManager)} />
        <Row label="Sales rep" value={personName(j.salesRep)} />
        <Row label="Target start" value={j.targetStartDate ? shortDate(j.targetStartDate) : null} />
        <Row label="Next action" value={j.nextAction} />
      </Card>

      <Text style={[s.h2, { color: t.text, marginTop: 4 }]}>Open tasks · {open.length}</Text>
      {tasks.isPending ? (
        <Loading />
      ) : (tasks.isError && tasks.data === undefined) ? (
        <LoadError error={tasks.error} noun="task list" onRetry={() => tasks.refetch()} />
      ) : open.length === 0 ? (
        <Empty title="No open tasks on this job" />
      ) : (
        <View style={{ gap: 8 }}>
          {open.map((task) => (
            <TaskRow key={task.id} task={task} showAddress={false} />
          ))}
        </View>
      )}

      {(() => {
        const mine = splitInspections((inspections.data ?? []).filter((x) => x.permit.job.id === j.id));
        const list = [...mine.booked, ...mine.done.slice(0, 3)];
        if (list.length === 0) return null;
        return (
          <>
            <Text style={[s.h2, { color: t.text, marginTop: 4 }]}>Inspections</Text>
            <View style={{ gap: 8 }}>
              {list.map((x) => (
                <InspectionRow key={x.id} inspection={x} showAddress={false} />
              ))}
            </View>
          </>
        );
      })()}

      <IssueSection jobId={j.id} />

      {j.lead ? <NotesSection leadId={j.lead.id} label={addressLine(j.lead) ?? j.jobNumber} /> : null}

      <Text style={[s.h2, { color: t.text, marginTop: 4 }]}>Documents</Text>
      {files.isPending ? (
        <Loading />
      ) : (files.isError && files.data === undefined) ? (
        <LoadError error={files.error} noun="file list" onRetry={() => files.refetch()} />
      ) : (
        <>
          <DocList files={[...files.data.files, ...files.data.leadFiles].filter((f) => f.category !== "PHOTOS").slice(0, 5)} hidePhotoCount />
          <Button label="All files and photos" kind="secondary" onPress={() => router.push({ pathname: "/files/[jobId]", params: { jobId: j.id } })} />
        </>
      )}
    </ScrollView>
  );
}
