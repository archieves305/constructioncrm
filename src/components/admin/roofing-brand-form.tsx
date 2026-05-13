"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Upload, Trash2 } from "lucide-react";

type Brand = {
  id: string;
  companyName: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  roofingLicense: string | null;
  gcLicense: string | null;
  logoStorageKey: string | null;
  defaultExpirationDays: number;
  defaultUnderlaymentType: string | null;
  defaultPlywoodSheetsIncluded: number;
  defaultAdditionalPlywoodPrice: string;
  defaultWorkmanshipWarrantyYears: number;
  defaultManufacturerWarranty: string | null;
  paymentDepositPercent: string;
  paymentProgressPercent: string;
  paymentFinalPercent: string;
};

const num = (s: string) => {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

export function RoofingBrandForm() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [logoCacheBust, setLogoCacheBust] = useState(0);

  const { data: brand, isLoading } = useQuery<Brand>({
    queryKey: ["roofing-brand"],
    queryFn: () =>
      fetch("/api/admin/roofing-brand").then((r) => r.json()),
  });

  // Mirror server state into local form state. Keep numbers as strings so
  // intermediate edits ("4", "40", "40.5") stay typeable. Use React's
  // render-time-sync pattern (matches branding-form.tsx) instead of an effect
  // to avoid the cascading-render lint rule.
  const [form, setForm] = useState<Record<string, string>>({});
  const [prevBrandId, setPrevBrandId] = useState<string | undefined>();
  if (brand && brand.id !== prevBrandId) {
    setPrevBrandId(brand.id);
    setForm({
      companyName: brand.companyName ?? "",
      addressLine1: brand.addressLine1 ?? "",
      addressLine2: brand.addressLine2 ?? "",
      city: brand.city ?? "",
      state: brand.state ?? "",
      zip: brand.zip ?? "",
      phone: brand.phone ?? "",
      email: brand.email ?? "",
      website: brand.website ?? "",
      roofingLicense: brand.roofingLicense ?? "",
      gcLicense: brand.gcLicense ?? "",
      defaultExpirationDays: String(brand.defaultExpirationDays),
      defaultUnderlaymentType: brand.defaultUnderlaymentType ?? "",
      defaultPlywoodSheetsIncluded: String(brand.defaultPlywoodSheetsIncluded),
      defaultAdditionalPlywoodPrice: String(
        Number(brand.defaultAdditionalPlywoodPrice),
      ),
      defaultWorkmanshipWarrantyYears: String(
        brand.defaultWorkmanshipWarrantyYears,
      ),
      defaultManufacturerWarranty: brand.defaultManufacturerWarranty ?? "",
      paymentDepositPercent: String(Number(brand.paymentDepositPercent)),
      paymentProgressPercent: String(Number(brand.paymentProgressPercent)),
      paymentFinalPercent: String(Number(brand.paymentFinalPercent)),
    });
  }

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/roofing-brand", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: form.companyName,
          addressLine1: form.addressLine1 || null,
          addressLine2: form.addressLine2 || null,
          city: form.city || null,
          state: form.state || null,
          zip: form.zip || null,
          phone: form.phone || null,
          email: form.email || null,
          website: form.website || null,
          roofingLicense: form.roofingLicense || null,
          gcLicense: form.gcLicense || null,
          defaultExpirationDays: num(form.defaultExpirationDays),
          defaultUnderlaymentType: form.defaultUnderlaymentType || null,
          defaultPlywoodSheetsIncluded: num(form.defaultPlywoodSheetsIncluded),
          defaultAdditionalPlywoodPrice: num(form.defaultAdditionalPlywoodPrice),
          defaultWorkmanshipWarrantyYears: num(
            form.defaultWorkmanshipWarrantyYears,
          ),
          defaultManufacturerWarranty: form.defaultManufacturerWarranty || null,
          paymentDepositPercent: num(form.paymentDepositPercent),
          paymentProgressPercent: num(form.paymentProgressPercent),
          paymentFinalPercent: num(form.paymentFinalPercent),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Save failed" }));
        throw new Error(err.error || "Save failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Brand settings saved");
      queryClient.invalidateQueries({ queryKey: ["roofing-brand"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const uploadLogo = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/roofing-brand/logo", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(err.error || "Upload failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Logo uploaded");
      setLogoCacheBust((n) => n + 1);
      queryClient.invalidateQueries({ queryKey: ["roofing-brand"] });
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeLogo = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/roofing-brand/logo", {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Logo removed");
      setLogoCacheBust((n) => n + 1);
      queryClient.invalidateQueries({ queryKey: ["roofing-brand"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading || !brand) {
    return (
      <p className="py-6 text-sm text-muted-foreground">Loading…</p>
    );
  }

  const set = (key: string) => (v: string) =>
    setForm((f) => ({ ...f, [key]: v }));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Logo</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex h-24 w-40 items-center justify-center rounded border bg-white p-2">
              {brand.logoStorageKey ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={`/api/admin/roofing-brand/logo/preview?v=${logoCacheBust}`}
                  alt="Brand logo"
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <span className="text-xs text-muted-foreground">No logo</span>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadLogo.mutate(f);
              }}
            />
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadLogo.isPending}
              >
                <Upload className="mr-1 h-4 w-4" />
                {brand.logoStorageKey ? "Replace logo" : "Upload logo"}
              </Button>
              {brand.logoStorageKey && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    if (confirm("Remove the brand logo?")) removeLogo.mutate();
                  }}
                  disabled={removeLogo.isPending}
                >
                  <Trash2 className="mr-1 h-4 w-4" />
                  Remove
                </Button>
              )}
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            PNG/JPG/WebP up to 5 MB. Appears in the header of every customer
            proposal PDF.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Company contact</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Company name" value={form.companyName} onChange={set("companyName")} />
          <Field label="Phone" value={form.phone} onChange={set("phone")} />
          <Field label="Email" value={form.email} onChange={set("email")} />
          <Field label="Website" value={form.website} onChange={set("website")} />
          <Field label="Address line 1" value={form.addressLine1} onChange={set("addressLine1")} />
          <Field label="Address line 2" value={form.addressLine2} onChange={set("addressLine2")} />
          <Field label="City" value={form.city} onChange={set("city")} />
          <div className="grid grid-cols-2 gap-2">
            <Field label="State" value={form.state} onChange={set("state")} />
            <Field label="ZIP" value={form.zip} onChange={set("zip")} />
          </div>
          <Field label="Roofing license #" value={form.roofingLicense} onChange={set("roofingLicense")} />
          <Field label="GC license #" value={form.gcLicense} onChange={set("gcLicense")} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Proposal defaults</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field
              label="Expiration (days)"
              type="number"
              value={form.defaultExpirationDays}
              onChange={set("defaultExpirationDays")}
            />
            <Field
              label="Plywood sheets included"
              type="number"
              value={form.defaultPlywoodSheetsIncluded}
              onChange={set("defaultPlywoodSheetsIncluded")}
            />
            <Field
              label="Additional plywood ($/sheet)"
              type="number"
              value={form.defaultAdditionalPlywoodPrice}
              onChange={set("defaultAdditionalPlywoodPrice")}
            />
            <Field
              label="Workmanship warranty (years)"
              type="number"
              value={form.defaultWorkmanshipWarrantyYears}
              onChange={set("defaultWorkmanshipWarrantyYears")}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Default underlayment description</Label>
            <Textarea
              rows={2}
              value={form.defaultUnderlaymentType}
              onChange={(e) => set("defaultUnderlaymentType")(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Default manufacturer warranty</Label>
            <Textarea
              rows={2}
              value={form.defaultManufacturerWarranty}
              onChange={(e) =>
                set("defaultManufacturerWarranty")(e.target.value)
              }
            />
          </div>

          <Separator />

          <div>
            <h4 className="mb-2 text-sm font-semibold">Payment schedule (%)</h4>
            <div className="grid grid-cols-3 gap-2">
              <Field
                label="Deposit"
                type="number"
                value={form.paymentDepositPercent}
                onChange={set("paymentDepositPercent")}
              />
              <Field
                label="In-Progress"
                type="number"
                value={form.paymentProgressPercent}
                onChange={set("paymentProgressPercent")}
              />
              <Field
                label="Final"
                type="number"
                value={form.paymentFinalPercent}
                onChange={set("paymentFinalPercent")}
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Must sum to 100%.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        type={type ?? "text"}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
