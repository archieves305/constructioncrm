"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import type { Tone } from "@/lib/ui/tones";

/**
 * In-app replacements for the browser's confirm() and prompt(), which block the
 * page, can't say what will happen in the app's own words and can't be styled.
 *
 *   const confirmAction = useConfirm();
 *   if (await confirmAction({ title: `Delete the rule "${r.name}"?`, confirmLabel: "Delete", tone: "danger" })) remove.mutate(r.id);
 *
 *   const ask = usePrompt();
 *   const reason = await ask({ title: "Why is this account not being pursued?", label: "Reason" });  // null when cancelled
 */
export interface ConfirmOptions {
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  tone?: Tone;
}

export interface PromptOptions {
  title: string;
  description?: React.ReactNode;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  multiline?: boolean;
  /** Refuse an empty answer (default true). */
  required?: boolean;
  type?: "text" | "url";
}

type Pending =
  | { kind: "confirm"; opts: ConfirmOptions; resolve: (ok: boolean) => void }
  | { kind: "prompt"; opts: PromptOptions; resolve: (value: string | null) => void };

const Ctx = createContext<{ confirm: (o: ConfirmOptions | string) => Promise<boolean>; prompt: (o: PromptOptions) => Promise<string | null> } | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const settled = useRef(false);

  const confirm = useCallback(
    (input: ConfirmOptions | string) =>
      new Promise<boolean>((resolve) => {
        settled.current = false;
        setPending({ kind: "confirm", opts: typeof input === "string" ? optionsFromSentence(input) : input, resolve });
      }),
    [],
  );
  const prompt = useCallback(
    (opts: PromptOptions) =>
      new Promise<string | null>((resolve) => {
        settled.current = false;
        setPending({ kind: "prompt", opts, resolve });
      }),
    [],
  );

  function finish(value: boolean | string | null) {
    if (!pending || settled.current) return;
    settled.current = true;
    if (pending.kind === "confirm") pending.resolve(value === true);
    else pending.resolve(typeof value === "string" ? value : null);
    setPending(null);
  }

  return (
    <Ctx.Provider value={{ confirm, prompt }}>
      {children}
      {pending?.kind === "confirm" && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && finish(false)}
          title={pending.opts.title}
          description={pending.opts.description}
          tone={pending.opts.tone}
          confirmLabel={pending.opts.confirmLabel ?? "Confirm"}
          onConfirm={() => finish(true)}
        />
      )}
      {pending?.kind === "prompt" && <PromptDialog opts={pending.opts} onDone={finish} />}
    </Ctx.Provider>
  );
}

function PromptDialog({ opts, onDone }: { opts: PromptOptions; onDone: (v: string | null) => void }) {
  const [value, setValue] = useState(opts.defaultValue ?? "");
  const required = opts.required ?? true;
  const ok = !required || value.trim().length > 0;
  const submit = () => ok && onDone(value.trim());
  return (
    <Dialog open onOpenChange={(o) => !o && onDone(null)}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{opts.title}</DialogTitle>
          {opts.description && <DialogDescription>{opts.description}</DialogDescription>}
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div>
            <Label htmlFor="prompt-value" className="text-xs">
              {opts.label}
            </Label>
            {opts.multiline ? (
              <Textarea id="prompt-value" rows={4} className="mt-1" autoFocus value={value} placeholder={opts.placeholder} onChange={(e) => setValue(e.target.value)} />
            ) : (
              <Input id="prompt-value" type={opts.type ?? "text"} className="mt-1" autoFocus value={value} placeholder={opts.placeholder} onChange={(e) => setValue(e.target.value)} />
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onDone(null)}>
              Cancel
            </Button>
            <Button type="submit" variant="brand" disabled={!ok}>
              {opts.confirmLabel ?? "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const VERB_TONE: Record<string, Tone> = { Delete: "danger", Remove: "danger", Undo: "danger", Void: "danger", Discard: "danger", Deactivate: "warning", Reopen: "warning", Stop: "warning" };

/**
 * A sentence as dialog options: the first question is the title, the rest the
 * description; the opening verb names the button ("Delete") and sets its tone.
 */
export function optionsFromSentence(text: string): ConfirmOptions {
  const t = text.trim();
  const q = t.indexOf("?");
  const title = q > 0 ? t.slice(0, q + 1) : t;
  const rest = q > 0 ? t.slice(q + 1).trim() : "";
  const verb = /^([A-Z][a-z]+)\b/.exec(title)?.[1];
  const known = verb && /^(Delete|Remove|Undo|Void|Discard|Deactivate|Reopen|Stop|Approve|Release|Change|Send|Mark|Archive|Replace|Switch|Close|Cancel)$/.test(verb);
  return { title, description: rest || undefined, confirmLabel: known ? verb : "Confirm", tone: (verb ? VERB_TONE[verb] : undefined) ?? "info" };
}

function useCtx() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useConfirm / usePrompt need <ConfirmProvider> (it is in components/layout/providers.tsx)");
  return c;
}

/**
 * `await confirmAction({ title, confirmLabel, tone })` → true when confirmed.
 * A plain sentence works too: `await confirmAction("Delete estimate E-12? Its PDFs stay in Files.")`.
 */
export function useConfirm() {
  return useCtx().confirm;
}

/** `await ask({ title, label })` → the trimmed answer, or null when cancelled. */
export function usePrompt() {
  return useCtx().prompt;
}
