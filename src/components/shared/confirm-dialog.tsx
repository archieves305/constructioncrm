"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Callout } from "@/components/shared/callout";
import type { Tone } from "@/lib/ui/tones";

/**
 * A confirm step with, optionally, a required reason and an acknowledgement
 * box — the shape every consequential case action (close, cancel, reopen,
 * override) takes, instead of a native confirm().
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  tone = "info",
  warning,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  requireReason,
  reasonLabel = "Reason",
  reasonPlaceholder,
  checkboxLabel,
  pending,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: React.ReactNode;
  tone?: Tone;
  /** A callout above the form. */
  warning?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  requireReason?: boolean | { minLength: number };
  reasonLabel?: string;
  reasonPlaceholder?: string;
  checkboxLabel?: string;
  pending?: boolean;
  onConfirm: (reason: string) => void | Promise<void>;
  children?: React.ReactNode;
}) {
  const [reason, setReason] = useState("");
  const [acked, setAcked] = useState(false);
  const min = typeof requireReason === "object" ? requireReason.minLength : requireReason ? 1 : 0;
  const ok = reason.trim().length >= min && (!checkboxLabel || acked);
  const close = (o: boolean) => {
    if (!o) {
      setReason("");
      setAcked(false);
    }
    onOpenChange(o);
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {warning && <Callout tone={tone === "info" ? "warning" : tone}>{warning}</Callout>}
        {children}
        {min > 0 && (
          <div>
            <Label htmlFor="confirm-reason" className="text-xs">
              {reasonLabel}
            </Label>
            <Textarea id="confirm-reason" rows={3} className="mt-1" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder={reasonPlaceholder} />
            {min > 1 && <p className="mt-0.5 text-[11px] text-muted-foreground">At least {min} characters.</p>}
          </div>
        )}
        {checkboxLabel && (
          <label className="flex items-start gap-2 text-sm">
            <Checkbox className="mt-0.5" checked={acked} onCheckedChange={(v) => setAcked(Boolean(v))} />
            {checkboxLabel}
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => close(false)} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button variant={tone === "danger" ? "destructive" : "brand"} disabled={!ok || pending} onClick={() => void onConfirm(reason.trim())}>
            {pending ? "Working…" : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
