"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileInput, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Callout } from "@/components/shared/callout";
import { EmptyState } from "@/components/shared/empty-state";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import { formatFileSize } from "@/lib/files/limits";
import { useJurisdictions, usePermitTypes } from "../use-permit-intel";
import type { TemplateRow } from "./types";

export const formKeys = { list: ["permit-forms"] as const, one: (id: string) => ["permit-forms", id] as const };

const STATUS_LABEL = { DRAFT: "Draft", PUBLISHED: "Published", RETIRED: "Retired" } as const;

export function whereUsed(t: { jurisdiction: { name: string } | null; county: string | null }) {
  return t.jurisdiction?.name ?? (t.county ? `All of ${t.county} County` : "Any jurisdiction");
}

/**
 * Admin → Permits → Forms: the municipalities' blank fillable applications.
 * Each is mapped once (the AI proposes, a person confirms and publishes) and
 * then filled on any permit it applies to.
 */
export function FormTemplates() {
  const { data, isLoading, error } = useQuery({ queryKey: formKeys.list, queryFn: () => fetchJson<TemplateRow[]>("/api/permit-forms"), retry: retryServerErrors });
  const [adding, setAdding] = useState(false);
  if (error) return <Callout tone="danger" title="Couldn't load the forms">{(error as Error).message}</Callout>;
  if (isLoading) return <Skeleton className="h-48" />;
  const rows = data ?? [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">A fillable PDF only: a flat scan or an XFA form is refused with the reason.</p>
        <Button size="sm" variant="brand" onClick={() => setAdding(true)}>
          <Upload className="size-3.5" /> Upload a blank form
        </Button>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={FileInput} title="No forms yet" description="Upload a municipality's blank fillable application — the Palm Beach County universal permit application, a notice of commencement. The AI maps its fields to KNU's records; you check the mapping and publish it." />
      ) : (
        <Card className="min-w-0">
          <CardContent className="overflow-x-auto pt-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Form</TableHead>
                  <TableHead>Used for</TableHead>
                  <TableHead className="text-right">Fields</TableHead>
                  <TableHead className="text-right">Filled</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t) => (
                  <TableRow key={t.id} className={t.status === "RETIRED" ? "opacity-60" : undefined}>
                    <TableCell className="min-w-[200px] font-medium">
                      <Link href={`/admin/permits/forms/${t.id}`} className="text-primary hover:underline">
                        {t.name}
                      </Link>
                      <span className="ml-1 text-xs text-muted-foreground">v{t.version}</span>
                    </TableCell>
                    <TableCell className="text-sm">
                      {whereUsed(t)}
                      {t.permitTypeKeys.length ? <span className="text-xs text-muted-foreground"> · {t.permitTypeKeys.join(", ")}</span> : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {t._count.fields}/{t.fieldCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{t._count.fills}</TableCell>
                    <TableCell>
                      <Badge variant={t.status === "PUBLISHED" ? "default" : "outline"}>{STATUS_LABEL[t.status]}</Badge>
                      {t.mapState === "MAPPING" && (
                        <span className="ml-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Loader2 className="size-3 animate-spin" /> mapping
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">{adding && <UploadForm onClose={() => setAdding(false)} />}</DialogContent>
      </Dialog>
    </div>
  );
}

const ANY = "__any";

function UploadForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const { data: jurisdictions = [] } = useJurisdictions();
  const { data: types = [] } = usePermitTypes();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [jurisdictionId, setJurisdictionId] = useState(ANY);
  const [county, setCounty] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const jItems = [{ value: ANY, label: "Not one jurisdiction (a county-wide or general form)" }, ...jurisdictions.map((j) => ({ value: j.id, label: j.name }))];

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("name", name || file.name.replace(/\.pdf$/i, ""));
      if (jurisdictionId !== ANY) form.append("jurisdictionId", jurisdictionId);
      else if (county.trim()) form.append("county", county.trim());
      for (const k of picked) form.append("permitTypeKeys", k);
      const t = await fetchJson<{ id: string; fieldInventory: unknown[] }>("/api/permit-forms", { method: "POST", body: form });
      qc.invalidateQueries({ queryKey: formKeys.list });
      toast.success(`${t.fieldInventory.length} fields read`);
      router.push(`/admin/permits/forms/${t.id}`);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Upload a blank form</DialogTitle>
        <DialogDescription>The department&apos;s own fillable PDF, as downloaded. Its fields are read now; mapping them comes next.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <input
          ref={input}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            if (input.current) input.current.value = "";
            setFile(f);
            if (f && !name) setName(f.name.replace(/\.pdf$/i, ""));
          }}
        />
        <Button variant="outline" size="sm" onClick={() => input.current?.click()}>
          <Upload className="size-3.5" /> {file ? "Choose another PDF" : "Choose the PDF"}
        </Button>
        {file && (
          <p className="truncate text-xs text-muted-foreground">
            {file.name} · {formatFileSize(file.size)}
          </p>
        )}
        <div className="space-y-1">
          <Label htmlFor="form-name">Name</Label>
          <Input id="form-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Universal permit application (Palm Beach County)" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="form-j">Jurisdiction</Label>
          <Select items={jItems} value={jurisdictionId} onValueChange={(v: string | null) => v && setJurisdictionId(v)}>
            <SelectTrigger id="form-j" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {jItems.map((j) => (
                <SelectItem key={j.value} value={j.value}>
                  {j.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {jurisdictionId === ANY && (
          <div className="space-y-1">
            <Label htmlFor="form-county">County (offered on every permit in it)</Label>
            <Input id="form-county" value={county} onChange={(e) => setCounty(e.target.value)} placeholder="Palm Beach — leave empty for anywhere" />
          </div>
        )}
        <div className="space-y-1">
          <p className="text-sm font-medium">Permit types (none ticked = every type)</p>
          <div className="grid grid-cols-2 gap-1">
            {types.map((t) => (
              <label key={t.key} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={picked.has(t.key)}
                  onCheckedChange={(v) =>
                    setPicked((s) => {
                      const n = new Set(s);
                      if (v === true) n.add(t.key);
                      else n.delete(t.key);
                      return n;
                    })
                  }
                />
                {t.name}
              </label>
            ))}
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="brand" disabled={!file || busy} onClick={submit}>
          {busy ? "Reading the form…" : "Upload"}
        </Button>
      </DialogFooter>
    </>
  );
}
