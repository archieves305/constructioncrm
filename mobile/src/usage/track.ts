import { AppState } from "react-native";
import type { PhoneUsageEvent } from "@crm/mobile-api";
import { api } from "@/api/client";

/**
 * The feature-usage log, phone side: what people open and do, by event name
 * and kind of record only (never which record). Buffered, sent every minute
 * and when the app goes to the background; best-effort, dropped when it
 * can't be sent, and never shown in "Waiting to send".
 */
type Kind = "task" | "job" | "lead" | "file" | "photo" | "log";
const buffer: { event: PhoneUsageEvent; subject?: Kind; at: string }[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let listening = false;

async function flush() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!buffer.length) return;
  const events = buffer.splice(0, 200);
  try {
    await api("/api/usage/events", { method: "POST", body: { source: "phone", events } });
  } catch {
    // Usage is a convenience: lost events are not retried.
  }
}

export function track(event: PhoneUsageEvent, subject?: Kind) {
  buffer.push({ event, ...(subject ? { subject } : {}), at: new Date().toISOString() });
  if (buffer.length > 400) buffer.splice(0, buffer.length - 400);
  timer ??= setTimeout(() => void flush(), 60_000);
  if (!listening) {
    listening = true;
    AppState.addEventListener("change", (s) => {
      if (s === "background") void flush();
      if (s === "active") track("app_opened");
    });
  }
}
