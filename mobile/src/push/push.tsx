import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { api } from "@/api/client";
import { useSession } from "@/auth/session";

/**
 * Phone notifications (CAREYOS_MOBILE_APP_PLAN.md §D.4).
 *   - The permission is asked from a card that says what will be sent, not
 *     on first launch, so iOS's one-time prompt is not wasted.
 *   - With permission, the phone's Expo push token is sent to the CRM on
 *     every start (it can change after a restore or reinstall).
 *   - Tapping a notification opens the task or job it is about.
 * The text itself is set by the CRM: what happened and the job address.
 */

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

type PushState = "unsupported" | "unknown" | "undetermined" | "granted" | "denied";

type PushValue = { state: PushState; ask: () => Promise<void> };
const Ctx = createContext<PushValue>({ state: "unknown", ask: async () => undefined });
export const usePush = () => useContext(Ctx);

async function sendToken(): Promise<void> {
  const token = (await Notifications.getExpoPushTokenAsync()).data;
  await api("/api/mobile/devices/current/push", { method: "PUT", body: { pushToken: token } });
}

function statusOf(p: Notifications.NotificationPermissionsStatus): PushState {
  if (Platform.OS === "ios") {
    const s = p.ios?.status;
    if (s === Notifications.IosAuthorizationStatus.AUTHORIZED || s === Notifications.IosAuthorizationStatus.PROVISIONAL) return "granted";
    if (s === Notifications.IosAuthorizationStatus.DENIED) return "denied";
    return "undetermined";
  }
  return p.granted ? "granted" : p.canAskAgain ? "undetermined" : "denied";
}

export function PushProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { status } = useSession();
  const [state, setState] = useState<PushState>("unknown");
  const last = Notifications.useLastNotificationResponse();

  // Signed in: read the permission; with it, refresh the token at the CRM.
  useEffect(() => {
    if (status !== "signedIn") return;
    if (!Device.isDevice) {
      setState("unsupported");
      return;
    }
    void (async () => {
      const s = statusOf(await Notifications.getPermissionsAsync());
      setState(s);
      if (s === "granted") await sendToken().catch(() => undefined);
    })();
  }, [status]);

  const ask = useCallback(async () => {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Tasks and jobs",
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
    const s = statusOf(await Notifications.requestPermissionsAsync());
    setState(s);
    if (s === "granted") await sendToken().catch(() => undefined);
  }, []);

  // A tap on a notification: open what it is about (also from a cold start).
  useEffect(() => {
    if (status !== "signedIn" || !last) return;
    if (last.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const path = (last.notification.request.content.data as { path?: unknown } | undefined)?.path;
    if (typeof path === "string" && /^\/(task|job)\/[A-Za-z0-9_-]+$/.test(path)) {
      router.push(path as never);
    }
  }, [last, status, router]);

  return <Ctx.Provider value={{ state, ask }}>{children}</Ctx.Provider>;
}
