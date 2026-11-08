import { Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { s } from "@/ui/components";
import { TOUCH, useTheme } from "@/ui/theme";

const ACTIONS: { icon: keyof typeof Ionicons.glyphMap; label: string; when: string; href?: "/photo" | "/new-task" | "/issue/new" | "/log-pick" }[] = [
  { icon: "camera-outline", label: "Take photo", when: "", href: "/photo" },
  { icon: "checkbox-outline", label: "New task", when: "", href: "/new-task" },
  { icon: "document-attach-outline", label: "Upload document", when: "Next update" },
  { icon: "clipboard-outline", label: "Daily log", when: "", href: "/log-pick" },
  { icon: "warning-outline", label: "Report issue", when: "", href: "/issue/new" },
];

/** The Add sheet behind the centre tab button. Actions arrive in Phase 2. */
export default function Quick() {
  const t = useTheme();
  const router = useRouter();
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={[s.scroll, { gap: 8 }]}>
      {ACTIONS.map((a) => (
        <Pressable
          key={a.label}
          disabled={!a.href}
          onPress={() => {
            if (!a.href) return;
            router.back();
            router.push(a.href);
          }}
          accessibilityRole="button"
          accessibilityState={{ disabled: !a.href }}
          accessibilityLabel={a.href ? a.label : `${a.label}, ${a.when.toLowerCase()}`}
          style={{
            minHeight: TOUCH + 8,
            flexDirection: "row",
            alignItems: "center",
            gap: 14,
            paddingHorizontal: 16,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: t.border,
            backgroundColor: t.card,
            opacity: a.href ? 1 : 0.6,
          }}
        >
          <Ionicons name={a.icon} size={26} color={t.brand} />
          <Text style={[s.body, { color: t.text, flex: 1, fontWeight: "600" }]}>{a.label}</Text>
          <View>
            <Text style={{ color: t.muted, fontSize: 13 }}>{a.when}</Text>
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}
