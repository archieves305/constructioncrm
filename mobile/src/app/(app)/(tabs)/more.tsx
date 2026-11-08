import { OWNER_ROLES } from "@crm/mobile-api";
import { Alert, Linking, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { usePush } from "@/push/push";
import { useRouter } from "expo-router";
import { clearFor } from "@/outbox/outbox";
import { useOutbox } from "@/outbox/useOutbox";
import { useSession } from "@/auth/session";
import { APP_VERSION, CRM_URL } from "@/config";
import { Button, Card, s } from "@/ui/components";
import { useTheme } from "@/ui/theme";

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Admin",
  MANAGER: "Manager",
  OFFICE_STAFF: "Office staff",
  SALES_REP: "Sales rep",
  MARKETING: "Marketing",
  READ_ONLY: "Read only",
  CREW_LEAD: "Crew lead",
};

function Row({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 4 }}>
      <Text style={[s.body, { color: t.muted }]}>{label}</Text>
      <Text style={[s.body, { color: t.text, flexShrink: 1, textAlign: "right" }]}>{value}</Text>
    </View>
  );
}

export default function More() {
  const t = useTheme();
  const router = useRouter();
  const { user, device, signOut, busy } = useSession();
  const { ops, waiting, failed } = useOutbox();
  const push = usePush();
  const qc = useQueryClient();
  const prefs = useQuery({
    queryKey: ["me", "preferences"],
    queryFn: () => api("/api/me/preferences") as Promise<{ pushEnabled?: boolean }>,
  });
  const setPush = useMutation({
    mutationFn: (on: boolean) => api("/api/me/preferences", { method: "PATCH", body: { pushEnabled: on } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["me", "preferences"] }),
    onError: (e) => Alert.alert("Couldn't change notifications", e instanceof Error ? e.message : String(e)),
  });
  const pushOn = prefs.data?.pushEnabled ?? true;

  // Unsent changes belong to this person; they are not sent as anyone else.
  const confirmSignOut = () => {
    if (ops.length === 0) return void signOut();
    Alert.alert(
      "Changes not sent yet",
      `${ops.length} ${ops.length === 1 ? "change hasn't" : "changes haven't"} reached the CRM. Signing out deletes ${ops.length === 1 ? "it" : "them"} from this phone.`,
      [
        { text: "Stay signed in", style: "cancel" },
        {
          text: "Delete and sign out",
          style: "destructive",
          onPress: async () => {
            if (user) await clearFor(user.id);
            await signOut();
          },
        },
      ],
    );
  };
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={s.scroll}>
      <Card>
        <Text style={[s.h2, { color: t.text }]}>
          {user?.firstName} {user?.lastName}
        </Text>
        <Row label="Email" value={user?.email ?? ""} />
        <Row label="Role" value={ROLE_LABEL[user?.role ?? ""] ?? user?.role ?? ""} />
      </Card>
      <Card>
        <Text style={[s.h2, { color: t.text }]}>This phone</Text>
        <Row label="Name" value={device?.deviceName ?? "—"} />
        <Row label="Registered" value={device ? new Date(device.createdAt).toLocaleDateString() : "Not yet"} />
        <Row label="App version" value={APP_VERSION} />
        <Row label="CRM" value={CRM_URL.replace(/^https?:\/\//, "")} />
      </Card>
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={[s.h2, { color: t.text }]}>Phone notifications</Text>
            <Text style={{ color: t.muted, fontSize: 14 }}>
              {push.state === "denied"
                ? "Notifications are off for KNU Field in this phone's Settings."
                : push.state === "undetermined"
                  ? "Not turned on yet on this phone."
                  : "New tasks, mentions and escalations, with the job address."}
            </Text>
          </View>
          <Switch
            accessibilityLabel="Phone notifications"
            value={pushOn && push.state === "granted"}
            disabled={setPush.isPending || prefs.isPending}
            onValueChange={(on) => {
              if (on && push.state === "undetermined") void push.ask();
              else if (on && push.state === "denied") void Linking.openSettings();
              setPush.mutate(on);
            }}
          />
        </View>
      </Card>
      {(OWNER_ROLES as readonly string[]).includes(user?.role ?? "") ? (
        <Pressable accessibilityRole="button" onPress={() => router.push("/owner")}>
          <Card>
            <Text style={[s.h2, { color: t.text }]}>Owner summary</Text>
            <Text style={[s.body, { color: t.muted }]}>Leads, pipeline, estimates, jobs, expected profit, and what needs attention.</Text>
          </Card>
        </Pressable>
      ) : null}
      <Pressable accessibilityRole="button" onPress={() => router.push("/inspections")}>
        <Card>
          <Text style={[s.h2, { color: t.text }]}>Inspections</Text>
          <Text style={[s.body, { color: t.muted }]}>Booked inspections on your jobs, and recent results.</Text>
        </Card>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => router.push("/outbox")}>
        <Card>
          <Text style={[s.h2, { color: t.text }]}>Waiting to send</Text>
          <Text style={[s.body, { color: failed ? t.danger : t.muted }]}>
            {failed
              ? `${failed} need attention${waiting ? `, ${waiting} waiting` : ""}`
              : waiting
                ? `${waiting} waiting for signal`
                : "Everything is sent"}
          </Text>
        </Card>
      </Pressable>
      <Button label="Sign out" kind="danger" onPress={confirmSignOut} busy={busy} accessibilityHint="Removes your sign-in from this phone" />
    </ScrollView>
  );
}
