import { Pressable, View } from "react-native";
import { Tabs, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { SyncBadge } from "@/ui/SyncBadge";
import { useTheme } from "@/ui/theme";

/**
 * Today · Jobs · (+) · Tasks · More (CAREYOS_MOBILE_APP_PLAN.md §E). The
 * centre button is not a screen: it opens the Add sheet over whatever is open.
 */
export default function TabsLayout() {
  const t = useTheme();
  const router = useRouter();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: t.card },
        headerTintColor: t.text,
        headerTitleStyle: { fontWeight: "700" },
        headerRight: () => <SyncBadge />,
        tabBarActiveTintColor: t.brand,
        tabBarInactiveTintColor: t.muted,
        tabBarStyle: { backgroundColor: t.card, borderTopColor: t.border, height: 88, paddingTop: 6 },
        tabBarLabelStyle: { fontSize: 12, fontWeight: "600" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "Today", tabBarIcon: ({ color, size }) => <Ionicons name="today-outline" color={String(color)} size={size} /> }}
      />
      <Tabs.Screen
        name="jobs"
        options={{ title: "Jobs", tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" color={String(color)} size={size} /> }}
      />
      <Tabs.Screen
        name="add"
        options={{
          title: "Add",
          tabBarLabel: () => null,
          tabBarAccessibilityLabel: "Add a photo, task, log, issue or document",
          tabBarButton: () => (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add a photo, task, log, issue or document"
                onPress={() => router.push("/quick")}
                style={({ pressed }) => ({
                  width: 58,
                  height: 58,
                  borderRadius: 29,
                  backgroundColor: t.brand,
                  alignItems: "center",
                  justifyContent: "center",
                  marginTop: -18,
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                <Ionicons name="add" size={34} color={t.brandText} />
              </Pressable>
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{ title: "Tasks", tabBarIcon: ({ color, size }) => <Ionicons name="checkbox-outline" color={String(color)} size={size} /> }}
      />
      <Tabs.Screen
        name="more"
        options={{ title: "More", tabBarIcon: ({ color, size }) => <Ionicons name="menu-outline" color={String(color)} size={size} /> }}
      />
    </Tabs>
  );
}
