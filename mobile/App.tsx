// Phase 0 sign-in test (M0.2). One screen: sign in with CareyOS through the
// PKCE handoff, keep the token in SecureStore, ask the CRM who we are with
// `Authorization: Bearer`, and prove the portal refuses a handoff exchanged
// without its verifier. Not the real app; thrown away or rebuilt in Phase 1.
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";

const PORTAL = process.env.EXPO_PUBLIC_PORTAL_URL ?? "http://10.1.10.212:3000";
const CRM = process.env.EXPO_PUBLIC_CRM_URL ?? "http://10.1.10.212:4000";
const APP_ID = "construction-crm";
const TOKEN_KEY = "careyos_session";
const STORE = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

const toUrlSafe = (b64: string) => b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return globalThis.btoa(bin);
}

async function newPkce() {
  const verifier = toUrlSafe(bytesToBase64(Crypto.getRandomBytes(32)));
  const challenge = toUrlSafe(
    await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
      encoding: Crypto.CryptoEncoding.BASE64,
    }),
  );
  return { verifier, challenge };
}

/** Opens the portal in the system browser and returns the handoff token. */
async function getHandoff(challenge: string): Promise<{ sso?: string; error?: string }> {
  const redirect = Linking.createURL("auth");
  const url =
    `${PORTAL}/sso/launch?app=${APP_ID}&client=mobile` +
    `&redirect_uri=${encodeURIComponent(redirect)}` +
    `&code_challenge=${challenge}&code_challenge_method=S256`;
  const result = await WebBrowser.openAuthSessionAsync(url, redirect);
  if (result.type !== "success") return { error: `browser: ${result.type}` };
  const { queryParams } = Linking.parse(result.url);
  if (queryParams?.error) return { error: String(queryParams.error) };
  return queryParams?.sso ? { sso: String(queryParams.sso) } : { error: "no token in callback" };
}

async function exchange(handoff: string, verifier: string | null) {
  const res = await fetch(`${PORTAL}/api/sso/exchange?app=${APP_ID}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${handoff}`, "Content-Type": "application/json" },
    body: JSON.stringify(verifier ? { code_verifier: verifier } : {}),
  });
  return { status: res.status, body: (await res.json()) as { ok?: boolean; allowed?: boolean; token?: string } };
}

export default function App() {
  const [log, setLog] = useState<string[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const say = (line: string) => setLog((l) => [`${new Date().toLocaleTimeString()}  ${line}`, ...l]);

  async function whoAmI() {
    const token = await SecureStore.getItemAsync(TOKEN_KEY, STORE);
    if (!token) return say("No token stored.");
    const res = await fetch(`${CRM}/api/me`, { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json().catch(() => ({}));
    say(`CRM /api/me → ${res.status}`);
    if (res.ok) {
      const u = (body.user ?? body) as { firstName?: string; lastName?: string; role?: { name?: string } | string; email?: string };
      const role = typeof u.role === "string" ? u.role : u.role?.name;
      setMe(`${u.firstName ?? ""} ${u.lastName ?? ""} · ${role ?? "?"} · ${u.email ?? ""}`);
    } else setMe(null);
  }

  useEffect(() => {
    whoAmI().catch((e) => say(`error: ${String(e)}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signIn() {
    try {
      const { verifier, challenge } = await newPkce();
      const h = await getHandoff(challenge);
      if (!h.sso) return say(`Sign-in stopped: ${h.error}`);
      const x = await exchange(h.sso, verifier);
      say(`exchange with verifier → ${x.status} ok=${x.body.ok} allowed=${x.body.allowed}`);
      if (!x.body.token) return;
      await SecureStore.setItemAsync(TOKEN_KEY, x.body.token, STORE);
      say("Token saved to SecureStore.");
      await whoAmI();
    } catch (e) {
      say(`error: ${String(e)}`);
    }
  }

  async function withoutVerifier() {
    try {
      const { challenge } = await newPkce();
      const h = await getHandoff(challenge);
      if (!h.sso) return say(`Stopped: ${h.error}`);
      const x = await exchange(h.sso, null);
      say(`exchange WITHOUT verifier → ${x.status} (expect 401) token=${x.body.token ? "ISSUED — FAIL" : "none"}`);
    } catch (e) {
      say(`error: ${String(e)}`);
    }
  }

  async function signOut() {
    await SecureStore.deleteItemAsync(TOKEN_KEY, STORE);
    setMe(null);
    say("Token deleted.");
  }

  return (
    <View style={s.root}>
      <StatusBar style="dark" />
      <Text style={s.h1}>KNU Field · sign-in test</Text>
      <Text style={s.small}>Portal {PORTAL}{"\n"}CRM {CRM}</Text>
      <Text style={s.me}>{me ?? "Not signed in"}</Text>
      <Btn label="Sign in with CareyOS" onPress={signIn} primary />
      <Btn label="Ask the CRM who I am" onPress={whoAmI} />
      <Btn label="Test: exchange without verifier" onPress={withoutVerifier} />
      <Btn label="Sign out" onPress={signOut} />
      <ScrollView style={s.log}>
        {log.map((l, i) => (
          <Text key={i} style={s.logLine}>{l}</Text>
        ))}
      </ScrollView>
    </View>
  );
}

function Btn({ label, onPress, primary }: { label: string; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable onPress={onPress} style={[s.btn, primary && s.btnPrimary]}>
      <Text style={[s.btnText, primary && s.btnTextPrimary]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, paddingTop: 70, paddingHorizontal: 20, backgroundColor: "#f6f7f5", gap: 10 },
  h1: { fontSize: 22, fontWeight: "800", color: "#1d2420" },
  small: { fontSize: 12, color: "#58625c" },
  me: { fontSize: 16, fontWeight: "600", color: "#1d2420", marginVertical: 8 },
  btn: { minHeight: 52, borderRadius: 8, borderWidth: 1, borderColor: "#c9cec8", justifyContent: "center", paddingHorizontal: 16, backgroundColor: "#fff" },
  btnPrimary: { backgroundColor: "#b8560f", borderColor: "#b8560f" },
  btnText: { fontSize: 16, color: "#1d2420", fontWeight: "600" },
  btnTextPrimary: { color: "#fff" },
  log: { flex: 1, marginTop: 8 },
  logLine: { fontSize: 12, fontFamily: "Courier", color: "#1d2420", marginBottom: 4 },
});
