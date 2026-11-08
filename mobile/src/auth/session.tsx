import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { useQueryClient } from "@tanstack/react-query";
import {
  bootstrapResponse,
  needsUpdate,
  type MobileDeviceDto,
  type SessionUserDto,
} from "@crm/mobile-api";
import { APP_ID, APP_VERSION, PORTAL_URL } from "@/config";
import { api, ApiError, setSignedOutHandler } from "@/api/client";
import { deleteAllDocuments } from "@/docs/open";
import { clearAllDrafts } from "@/lib/drafts";
import { clearSavedCopy } from "@/cache/persist";
import { setCrashUser } from "@/lib/sentry";
import { Image } from "expo-image";
import { forgetImageToken } from "@/ui/AuthImage";
import { newPkce } from "./pkce";
import {
  installationId,
  readCachedUser,
  readToken,
  saveCachedUser,
  saveToken,
  wipeSession,
} from "./storage";

/**
 * Sign-in with CareyOS (CAREYOS_MOBILE_APP_PLAN.md §D.3):
 *   1. open the portal's launch page in the system browser with a PKCE challenge;
 *   2. the portal sends the person back with a handoff token;
 *   3. exchange it, with the verifier, for the ordinary 7-day session token;
 *   4. register this phone with the CRM, then read who is signed in.
 * The token lives only in the Keychain / Keystore.
 */

type Status = "loading" | "signedOut" | "signedIn" | "updateRequired";

type SessionValue = {
  status: Status;
  user: SessionUserDto | null;
  device: MobileDeviceDto | null;
  /** True when the app opened from the phone's copy without reaching the CRM. */
  offline: boolean;
  /** Why the person is on the sign-in screen, in plain words. */
  notice: string | null;
  busy: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  minAppVersion: string | null;
};

const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}

const SIGN_IN_ERRORS: Record<string, string> = {
  access_denied: "Your CareyOS account doesn't have access to the CRM. Ask an administrator.",
  device_revoked: "This phone was signed out by an administrator. Ask them to allow it again.",
};

async function exchangeHandoff(handoff: string, verifier: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${PORTAL_URL}/api/sso/exchange?app=${APP_ID}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${handoff}`, "Content-Type": "application/json" },
      body: JSON.stringify({ code_verifier: verifier }),
    });
  } catch {
    throw new ApiError("No connection to CareyOS", 0, "offline");
  }
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; allowed?: boolean; token?: string };
  if (res.ok && body.allowed === false) throw new ApiError(SIGN_IN_ERRORS.access_denied, 403, "access_denied");
  if (!res.ok || !body.token) throw new ApiError("Sign-in expired. Please try again.", res.status, "exchange_failed");
  return body.token;
}

async function registerThisPhone(token?: string): Promise<MobileDeviceDto> {
  const res = (await api("/api/mobile/devices", {
    method: "POST",
    token,
    body: {
      installationId: await installationId(),
      platform: Platform.OS === "android" ? "android" : "ios",
      appVersion: /^\d+\.\d+\.\d+$/.test(APP_VERSION) ? APP_VERSION : "0.0.0",
      deviceName: Device.deviceName ?? Device.modelName ?? undefined,
    },
  })) as { device: MobileDeviceDto };
  return res.device;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<SessionUserDto | null>(null);
  const [device, setDevice] = useState<MobileDeviceDto | null>(null);
  const [offline, setOffline] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [minAppVersion, setMinAppVersion] = useState<string | null>(null);
  const signingOut = useRef(false);

  const forget = useCallback(
    async (why: string | null) => {
      await wipeSession();
      deleteAllDocuments();
      await clearAllDrafts().catch(() => undefined);
      queryClient.clear();
      await clearSavedCopy().catch(() => undefined);
      // Job photos viewed on the phone are cached on disk: gone with the sign-in.
      await Image.clearDiskCache().catch(() => undefined);
      await Image.clearMemoryCache().catch(() => undefined);
      forgetImageToken();
      setUser(null);
      setCrashUser(null);
      setDevice(null);
      setOffline(false);
      setNotice(why);
      setStatus("signedOut");
    },
    [queryClient],
  );

  /** Ask the CRM who we are; fall back to the phone's copy when offline. */
  const refresh = useCallback(async () => {
    const token = await readToken();
    if (!token) {
      setStatus("signedOut");
      return;
    }
    try {
      const boot = await api("/api/mobile/bootstrap", { schema: bootstrapResponse });
      setMinAppVersion(boot.minAppVersion);
      if (needsUpdate(APP_VERSION, boot.minAppVersion)) {
        setStatus("updateRequired");
        return;
      }
      setUser(boot.user);
      setCrashUser(boot.user.id);
      await saveCachedUser(boot.user);
      setOffline(false);
      setDevice(boot.device ?? (await registerThisPhone().catch(() => null)));
      setStatus("signedIn");
    } catch (e) {
      if (e instanceof ApiError && e.offline) {
        const cached = await readCachedUser();
        if (cached) {
          setUser(cached);
          setCrashUser(cached.id);
          setOffline(true);
          setStatus("signedIn");
          return;
        }
      }
      if (e instanceof ApiError && e.signedOut) return; // the handler below already signed out
      setNotice(e instanceof Error ? e.message : String(e));
      setStatus("signedOut");
    }
  }, []);

  useEffect(() => {
    setSignedOutHandler(() => {
      if (signingOut.current) return;
      void forget("You were signed out. Please sign in again.");
    });
    void refresh();
    return () => setSignedOutHandler(null);
  }, [forget, refresh]);

  const signIn = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    try {
      const { verifier, challenge } = await newPkce();
      const redirect = Linking.createURL("auth");
      const url =
        `${PORTAL_URL}/sso/launch?app=${APP_ID}&client=mobile` +
        `&redirect_uri=${encodeURIComponent(redirect)}` +
        `&code_challenge=${challenge}&code_challenge_method=S256`;
      const result = await WebBrowser.openAuthSessionAsync(url, redirect);
      if (result.type !== "success") return; // the person closed the sheet
      const { queryParams } = Linking.parse(result.url);
      const err = queryParams?.error ? String(queryParams.error) : null;
      if (err) throw new ApiError(SIGN_IN_ERRORS[err] ?? "Sign-in was refused", 403, err);
      const handoff = queryParams?.sso ? String(queryParams.sso) : null;
      if (!handoff) throw new ApiError("Sign-in didn't finish. Please try again.", 0, "no_handoff");

      const token = await exchangeHandoff(handoff, verifier);
      try {
        setDevice(await registerThisPhone(token));
      } catch (e) {
        if (e instanceof ApiError && e.code === "device_revoked") throw new ApiError(SIGN_IN_ERRORS.device_revoked, 403, e.code);
        throw e;
      }
      await saveToken(token);
      await refresh();
    } catch (e) {
      await wipeSession();
      setNotice(e instanceof Error ? e.message : String(e));
      setStatus("signedOut");
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const signOut = useCallback(async () => {
    signingOut.current = true;
    setBusy(true);
    try {
      // End this token at the CRM too; if there is no signal, the token still
      // expires with the portal session and is gone from the phone now.
      await api("/api/mobile/devices/current", { method: "DELETE", timeoutMs: 8000 }).catch(() => undefined);
      await forget(null);
    } finally {
      signingOut.current = false;
      setBusy(false);
    }
  }, [forget]);

  const value = useMemo(
    () => ({ status, user, device, offline, notice, busy, signIn, signOut, refresh, minAppVersion }),
    [status, user, device, offline, notice, busy, signIn, signOut, refresh, minAppVersion],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
