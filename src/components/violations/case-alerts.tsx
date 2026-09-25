"use client";

import { Callout } from "@/components/shared/callout";
import type { CaseAlert } from "@/lib/violations/alerts";

/** The banners at the top of a case page. `onGo` jumps to the tab the alert points at. */
export function CaseAlerts({ alerts, onGo }: { alerts: CaseAlert[]; onGo?: (tab: string) => void }) {
  if (alerts.length === 0) return null;
  return (
    <div className="space-y-2">
      {alerts.map((a) => (
        <Callout
          key={a.key}
          tone={a.tone}
          title={a.title}
          action={
            a.tab && onGo ? (
              <button type="button" className="text-xs underline" onClick={() => onGo(a.tab!)}>
                Go
              </button>
            ) : undefined
          }
        >
          {a.body}
        </Callout>
      ))}
    </div>
  );
}
