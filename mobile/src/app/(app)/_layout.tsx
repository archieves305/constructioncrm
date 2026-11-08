import { Stack } from "expo-router";
import { PushProvider } from "@/push/push";
import { useTheme } from "@/ui/theme";

export default function AppLayout() {
  const t = useTheme();
  return (
    <PushProvider>
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
        name="inspections"
        options={{ headerShown: true, title: "Inspections", headerBackTitle: "Back", headerStyle: { backgroundColor: t.card }, headerTintColor: t.text }}
      />
      <Stack.Screen
        name="inspection/[id]"
        options={{ headerShown: true, title: "Inspection", headerBackTitle: "Back", headerStyle: { backgroundColor: t.card }, headerTintColor: t.text }}
      />
      <Stack.Screen
        name="issue/new"
        options={{ headerShown: true, title: "Report an issue", headerBackTitle: "Back", headerStyle: { backgroundColor: t.card }, headerTintColor: t.text }}
      />
      <Stack.Screen
        name="log/[jobId]"
        options={{ headerShown: true, title: "Daily log", headerBackTitle: "Back", headerStyle: { backgroundColor: t.card }, headerTintColor: t.text }}
      />
      <Stack.Screen
        name="crew/[jobId]"
        options={{ headerShown: true, title: "Crew hours", headerBackTitle: "Log", headerStyle: { backgroundColor: t.card }, headerTintColor: t.text }}
      />
      <Stack.Screen
        name="voice-task"
        options={{ headerShown: true, title: "Speak a task", headerBackTitle: "Back", headerStyle: { backgroundColor: t.card }, headerTintColor: t.text }}
      />
      <Stack.Screen
        name="log-pick"
        options={{ headerShown: true, title: "Daily log", headerBackTitle: "Back", headerStyle: { backgroundColor: t.card }, headerTintColor: t.text }}
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
    </PushProvider>
  );
}
