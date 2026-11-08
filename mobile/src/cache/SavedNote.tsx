import { Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useOnline } from "./net";
import { savedLabel } from "./rules";
import { useTheme } from "@/ui/theme";

/**
 * Shown only without signal: what the screen shows is the phone's saved copy,
 * and when it last heard from the CRM. Changes still queue (outbox).
 */
export function SavedNote() {
  const t = useTheme();
  const qc = useQueryClient();
  const online = useOnline();
  if (online) return null;
  const last = Math.max(0, ...qc.getQueryCache().getAll().map((x) => x.state.dataUpdatedAt));
  return (
    <View accessibilityRole="alert" style={{ borderRadius: 10, borderWidth: 1, borderColor: t.warn, padding: 10, gap: 2 }}>
      <Text style={{ color: t.warn, fontWeight: "700", fontSize: 14 }}>No signal · showing what's saved on this phone</Text>
      <Text style={{ color: t.muted, fontSize: 13 }}>
        {last ? `${savedLabel(last, Date.now()).replace("Saved", "Last updated")}. ` : ""}Your changes are kept and sent when signal returns.
      </Text>
    </View>
  );
}
