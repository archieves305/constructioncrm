"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload, Trash2 } from "lucide-react";

type Brand = {
  id: string;
  companyName: string;
  logoStorageKey: string | null;
};

// Editor for the non-roofing (Knu Construction) estimate brand. Only company
// name + logo are editable here — all other letterhead (address, phone, email,
// licenses, payment terms) is inherited from the NewCoast/Roofing Proposal brand.
export function EstimateBrandForm() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [logoCacheBust, setLogoCacheBust] = useState(0);

  const { data: brand, isLoading } = useQuery<Brand>({
    queryKey: ["estimate-brand"],
    queryFn: () => fetch("/api/admin/estimate-brand").then((r) => r.json()),
  });

  const [companyName, setCompanyName] = useState<string>("");
  const [prevId, setPrevId] = useState<string | undefined>();
  if (brand && brand.id !== prevId) {
    setPrevId(brand.id);
    setCompanyName(brand.companyName ?? "");
  }

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/estimate-brand", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Save failed" }));
        throw new Error(err.error || "Save failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Saved");
      queryClient.invalidateQueries({ queryKey: ["estimate-brand"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const uploadLogo = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/estimate-brand/logo", {
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
      queryClient.invalidateQueries({ queryKey: ["estimate-brand"] });
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeLogo = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/estimate-brand/logo", {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Logo removed");
      setLogoCacheBust((n) => n + 1);
      queryClient.invalidateQueries({ queryKey: ["estimate-brand"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading || !brand) {
    return <p className="py-6 text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Used on Drywall, Interior Renovation, and Windows &amp; Doors proposals.
        Only the company name and logo differ from the roofing brand — address,
        phone, email, licenses, and payment terms are shared with the Roofing
        Proposal settings.
      </p>

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
                  src={`/api/admin/estimate-brand/logo/preview?v=${logoCacheBust}`}
                  alt="Knu Construction logo"
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
                    if (confirm("Remove the logo?")) removeLogo.mutate();
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
            PNG/JPG/WebP up to 5 MB. Appears in the header of non-roofing
            proposal PDFs.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Company name</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1 max-w-sm">
            <Label className="text-xs">Company name (title on PDF)</Label>
            <Input
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Knu Construction"
            />
          </div>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            Save
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
