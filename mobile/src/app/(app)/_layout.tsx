import { Stack } from "expo-router";
import { useTheme } from "@/ui/theme";

export default function AppLayout() {
  const t = useTheme();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen
        name="job/[id]"
        options={{ headerShown: true, title: "Job", headerBackTitle: "Back", headerStyle: { backgroundColor: t.card }, headerTintColor: t.text }}
      />
      <Stack.Screen
        name="task/[id]"
        options={{ headerShown: true, title: "Task", headerBackTitle: "Back", headerStyle: { backgroundColor: t.card }, headerTintColor: t.text }}
      />
      <Stack.Screen
        name="photo"
        options={{ headerShown: true, title: "Photos", headerBackTitle: "Back", headerStyle: { backgroundColor: t.card }, headerTintColor: t.text }}
      />
      <Stack.Screen
        name="new-task"
        options={{ headerShown: true, title: "New task", headerBackTitle: "Back", headerStyle: { backgroundColor: t.card }, headerTintColor: t.text }}
      />
      <Stack.Screen
        name="outbox"
        options={{ headerShown: true, title: "Waiting to send", headerBackTitle: "Back", headerStyle: { backgroundColor: t.card }, headerTintColor: t.text }}
      />
      <Stack.Screen
        name="quick"
        options={{
          presentation: "formSheet",
          headerShown: true,
          title: "Add",
          sheetAllowedDetents: [0.6, 1],
          headerStyle: { backgroundColor: t.card },
          headerTintColor: t.text,
        }}
      />
    </Stack>
  );
}
