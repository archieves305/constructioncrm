import * as Application from "expo-application";
import Constants from "expo-constants";

/**
 * Where the app talks to. Production builds use the real hosts; a dev run
 * sets EXPO_PUBLIC_PORTAL_URL / EXPO_PUBLIC_CRM_URL (inlined by Expo at build
 * time). Never put a secret here: everything in this file ships in the app.
 */
export const PORTAL_URL = (process.env.EXPO_PUBLIC_PORTAL_URL ?? "https://app.careyos.com").replace(/\/$/, "");
export const CRM_URL = (process.env.EXPO_PUBLIC_CRM_URL ?? "https://crm.careyos.com").replace(/\/$/, "");
export const APP_ID = "construction-crm";

/**
 * This app's version (app.json `version`). In a real build it equals the
 * native version; inside Expo Go the native version is Expo Go's own, which
 * must never reach the CRM's minimum-version check.
 */
export const APP_VERSION: string =
  Constants.expoConfig?.version ?? Application.nativeApplicationVersion ?? "0.0.0";
