import { Pressable, Text } from "react-native";
import { useRouter } from "expo-router";
import { useOutbox } from "@/outbox/useOutbox";
import { useTheme } from "./theme";

/** Header badge: ↻ n waiting to send, ⚠ n need attention. Hidden when all is sent. */
export function SyncBadge() {
  const t = useTheme();
  const router = useRouter();
  const { waiting, failed } = useOutbox();
  if (!waiting && !failed) return null;
  const label = failed ? `⚠ ${failed}` : `↻ ${waiting}`;
  const spoken = failed
    ? `${failed} ${failed === 1 ? "change needs" : "changes need"} attention`
    : `${waiting} ${waiting === 1 ? "change" : "changes"} waiting to send`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spoken}
      onPress={() => router.push("/outbox")}
      hitSlop={10}
      style={{ paddingHorizontal: 14, paddingVertical: 6 }}
    >
      <Text style={{ color: failed ? t.danger : t.warn, fontSize: 16, fontWeight: "700" }}>{label}</Text>
    </Pressable>
  );
}
