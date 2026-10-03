"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { KIND_LABEL, useVendorOptions } from "./use-vendors";

const NONE = "__none";

/** Pick a vendor record, or none. `value` is the vendor id or "". */
export function VendorSelect({
  value,
  onChange,
  noneLabel = "No vendor record",
  className,
}: {
  value: string;
  onChange: (vendorId: string) => void;
  noneLabel?: string;
  className?: string;
}) {
  const { data: vendors = [], isLoading } = useVendorOptions();
  return (
    <Select value={value || NONE} onValueChange={(v: string | null) => onChange(!v || v === NONE ? "" : v)}>
      <SelectTrigger className={className ?? "w-full"} aria-label="Vendor record">
        <SelectValue>
          {(v: string) => (v === NONE ? noneLabel : vendors.find((o) => o.id === v)?.name ?? (isLoading ? "Loading…" : noneLabel))}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{noneLabel}</SelectItem>
        {vendors.map((v) => (
          <SelectItem key={v.id} value={v.id}>
            {v.name} <span className="text-xs text-muted-foreground">· {KIND_LABEL[v.kind]}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
