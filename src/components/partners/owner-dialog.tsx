"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useChangeOwner, usePartnerOptions } from "./use-partners";

const NONE = "__none";

/** Who owns the relationship. The account's open follow-ups move to the new owner. */
export function OwnerDialog({ open, onOpenChange, organizationId, current }: { open: boolean; onOpenChange: (o: boolean) => void; organizationId: string; current: string | null }) {
  const { data: options } = usePartnerOptions(open);
  const change = useChangeOwner(organizationId);
  const [value, setValue] = useState<string | null>(current);
  const items = [{ value: NONE, label: "Nobody" }, ...(options?.owners ?? [])];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Relationship owner</DialogTitle>
          <DialogDescription>One person owns each account so two people never court the same GC without knowing. Open follow-ups move with it.</DialogDescription>
        </DialogHeader>
        <Select items={items} value={value ?? NONE} onValueChange={(v: string | null) => setValue(!v || v === NONE ? null : v)}>
          <SelectTrigger className="w-full" aria-label="Owner"><SelectValue /></SelectTrigger>
          <SelectContent>{items.map((u) => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}</SelectContent>
        </Select>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={change.isPending || value === current} onClick={() => change.mutate(value, { onSuccess: () => onOpenChange(false) })}>
            {change.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
