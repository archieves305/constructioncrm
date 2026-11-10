import { useState } from "react";
import { FlatList, Modal, Pressable, RefreshControl, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { PlanSheetDto } from "@crm/mobile-api";
import { usePlanSheets } from "@/api/queries";
import { AuthImage } from "@/ui/AuthImage";
import { s } from "@/ui/components";
import { Empty, LoadError, Loading } from "@/ui/states";
import { TOUCH, useTheme } from "@/ui/theme";

/**
 * A job's plan sheets on the phone: the sheet list from the plan sets on the
 * job (number and title, as indexed), and a sheet full screen with pinch to
 * zoom. The office decides whether crews see plans at all (Crews → What crews
 * can see); the server refuses the list otherwise.
 */
export default function PlansScreen() {
  const t = useTheme();
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const q = usePlanSheets(jobId);
  const [open, setOpen] = useState<PlanSheetDto | null>(null);
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Stack.Screen options={{ title: "Plans" }} />
      <FlatList
        data={q.data?.sheets ?? []}
        keyExtractor={(x) => x.id}
        contentContainerStyle={{ padding: 16, gap: 8 }}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={t.brand} />}
        ListHeaderComponent={
          <View style={{ gap: 8 }}>
            {q.isPending ? <Loading /> : null}
            {q.isError && q.data === undefined ? <LoadError error={q.error} noun="plan set" onRetry={() => q.refetch()} /> : null}
            {q.data && q.data.sheets.length === 0 ? <Empty title="No plans on this job" body="Plan sets the office uploads show here." /> : null}
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Sheet ${item.sheetNumber ?? item.pageNumber}${item.title ? `, ${item.title}` : ""}`}
            onPress={() => setOpen(item)}
            style={{ minHeight: TOUCH + 8, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: t.border, backgroundColor: t.card }}
          >
            <Text style={{ color: t.brand, fontSize: 16, fontWeight: "700", minWidth: 56 }}>{item.sheetNumber ?? `p. ${item.pageNumber}`}</Text>
            <View style={{ flex: 1 }}>
              <Text style={[s.body, { color: t.text }]} numberOfLines={2}>
                {item.title ?? "Untitled sheet"}
              </Text>
              <Text style={{ color: t.muted, fontSize: 13 }}>{item.setName}</Text>
            </View>
            <Ionicons name="expand-outline" size={20} color={t.muted} />
          </Pressable>
        )}
      />
      <SheetViewer sheet={open} onClose={() => setOpen(null)} />
    </View>
  );
}

function SheetViewer({ sheet, onClose }: { sheet: PlanSheetDto | null; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  return (
    <Modal visible={sheet != null} animationType="fade" onRequestClose={onClose} supportedOrientations={["portrait", "landscape"]}>
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        {sheet ? (
          <ScrollView style={{ width, height }} maximumZoomScale={6} minimumZoomScale={1} centerContent showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}>
            <AuthImage path={sheet.imageUrl} contentFit="contain" style={{ width, height }} />
          </ScrollView>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close the sheet"
          onPress={onClose}
          style={{ position: "absolute", top: 54, right: 16, width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="close" size={26} color="#fff" />
        </Pressable>
        {sheet ? (
          <View style={{ position: "absolute", left: 16, bottom: 40, right: 80 }}>
            <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>{[sheet.sheetNumber, sheet.title].filter(Boolean).join(" · ") || `Page ${sheet.pageNumber}`}</Text>
            <Text style={{ color: "#ddd", fontSize: 13 }}>Pinch to zoom</Text>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}
