"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { fetchJson } from "@/lib/fetch-json";
import { useInvalidatePartners } from "./use-partners";

/**
 * Remove a GC contact. The server deletes one with no history and marks one
 * with history (interactions, bids, leads) inactive, so the records it is on
 * keep the person's name; the toast says which happened.
 */
export function RemoveContactDialog({ contact, open, onOpenChange }: { contact: { id: string; firstName: string; lastName: string } | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const invalidate = useInvalidatePartners();
  const [pending, setPending] = useState(false);
  const name = contact ? `${contact.firstName} ${contact.lastName}`.trim() : "";
  return (
    <ConfirmDialog
      open={open && Boolean(contact)}
      onOpenChange={onOpenChange}
      title={`Remove ${name}?`}
      description="They come off the account's contacts. If they are on any interaction, bid or lead, they are kept there as an inactive contact instead of being deleted."
      tone="danger"
      confirmLabel="Remove"
      pending={pending}
      onConfirm={async () => {
        if (!contact) return;
        setPending(true);
        try {
          const out = await fetchJson<{ removed: "deleted" | "deactivated" }>(`/api/contacts/${contact.id}`, { method: "DELETE" });
          toast.success(out.removed === "deleted" ? `${name} removed` : `${name} marked inactive (kept on past interactions and bids)`);
          invalidate();
          onOpenChange(false);
        } catch (err) {
          toast.error((err as Error).message);
        } finally {
          setPending(false);
        }
      }}
    />
  );
}
