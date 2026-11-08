import { useEffect } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { track } from "@/usage/track";
import { Stack, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { OWNER_ROLES } from "@crm/mobile-api";
import { useAttention, useOwnerSummary, useUsageSummary } from "@/api/queries";
import { useSession } from "@/auth/session";
import { useOnline } from "@/cache/net";
import { moneyShort } from "@/lib/links";
import { openCrmLink } from "@/lib/openLink";
import { Card, Notice, s } from "@/ui/components";
import { Empty, LoadError, Loading } from "@/ui/states";
import { TOUCH, useTheme } from "@/ui/theme";

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "warn" }) {
  const t = useTheme();
  useEffect(() => track("owner_opened"), []);
  return (
    <View style={{ flexBasis: "47%", flexGrow: 1, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: tone === "warn" ? t.warn : t.border, backgroundColor: t.card, gap: 2 }}>
      <Text style={{ color: t.muted, fontSize: 13, fontWeight: "600" }}>{label}</Text>
      <Text style={{ color: t.text, fontSize: 24, fontWeight: "700" }} accessibilityLabel={`${label}: ${value}`}>
        {value}
      </Text>
      {sub ? <Text style={{ color: t.muted, fontSize: 12 }}>{sub}</Text> : null}
    </View>
  );
}

/**
 * The business on one screen, for the people the CRM's dashboard shows it to:
 * the owner's numbers (leads, pipeline, estimates out, active jobs, expected
 * gross profit) and what needs attention, each opening its list. Read live;
 * not kept on the phone.
 */
export default function Owner() {
  const t = useTheme();
  const router = useRouter();
  const { user } = useSession();
  const online = useOnline();
  const allowed = (OWNER_ROLES as readonly string[]).includes(user?.role ?? "");
  const summary = useOwnerSummary(allowed);
  const attention = useAttention(allowed);
  const usage = useUsageSummary(allowed);

  if (!allowed)
    return (
      <View style={{ padding: 16, backgroundColor: t.bg, flex: 1 }}>
        <Empty title="Not for your role" body="The owner summary shows company money: the office and read-only users see it." />
      </View>
    );

  const rows = (attention.data?.rows ?? []).filter((r) => r.count > 0);
  const order = { danger: 0, warning: 1, info: 2, neutral: 3, success: 4 } as const;
  rows.sort((a, b) => order[a.tone] - order[b.tone]);
  const d = summary.data;

  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={s.scroll}
      refreshControl={
        <RefreshControl
          refreshing={summary.isRefetching || attention.isRefetching}
          onRefresh={() => {
            void summary.refetch();
            void attention.refetch();
          }}
          tintColor={t.brand}
        />
      }
    >
      <Stack.Screen options={{ title: "Owner summary" }} />
      {!online ? <Notice tone="warn" text="No signal. The owner summary is read live and not kept on the phone." /> : null}

      {summary.isPending && online ? (
        <Loading />
      ) : summary.isError && !d ? (
        <LoadError error={summary.error} onRetry={() => summary.refetch()} />
      ) : d ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          <Tile label="New leads today" value={String(d.newLeadsToday)} />
          <Tile label="Never contacted" value={String(d.uncontacted)} tone={d.uncontacted > 0 ? "warn" : undefined} sub="Open leads with no contact logged" />
          <Tile label="Pipeline" value={moneyShort(d.pipeline.value)} sub={`${d.pipeline.leads} open leads`} />
          <Tile label="Estimates out" value={moneyShort(d.estimatesOut.total)} sub={`${d.estimatesOut.count} awaiting an answer`} />
          <Tile label="Active jobs" value={String(d.activeJobs)} />
          <Tile
            label="Expected gross profit"
            value={moneyShort(d.expectedGrossProfit.total)}
            sub={`From ${d.expectedGrossProfit.jobs} job${d.expectedGrossProfit.jobs === 1 ? "" : "s"} with a cost baseline${d.expectedGrossProfit.jobsWithoutBaseline ? `; ${d.expectedGrossProfit.jobsWithoutBaseline} without one` : ""}`}
          />
        </View>
      ) : null}

      <Text style={[s.h2, { color: t.text, marginTop: 6 }]}>Needs attention</Text>
      {attention.isPending && online ? (
        <Loading />
      ) : attention.isError && !attention.data ? (
        <LoadError error={attention.error} onRetry={() => attention.refetch()} />
      ) : attention.data && rows.length === 0 ? (
        <Card>
          <Text style={[s.body, { color: t.text }]}>Nothing needs attention right now.</Text>
        </Card>
      ) : (
        rows.map((r) => (
          <Pressable
            key={r.key}
            accessibilityRole="button"
            accessibilityLabel={`${r.label}: ${r.count}`}
            onPress={() => (r.key === "overdue-tasks" ? openCrmLink(router, r.href) : router.push({ pathname: "/attention/[key]", params: { key: r.key, label: r.label } }))}
            style={{ minHeight: TOUCH + 6, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: t.border, backgroundColor: t.card }}
          >
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: r.tone === "danger" ? t.danger : r.tone === "warning" ? t.warn : t.brand }} />
            <Text style={[s.body, { color: t.text, flex: 1 }]}>{r.label}</Text>
            <Text style={{ color: t.text, fontSize: 18, fontWeight: "700" }}>{r.count}</Text>
            <Ionicons name="chevron-forward" size={18} color={t.muted} />
          </Pressable>
        ))
      )}
      {usage.data ? (
        <Card>
          <Text style={[s.h2, { color: t.text }]}>This week in the CRM and the app</Text>
          <Text style={[s.body, { color: t.text }]}>
            {usage.data.activePeople} {usage.data.activePeople === 1 ? "person" : "people"} active · {usage.data.phonePeople} on the phone app
          </Text>
          {usage.data.top.slice(0, 6).map((u) => (
            <Text key={`${u.event}${u.subject ?? ""}`} style={{ color: t.muted, fontSize: 13 }}>
              {u.event === "page_viewed" ? `Web: ${u.subject ?? "page"}` : u.event.replace(/_/g, " ")} · {u.count}
            </Text>
          ))}
          {usage.data.top.length === 0 ? <Text style={{ color: t.muted, fontSize: 13 }}>Nothing recorded yet this week.</Text> : null}
        </Card>
      ) : null}
      <Text style={{ color: t.muted, fontSize: 13 }}>The same numbers as the CRM dashboard, for the whole company. Pull down to refresh.</Text>
    </ScrollView>
  );
}
