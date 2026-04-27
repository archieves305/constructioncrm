"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Brand = {
  companyName: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  officePhone: string | null;
  mobilePhone: string | null;
  contactEmail: string | null;
  website: string | null;
  logoUrl: string | null;
  primaryColor: string;
  signatureHtml: string | null;
  signatureText: string | null;
};

const empty: Brand = {
  companyName: "",
  addressLine1: null,
  addressLine2: null,
  city: null,
  state: null,
  zip: null,
  officePhone: null,
  mobilePhone: null,
  contactEmail: null,
  website: null,
  logoUrl: null,
  primaryColor: "#1f2937",
  signatureHtml: null,
  signatureText: null,
};

export function BrandingForm() {
  const qc = useQueryClient();
  const [form, setForm] = useState<Brand>(empty);

  const { data, isLoading } = useQuery<Brand>({
    queryKey: ["email-brand"],
    queryFn: () => fetch("/api/admin/email-brand").then((r) => r.json()),
  });

  const [prevData, setPrevData] = useState<Brand | undefined>(undefined);
  if (data && data !== prevData) {
    setPrevData(data);
    setForm(data);
  }

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/email-brand", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Save failed" }));
        throw new Error(err.error || "Save failed");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["email-brand"] });
      toast.success("Branding saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function field<K extends keyof Brand>(key: K) {
    return {
      value: form[key] ?? "",
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setForm({ ...form, [key]: e.target.value || null } as Brand),
    };
  }

  if (isLoading) return <p className="py-6 text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Company</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label className="text-xs">Company name</Label>
            <Input
              value={form.companyName}
              onChange={(e) => setForm({ ...form, companyName: e.target.value })}
              placeholder="Knu Construction"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Logo URL</Label>
              <Input {...field("logoUrl")} placeholder="https://..." />
            </div>
            <div>
              <Label className="text-xs">Brand color (hex)</Label>
              <div className="flex gap-2">
                <Input
                  value={form.primaryColor}
                  onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
                  placeholder="#1f2937"
                />
                <div
                  aria-hidden
                  className="h-10 w-10 rounded border"
                  style={{ background: form.primaryColor }}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Address</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input {...field("addressLine1")} placeholder="2500 N Federal Highway, Suite 102" />
          <Input {...field("addressLine2")} placeholder="(optional second line)" />
          <div className="grid grid-cols-3 gap-3">
            <Input {...field("city")} placeholder="Ft Lauderdale" />
            <Input {...field("state")} placeholder="FL" />
            <Input {...field("zip")} placeholder="33305" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Contact</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Office phone</Label>
              <Input {...field("officePhone")} placeholder="(561) 910-0142" />
            </div>
            <div>
              <Label className="text-xs">Mobile / cell</Label>
              <Input {...field("mobilePhone")} placeholder="(561) 785-9122" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Contact email</Label>
              <Input
                type="email"
                {...field("contactEmail")}
                placeholder="info@knuconstruction.com"
              />
            </div>
            <div>
              <Label className="text-xs">Website</Label>
              <Input {...field("website")} placeholder="knuconstruction.com" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Default signature</CardTitle>
          <p className="text-xs text-muted-foreground">
            Used when a sender has no personal signature set. Leave blank to auto-build from
            company + address + phone fields above.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label className="text-xs">Signature (HTML)</Label>
            <Textarea
              rows={4}
              value={form.signatureHtml ?? ""}
              onChange={(e) =>
                setForm({ ...form, signatureHtml: e.target.value || null })
              }
              placeholder='<strong>Knu Construction</strong><br/>2500 N Federal Highway...'
            />
          </div>
          <div>
            <Label className="text-xs">Signature (plain text fallback)</Label>
            <Textarea
              rows={4}
              value={form.signatureText ?? ""}
              onChange={(e) =>
                setForm({ ...form, signatureText: e.target.value || null })
              }
              placeholder="Knu Construction&#10;2500 N Federal Highway..."
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Saving…" : "Save branding"}
        </Button>
      </div>
    </div>
  );
}
