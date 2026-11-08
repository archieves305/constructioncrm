import { useMemo } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { Stack } from "expo-router";
import { useInspections } from "@/api/queries";
import { splitInspections } from "@/lib/inspections";
import { s } from "@/ui/components";
import { InspectionRow } from "@/ui/InspectionRow";
import { Empty, LoadError, Loading } from "@/ui/states";
import { useTheme } from "@/ui/theme";

/** Inspections on my jobs: booked first, then the last 30 days' results. */
export default function InspectionsScreen() {
  const t = useTheme();
  const q = useInspections();
  const { booked, done } = useMemo(() => splitInspections(q.data ?? []), [q.data]);

  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={s.scroll}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={t.brand} />}
    >
      <Stack.Screen options={{ title: "Inspections" }} />
      {q.isPending ? (
        <Loading />
      ) : (q.isError && q.data === undefined) ? (
        <LoadError error={q.error} onRetry={() => q.refetch()} />
      ) : booked.length === 0 && done.length === 0 ? (
        <Empty title="No inspections" body="Inspections booked on your jobs' permits, and results from the last 30 days, show here." />
      ) : (
        <>
          <Text accessibilityRole="header" style={[s.label, { color: t.muted }]}>
            Booked · {booked.length}
          </Text>
          {booked.length === 0 ? <Text style={[s.body, { color: t.muted }]}>Nothing booked.</Text> : null}
          <View style={{ gap: 8 }}>
            {booked.map((i) => (
              <InspectionRow key={i.id} inspection={i} />
            ))}
          </View>
          {done.length > 0 ? (
            <>
              <Text accessibilityRole="header" style={[s.label, { color: t.muted, marginTop: 8 }]}>
                Results, last 30 days · {done.length}
              </Text>
              <View style={{ gap: 8 }}>
                {done.map((i) => (
                  <InspectionRow key={i.id} inspection={i} />
                ))}
              </View>
            </>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}
