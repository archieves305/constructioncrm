"use client";

import type { SaveStatus } from "@/hooks/use-labor-sheet";
import { Check, CloudOff, Loader2, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

const DISPLAY: Record<SaveStatus, { label: string; className: string }> = {
  idle: { label: "", className: "text-muted-foreground" },
  saving: { label: "Saving…", className: "text-muted-foreground" },
  saved: { label: "Saved", className: "text-green-700" },
  local: {
    label: "Saved on device — will sync",
    className: "text-amber-700",
  },
  conflict: { label: "Edited elsewhere", className: "text-red-700" },
  error: { label: "Save failed — retrying", className: "text-red-700" },
};

export function AutosaveIndicator({ status }: { status: SaveStatus }) {
  const d = DISPLAY[status];
  if (!d.label) return null;
  return (
    <span className={cn("flex items-center gap-1.5 text-sm", d.className)}>
      {status === "saving" && <Loader2 className="h-4 w-4 animate-spin" />}
      {status === "saved" && <Check className="h-4 w-4" />}
      {status === "local" && <CloudOff className="h-4 w-4" />}
      {(status === "conflict" || status === "error") && (
        <TriangleAlert className="h-4 w-4" />
      )}
      {d.label}
    </span>
  );
}
