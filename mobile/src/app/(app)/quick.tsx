import { Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { s } from "@/ui/components";
import { TOUCH, useTheme } from "@/ui/theme";
import { useSession } from "@/auth/session";
import { isCrewRole, isForeman } from "@/lib/crew";

const ACTIONS: { icon: keyof typeof Ionicons.glyphMap; label: string; when: string; href?: "/photo" | "/problem" | "/new-task" | "/voice-task" | "/issue/new" | "/log-pick" | "/log-pick?next=files" | "/log-pick?next=video" | "/materials" }[] = [
  { icon: "camera-outline", label: "Take photo", when: "", href: "/photo" },
  { icon: "videocam-outline", label: "Add video", when: "", href: "/log-pick?next=video" },
  { icon: "checkbox-outline", label: "New task", when: "", href: "/new-task" },
  { icon: "mic-outline", label: "Speak a task", when: "", href: "/voice-task" },
  { icon: "document-attach-outline", label: "Upload document", when: "", href: "/log-pick?next=files" },
  { icon: "clipboard-outline", label: "Daily log", when: "", href: "/log-pick" },
  { icon: "warning-outline", label: "Report issue", when: "", href: "/issue/new" },
  { icon: "cube-outline", label: "Request materials", when: "", href: "/materials" },
];

/** The crew mode's Add sheet: the few things done from a site, biggest first. */
const CREW_ACTIONS: typeof ACTIONS = [
  { icon: "camera-outline", label: "Take photo", when: "", href: "/photo" },
  { icon: "warning-outline", label: "Report a problem", when: "", href: "/problem" },
  { icon: "cube-outline", label: "Request materials", when: "", href: "/materials" },
  { icon: "videocam-outline", label: "Add video", when: "", href: "/log-pick?next=video" },
  { icon: "clipboard-outline", label: "Daily log", when: "", href: "/log-pick" },
];

/** The Add sheet behind the centre tab button. */
export default function Quick() {
  const t = useTheme();
  const router = useRouter();
  const { user } = useSession();
  const actions = isCrewRole(user?.role) ? CREW_ACTIONS.filter((a) => isForeman(user?.role) || a.href !== "/log-pick") : ACTIONS;
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={[s.scroll, { gap: 8 }]}>
      {actions.map((a) => (
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
