import { ActivityIndicator, Text, View } from "react-native";
import { ApiError } from "@/api/client";
import { useOnline } from "@/cache/net";
import { Button, Card, s } from "./components";
import { useTheme } from "./theme";

export function Loading({ label = "Loading" }: { label?: string }) {
  const t = useTheme();
  const online = useOnline();
  // A query with nothing saved pauses without signal: say so instead of spinning.
  if (!online)
    return (
      <View style={{ padding: 16 }}>
        <Card>
          <Text style={[s.h2, { color: t.text }]}>Not on this phone yet</Text>
          <Text style={[s.body, { color: t.muted }]}>There's no signal, and this hasn't been opened here before. It loads by itself when signal returns.</Text>
        </Card>
      </View>
    );
  return (
    <View style={{ padding: 32, alignItems: "center" }}>
      <ActivityIndicator color={t.brand} accessibilityLabel={label} />
    </View>
  );
}

/** A failed load, with the server's sentence and a retry. */
export function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const t = useTheme();
  const msg =
    error instanceof ApiError
      ? error.offline
        ? "No connection. Pull down to try again when you have signal."
        : error.message
      : "Something went wrong loading this.";
  return (
    <Card>
      <Text style={[s.body, { color: t.text }]}>{msg}</Text>
      <Button label="Try again" kind="secondary" onPress={onRetry} />
    </Card>
  );
}

export function Empty({ title, body }: { title: string; body?: string }) {
  const t = useTheme();
  return (
    <Card>
      <Text style={[s.h2, { color: t.text }]}>{title}</Text>
      {body ? <Text style={[s.body, { color: t.muted }]}>{body}</Text> : null}
    </Card>
  );
}
