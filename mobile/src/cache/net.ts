import { useSyncExternalStore } from "react";
import NetInfo from "@react-native-community/netinfo";
import { onlineManager } from "@tanstack/react-query";

/**
 * Tell TanStack Query when the phone has signal. Without signal a query
 * pauses and keeps the data it has (the saved copy), instead of failing;
 * it fetches again by itself when signal returns.
 */
onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((s) => setOnline(Boolean(s.isConnected) && s.isInternetReachable !== false)),
);

export function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => onlineManager.subscribe(cb),
    () => onlineManager.isOnline(),
  );
}
