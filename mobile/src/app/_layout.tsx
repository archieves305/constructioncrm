import { useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider, useSession } from "@/auth/session";
import { OutboxProvider } from "@/outbox/useOutbox";
import { ApiError } from "@/api/client";
import { useTheme } from "@/ui/theme";
import "@/cache/net";
import { CacheProvider } from "@/cache/CacheProvider";
import { MAX_AGE_MS } from "@/cache/rules";

function RootNavigator() {
  const { status } = useSession();
  const t = useTheme();
  if (status === "loading") {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.bg }}>
        <ActivityIndicator size="large" color={t.brand} accessibilityLabel="Opening" />
      </View>
    );
  }
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }}>
      <Stack.Protected guard={status === "signedIn"}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={status === "signedOut"}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
      <Stack.Protected guard={status === "updateRequired"}>
        <Stack.Screen name="update" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            // Kept for the saved copy (cache/), not dropped five minutes after a screen closes.
            gcTime: MAX_AGE_MS,
            // A refusal is final; only a dropped connection is worth retrying.
            retry: (count, err) => err instanceof ApiError && err.offline && count < 2,
          },
        },
      }),
  );
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <OutboxProvider>
            <StatusBar style="auto" />
            <CacheProvider>
              <RootNavigator />
            </CacheProvider>
          </OutboxProvider>
        </SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
