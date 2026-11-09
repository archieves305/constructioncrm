import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useAttentionList } from "@/api/queries";
import { shortDate } from "@/lib/format";
import { phoneLink } from "@/lib/links";
import { openCrmLink } from "@/lib/openLink";
import { s } from "@/ui/components";
import { Empty, LoadError, Loading } from "@/ui/states";
import { TOUCH, useTheme } from "@/ui/theme";

/** The records behind one "Needs attention" row: jobs and tasks open here, the rest on the CRM's web pages. */
export default function AttentionListScreen() {
  const t = useTheme();
  const router = useRouter();
  const { key, label, scope } = useLocalSearchParams<{ key: string; label?: string; scope?: string }>();
  const list = useAttentionList(key, scope === "mine" ? "mine" : "all");
  return (
    <FlatList
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={{ padding: 16, gap: 8 }}
      data={list.data?.items ?? []}
      keyExtractor={(i) => i.id}
      refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} tintColor={t.brand} />}
      ListHeaderComponent={
        <View style={{ gap: 8, marginBottom: 4 }}>
          <Stack.Screen options={{ title: list.data?.label ?? label ?? "Needs attention" }} />
          {list.data ? (
            <Text style={{ color: t.muted, fontSize: 14 }}>
              {list.data.description} · {list.data.count}
              {list.data.count > list.data.items.length ? ` (showing ${list.data.items.length})` : ""}
            </Text>
          ) : null}
          {list.data?.items.some((i) => phoneLink(i.href).kind === "web") ? (
            <Text style={{ color: t.muted, fontSize: 13 }}>Records other than jobs and tasks open on the CRM website; the first time it may ask you to sign in.</Text>
          ) : null}
          {list.isPending ? <Loading /> : null}
          {list.isError && !list.data ? <LoadError error={list.error} onRetry={() => list.refetch()} /> : null}
          {list.data && list.data.items.length === 0 ? <Empty title="Nothing here now" /> : null}
        </View>
      }
      renderItem={({ item }) => {
        const web = phoneLink(item.href).kind === "web";
        return (
          <Pressable
            accessibilityRole="button"
            onPress={() => openCrmLink(router, item.href)}
            style={{ minHeight: TOUCH + 8, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, flexDirection: "row", alignItems: "center", gap: 10 }}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[s.body, { color: t.text, fontWeight: "600" }]}>{item.primary}</Text>
              {item.secondary || item.code ? <Text style={{ color: t.muted, fontSize: 13 }}>{[item.secondary, item.code].filter(Boolean).join(" · ")}</Text> : null}
              <Text style={{ color: t.text, fontSize: 14 }}>{item.detail}</Text>
              {item.date ? <Text style={{ color: t.muted, fontSize: 12 }}>{shortDate(item.date)}</Text> : null}
            </View>
            <Ionicons name={web ? "open-outline" : "chevron-forward"} size={18} color={t.muted} />
          </Pressable>
        );
      }}
    />
  );
}
