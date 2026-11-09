import { Text, View } from "react-native";
import { statusOf, type StatusKind } from "@crm/mobile-api";
import { useTheme } from "./theme";

/**
 * A status as the web shows it: the shared label in its tone's colours
 * (@crm/mobile-api status registry), never the raw code.
 */
export function StatusBadge({ kind, value }: { kind: StatusKind; value: string | null | undefined }) {
  const t = useTheme();
  const entry = statusOf(kind, value);
  if (!entry) return null;
  const tone = t.tones[entry.tone];
  return (
    <View style={{ flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 6, backgroundColor: tone.soft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: tone.dot }} />
      <Text style={{ color: tone.fg, fontSize: 13, fontWeight: "600" }}>{entry.label}</Text>
    </View>
  );
}
