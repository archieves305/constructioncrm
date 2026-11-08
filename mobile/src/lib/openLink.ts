import * as WebBrowser from "expo-web-browser";
import type { useRouter } from "expo-router";
import { CRM_URL } from "@/config";
import { phoneLink } from "./links";

/** Follow a CRM link: in the app for a job or task, else the CRM's web page in an in-app browser. */
export function openCrmLink(router: ReturnType<typeof useRouter>, href: string) {
  const l = phoneLink(href);
  if (l.kind === "job") router.push({ pathname: "/job/[id]", params: { id: l.id } });
  else if (l.kind === "task") router.push({ pathname: "/task/[id]", params: { id: l.id } });
  else void WebBrowser.openBrowserAsync(`${CRM_URL}${l.path}`);
}
