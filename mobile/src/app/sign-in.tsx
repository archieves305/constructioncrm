import { useRef, useState, type ElementRef } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSession } from "@/auth/session";
import { Button, Notice, s } from "@/ui/components";
import { TOUCH, useTheme } from "@/ui/theme";

/**
 * The app's own sign-in screen: the CareyOS email and password, checked by
 * the portal (/api/sso/mobile-login). The browser sheet stays as a fallback.
 */
export default function SignIn() {
  const t = useTheme();
  const { signIn, signInWithPassword, busy, notice } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const passwordRef = useRef<ElementRef<typeof TextInput>>(null);

  const ready = email.trim().includes("@") && password.length > 0;
  const submit = () => {
    if (!ready || busy) return;
    void signInWithPassword(email, password).then(() => setPassword(""));
  };

  const input = {
    minHeight: TOUCH + 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.card,
    color: t.text,
    paddingHorizontal: 14,
    fontSize: 17,
  } as const;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={[s.scroll, { justifyContent: "center", gap: 18 }]} keyboardShouldPersistTaps="handled">
          <View style={{ gap: 6 }}>
            <Text style={[s.label, { color: t.brand }]}>KNU Construction</Text>
            <Text style={[s.h1, { color: t.text }]}>KNU Field</Text>
            <Text style={[s.body, { color: t.muted }]}>
              Sign in with your CareyOS email and password, the same ones you use for the CRM.
            </Text>
          </View>

          {notice ? <Notice text={notice} tone="warn" /> : null}

          <View style={{ gap: 6 }}>
            <Text style={[s.label, { color: t.muted }]}>Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="you@knuconstruction.com"
              placeholderTextColor={t.muted}
              accessibilityLabel="Email"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="username"
              keyboardType="email-address"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              editable={!busy}
              style={input}
            />
          </View>

          <View style={{ gap: 6 }}>
            <Text style={[s.label, { color: t.muted }]}>Password</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <TextInput
                ref={passwordRef}
                value={password}
                onChangeText={setPassword}
                placeholder="Password"
                placeholderTextColor={t.muted}
                accessibilityLabel="Password"
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="password"
                textContentType="password"
                returnKeyType="go"
                onSubmitEditing={submit}
                editable={!busy}
                style={[input, { flex: 1 }]}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={showPassword ? "Hide password" : "Show password"}
                onPress={() => setShowPassword((v) => !v)}
                style={{ minHeight: TOUCH, minWidth: TOUCH + 12, justifyContent: "center", alignItems: "center" }}
              >
                <Text style={{ color: t.brand, fontSize: 16, fontWeight: "600" }}>{showPassword ? "Hide" : "Show"}</Text>
              </Pressable>
            </View>
          </View>

          <Button label="Sign in" onPress={submit} busy={busy} disabled={!ready} />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sign in through the CareyOS website instead"
            onPress={() => void signIn()}
            disabled={busy}
            style={{ minHeight: TOUCH, justifyContent: "center", alignItems: "center" }}
          >
            <Text style={{ color: t.brand, fontSize: 16 }}>Sign in through the CareyOS website instead</Text>
          </Pressable>

          <Text style={[s.body, { color: t.muted, fontSize: 14 }]}>
            Forgot your password? Ask an administrator to reset it in CareyOS. Your sign-in stays on this phone only;
            signing out removes it.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
