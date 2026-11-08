import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSession } from "@/auth/session";
import { APP_VERSION } from "@/config";
import { Button, s } from "@/ui/components";
import { useTheme } from "@/ui/theme";

/** Shown when the CRM says this build is too old for it. */
export default function UpdateRequired() {
  const t = useTheme();
  const { minAppVersion, refresh, signOut } = useSession();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={[s.screen, { justifyContent: "center", gap: 16 }]}>
        <Text style={[s.h1, { color: t.text }]}>Update KNU Field</Text>
        <Text style={[s.body, { color: t.muted }]}>
          This version ({APP_VERSION}) is older than the CRM now needs ({minAppVersion ?? "newer"}). Install the
          latest version from TestFlight or the App Store, then open the app again.
        </Text>
        <Button label="Check again" onPress={refresh} />
        <Button label="Sign out" kind="secondary" onPress={signOut} />
      </View>
    </SafeAreaView>
  );
}
