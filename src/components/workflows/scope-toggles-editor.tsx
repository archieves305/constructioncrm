"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { slugKey } from "@/lib/workflows/slug";
import type { ScopeToggleDef } from "./types";

/** The optional scopes a job can turn on or off for this trade. */
export function ScopeTogglesEditor({ toggles, readOnly, onSave, pending }: { toggles: ScopeToggleDef[]; readOnly: boolean; onSave: (t: ScopeToggleDef[]) => void; pending?: boolean }) {
  const [draft, setDraft] = useState<ScopeToggleDef[] | null>(null);
  const items = draft ?? toggles;
  if (readOnly) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {toggles.length === 0 && <p className="text-xs text-muted-foreground">None.</p>}
        {toggles.map((t) => (
          <span key={t.key} className="rounded-full border px-2 py-0.5 text-xs">
            {t.label} <span className="text-muted-foreground">· {t.default ? "on" : "off"} by default</span>
          </span>
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {items.map((t, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            className="h-8 text-sm"
            value={t.label}
            placeholder="Label, e.g. Tear-off"
            onChange={(e) => setDraft(items.map((x, j) => (j === i ? { ...x, label: e.target.value, key: x.key || slugKey(e.target.value) } : x)))}
          />
          <Input className="h-8 w-[160px] font-mono text-xs" value={t.key} placeholder="key" onChange={(e) => setDraft(items.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} />
          <label className="flex shrink-0 items-center gap-1 text-xs">
            <Checkbox checked={t.default} onCheckedChange={(v) => setDraft(items.map((x, j) => (j === i ? { ...x, default: Boolean(v) } : x)))} /> on by default
          </label>
          <button type="button" aria-label={`Remove ${t.label}`} className="rounded p-1 text-muted-foreground hover:bg-gray-100" onClick={() => setDraft(items.filter((_, j) => j !== i))}>
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setDraft([...items, { key: "", label: "", default: false }])}>
          <Plus className="size-3" /> Add toggle
        </Button>
        {draft && (
          <>
            <Button size="sm" className="h-7 text-xs" disabled={pending || draft.some((t) => !t.label.trim() || !t.key.trim())} onClick={() => onSave(draft.map((t) => ({ ...t, label: t.label.trim(), key: t.key.trim() })))}>
              {pending ? "Saving…" : "Save toggles"}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setDraft(null)}>
              Discard
            </Button>
          </>
        )}
        <Label className="text-[11px] text-muted-foreground">Steps and checklist lines can be limited to a toggle.</Label>
      </div>
    </div>
  );
}
