import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSession } from "@/auth/session";
import { Button, Notice, s } from "@/ui/components";
import { useTheme } from "@/ui/theme";

export default function SignIn() {
  const t = useTheme();
  const { signIn, busy, notice } = useSession();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={[s.screen, { justifyContent: "center", gap: 20 }]}>
        <View style={{ gap: 6 }}>
          <Text style={[s.label, { color: t.brand }]}>KNU Construction</Text>
          <Text style={[s.h1, { color: t.text }]}>KNU Field</Text>
          <Text style={[s.body, { color: t.muted }]}>
            Sign in with your CareyOS account, the same one you use for the CRM.
          </Text>
        </View>
        {notice ? <Notice text={notice} tone="warn" /> : null}
        <Button label="Sign in with CareyOS" onPress={signIn} busy={busy} />
        <Text style={[s.body, { color: t.muted, fontSize: 14 }]}>
          Your sign-in stays on this phone only. Signing out removes it.
        </Text>
      </View>
    </SafeAreaView>
  );
}
