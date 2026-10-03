"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import { useVendorSettings } from "./use-vendors";

type User = { id: string; firstName: string; lastName: string };
const AUTO = "__auto";

/**
 * Who gets the task when a vendor's document is about to expire. Left on
 * automatic it goes to the Accounting role default, then the oldest admin.
 */
export function ComplianceOwner() {
  const qc = useQueryClient();
  const { data } = useVendorSettings();
  const [open, setOpen] = useState(false);
  const { data: users = [] } = useQuery<User[]>({
    queryKey: ["assignable-users"],
    queryFn: () => fetchJson("/api/users/assignable"),
    retry: retryServerErrors,
    enabled: open,
  });

  const save = useMutation({
    mutationFn: (userId: string | null) =>
      fetchJson("/api/vendors/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ complianceOwnerUserId: userId }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendors", "settings"] });
      toast.success("Compliance owner saved");
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!data) return null;
  const effective = data.effectiveOwner ? `${data.effectiveOwner.firstName} ${data.effectiveOwner.lastName}` : "nobody";
  const label = (
    <>
      <UserCheck className="size-4" />
      Expiry tasks go to {effective}
    </>
  );
  if (!data.canEdit) return <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">{label}</span>;

  const chosen = data.complianceOwner?.id ?? AUTO;
  const nameOf = (v: string) => {
    if (v === AUTO) return "Automatic";
    const u = users.find((x) => x.id === v) ?? (data.complianceOwner?.id === v ? data.complianceOwner : null);
    return u ? `${u.firstName} ${u.lastName}` : "…";
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" size="sm" className="gap-1.5" />}>{label}</PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <div>
          <div className="text-sm font-medium">Compliance owner</div>
          <p className="text-xs text-muted-foreground">
            Gets a task 30 days before a vendor&rsquo;s insurance, exemption or license expires, and another if it lapses. Automatic = the Accounting role
            default, then the oldest admin.
          </p>
        </div>
        <Select value={chosen} onValueChange={(v: string | null) => v && save.mutate(v === AUTO ? null : v)} disabled={save.isPending}>
          <SelectTrigger className="w-full" aria-label="Compliance owner">
            <SelectValue>{nameOf}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={AUTO}>Automatic</SelectItem>
            {users.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.firstName} {u.lastName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PopoverContent>
    </Popover>
  );
}
