import { ScrollView, Text } from "react-native";
import { Stack } from "expo-router";
import { useOutbox } from "@/outbox/useOutbox";
import { Button, s } from "@/ui/components";
import { OpRow } from "@/ui/OpRow";
import { Empty } from "@/ui/states";
import { useTheme } from "@/ui/theme";

/** Everything this phone has not sent yet, oldest first. */
export default function OutboxScreen() {
  const t = useTheme();
  const { ops, flushNow, waiting } = useOutbox();
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={s.scroll}>
      <Stack.Screen options={{ title: "Waiting to send" }} />
      {ops.length === 0 ? (
        <Empty title="Everything is sent" body="Changes you make without signal wait here until they reach the CRM." />
      ) : (
        <>
          <Text style={[s.body, { color: t.muted }]}>
            Changes are sent by themselves when the phone has signal. Nothing here is lost if you close the app.
          </Text>
          {waiting > 0 ? <Button label="Send now" onPress={() => void flushNow()} /> : null}
          {ops.map((op) => (
            <OpRow key={op.id} op={op} />
          ))}
        </>
      )}
    </ScrollView>
  );
}
