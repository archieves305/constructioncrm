import { track } from "@/usage/track";
import { useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, TextInput, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import { phoneLeadList, type PhoneLeadRowDto } from "@crm/mobile-api";
import { api } from "@/api/client";
import { useOnline } from "@/cache/net";
import { shortDate } from "@/lib/format";
import { followUpLine } from "@/lib/leads";
import { Chips } from "@/ui/Chips";
import { Notice, s } from "@/ui/components";
import { Empty, LoadError, Loading } from "@/ui/states";
import { TOUCH, useTheme } from "@/ui/theme";

/**
 * My leads: the call list (follow-up due by tonight, or never contacted, most
 * overdue first) or every open lead of mine. Read live.
 */
export default function Leads() {
  const t = useTheme();
  const online = useOnline();
  useEffect(() => track("leads_opened"), []);
  const [list, setList] = useState<"call" | "mine">("call");
  const [q, setQ] = useState("");
  const query = useQuery({
    queryKey: ["leads", list, q.trim()],
    queryFn: () => api(`/api/mobile/leads?list=${list}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`, { schema: phoneLeadList }),
  });
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Stack.Screen options={{ title: "Leads" }} />
      <FlatList
        data={query.data ?? []}
        keyExtractor={(l) => l.id}
        contentContainerStyle={[s.scroll, { gap: 8 }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={t.brand} />}
        ListHeaderComponent={
          <View style={{ gap: 10 }}>
            {!online ? <Notice tone="warn" text="No signal. Leads are read live." /> : null}
            <Chips label="Show" value={list} onChange={setList} options={[{ value: "call", label: "Call today" }, { value: "mine", label: "All my leads" }]} />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Name, street or phone"
              placeholderTextColor={t.muted}
              autoCorrect={false}
              accessibilityLabel="Search leads"
              style={{ minHeight: TOUCH, borderRadius: 10, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, color: t.text, paddingHorizontal: 12, fontSize: 16 }}
            />
            {query.isPending && online ? <Loading /> : null}
            {query.isError && !query.data ? <LoadError error={query.error} onRetry={() => query.refetch()} /> : null}
            {query.data && query.data.length === 0 ? <Empty title={list === "call" ? "Nobody to call today" : "No open leads"} /> : null}
          </View>
        }
        renderItem={({ item }) => <LeadRow lead={item} />}
      />
    </View>
  );
}

function LeadRow({ lead }: { lead: PhoneLeadRowDto }) {
  const t = useTheme();
  const router = useRouter();
  const due = followUpLine(lead.nextFollowUpAt, lead.lastContactAt);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push({ pathname: "/lead/[id]", params: { id: lead.id } })}
      style={({ pressed }) => ({ minHeight: TOUCH + 16, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, flexDirection: "row", alignItems: "center", gap: 10, opacity: pressed ? 0.75 : 1 })}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[s.body, { color: t.text, fontWeight: "700" }]}>{lead.name}</Text>
        <Text style={{ color: t.muted, fontSize: 14 }}>
          {lead.street} · {lead.stage}
        </Text>
        <Text style={{ color: due.late ? t.danger : t.muted, fontSize: 13 }}>{due.text}{!lead.lastContactAt ? ` · new ${shortDate(lead.createdAt)}` : ""}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={t.muted} />
    </Pressable>
  );
}
