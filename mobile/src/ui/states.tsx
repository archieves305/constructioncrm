import { ActivityIndicator, Text, View } from "react-native";
import { queryStatus } from "@crm/mobile-api";
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

/**
 * A load that did not work, worded as the web's QueryState: a refusal says so
 * (no retry: retrying won't change a role), a missing record says it is gone,
 * anything else shows the server's sentence and a retry. `noun` names the
 * record ("job", "task").
 */
export function LoadError({ error, onRetry, noun = "page" }: { error: unknown; onRetry: () => void; noun?: string }) {
  const t = useTheme();
  if (error instanceof ApiError && error.offline) {
    return (
      <Card>
        <Text style={[s.body, { color: t.text }]}>No connection. Pull down to try again when you have signal.</Text>
        <Button label="Try again" kind="secondary" onPress={onRetry} />
      </Card>
    );
  }
  const status = error instanceof ApiError && error.status !== 401 ? queryStatus({ error }) : "failed";
  if (status === "forbidden")
    return (
      <Card>
        <Text style={[s.h2, { color: t.text }]} accessibilityRole="header">You don't have access to this</Text>
        <Text style={[s.body, { color: t.muted }]}>{`Your role can't open this ${noun}. Ask an office manager if you need it.`}</Text>
      </Card>
    );
  if (status === "not_found")
    return (
      <Card>
        <Text style={[s.h2, { color: t.text }]} accessibilityRole="header">{`This ${noun} no longer exists`}</Text>
        <Text style={[s.body, { color: t.muted }]}>It may have been deleted, or the link is wrong.</Text>
      </Card>
    );
  const msg = error instanceof ApiError ? error.message : "Something went wrong loading this.";
  return (
    <Card>
      <Text style={[s.h2, { color: t.text }]} accessibilityRole="header">Couldn't load</Text>
      <Text style={[s.body, { color: t.muted }]}>{msg}</Text>
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
