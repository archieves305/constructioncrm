"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, FileText, Pencil, Plus, Ruler, Trash2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { FileLink } from "@/components/files/file-link";
import { fetchJson, HttpError } from "@/lib/fetch-json";
import { uploadProblem } from "@/lib/files/limits";
import { MEASUREMENT_FIELDS, valueProblem, type MeasurementKey, type MeasurementValues, type Overrides, type ReviewState } from "@/lib/roofing/measurements";

type Person = { id: string; firstName: string; lastName: string };

type Measurement = MeasurementValues & {
  id: string;
  source: "ROOFR" | "MANUAL" | "FIELD";
  label: string | null;
  reportDate: string | null;
  parsedAddress: string | null;
  pitchBands: { pitch: string; areaSqFt: number }[] | null;
  reportWastePct: number | null;
  parseConfidence: number | null;
  overrides: Overrides | null;
  warnings: string[] | null;
  reviewedAt: string | null;
  reviewedBy: Person | null;
  createdAt: string;
  createdBy: Person;
  file: { id: string; fileName: string; missing: boolean } | null;
  review: ReviewState;
};

const SOURCE_LABEL = { ROOFR: "Roofr report", MANUAL: "Entered by hand", FIELD: "Field measurement" } as const;
const UNIT: Record<string, string> = { squares: "sq", area: "sq ft", length: "ft", count: "", pitch: "" };

function show(value: number | string | null | undefined, kind: string): string {
  if (value == null) return "—";
  if (typeof value === "string") return value;
  const text = value.toLocaleString("en-US", { maximumFractionDigits: kind === "count" ? 0 : 2 });
  return UNIT[kind] ? `${text} ${UNIT[kind]}` : text;
}

function errorText(err: unknown): string {
  if (err instanceof HttpError) {
    const body = err.body as { error?: string; fields?: Record<string, string[]> } | undefined;
    const first = body?.fields ? Object.values(body.fields)[0]?.[0] : undefined;
    return first ?? body?.error ?? err.message;
  }
  return err instanceof Error ? err.message : "Something went wrong";
}

/**
 * A roof's measurements on a lead or job: upload a Roofr report and the CRM
 * reads it into numbers, or type them. Anything the reader was unsure of is
 * marked for a person to check before an estimate is built on it.
 */
export function RoofMeasurementsPanel({ leadId, jobId, canEdit = true }: { leadId: string; jobId?: string; canEdit?: boolean }) {
  const qc = useQueryClient();
  const picker = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(false);
  const key = ["roof-measurements", leadId];

  const list = useQuery<Measurement[]>({ queryKey: key, queryFn: () => fetchJson(`/api/leads/${leadId}/roof-measurements`) });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      if (jobId) form.append("jobId", jobId);
      return fetchJson<Measurement>(`/api/leads/${leadId}/roof-measurements`, { method: "POST", body: form });
    },
    onSuccess: (m) => {
      qc.invalidateQueries({ queryKey: key });
      if (m.totalSquares == null && m.roofAreaSqFt == null) toast.warning("The report was saved, but no measurements could be read from it. Enter them by hand.");
      else if (m.review.needsReview) toast.warning("Report read. Some values need a look before it is used.");
      else toast.success(`Report read: ${show(m.totalSquares, "squares")}`);
    },
    onError: (err) => toast.error(errorText(err)),
  });

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const problem = file.type !== "application/pdf" ? "A measurement report must be a PDF" : uploadProblem(file);
    if (problem) return void toast.error(problem);
    upload.mutate(file);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Ruler className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm font-medium">Roof measurements</p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <input ref={picker} type="file" accept="application/pdf" className="hidden" onChange={onPick} />
            <Button size="sm" variant="outline" disabled={adding} onClick={() => setAdding(true)}>
              <Plus className="mr-1 h-4 w-4" /> Enter by hand
            </Button>
            <Button size="sm" disabled={upload.isPending} onClick={() => picker.current?.click()}>
              <Upload className="mr-1 h-4 w-4" /> {upload.isPending ? "Reading report…" : "Upload Roofr report"}
            </Button>
          </div>
        )}
      </div>

      {adding && <MeasurementCard leadId={leadId} jobId={jobId} onDone={() => setAdding(false)} canEdit />}

      {list.isLoading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Loading measurements…</p>
      ) : list.isError ? (
        <p className="py-6 text-center text-sm text-destructive">Measurements could not be loaded. {errorText(list.error)}</p>
      ) : !list.data?.length && !adding ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No measurements yet. Upload the Roofr report PDF and its numbers are read in for you.
        </p>
      ) : (
        list.data?.map((m) => <MeasurementCard key={m.id} leadId={leadId} measurement={m} canEdit={canEdit} />)
      )}
    </div>
  );
}

function MeasurementCard({ leadId, jobId, measurement: m, canEdit, onDone }: { leadId: string; jobId?: string; measurement?: Measurement; canEdit: boolean; onDone?: () => void }) {
  const qc = useQueryClient();
  const isNew = !m;
  const [editing, setEditing] = useState(isNew);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const key = ["roof-measurements", leadId];
  const done = () => {
    qc.invalidateQueries({ queryKey: key });
    setEditing(false);
    setDraft({});
    onDone?.();
  };

  /** The typed text as values; a problem in words when something is not a valid entry. */
  function readDraft(): { values: MeasurementValues } | { problem: string } {
    const values: Record<string, number | string | null> = {};
    for (const f of MEASUREMENT_FIELDS) {
      if (!(f.key in draft)) continue;
      const text = draft[f.key].trim();
      const value = text === "" ? null : f.kind === "pitch" ? text : Number(text.replace(/,/g, ""));
      const problem = valueProblem(f.key, value);
      if (problem) return { problem };
      values[f.key] = value;
    }
    return { values: values as MeasurementValues };
  }

  const save = useMutation({
    mutationFn: async (values: MeasurementValues) =>
      isNew
        ? fetchJson(`/api/leads/${leadId}/roof-measurements`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: jobId ?? null, values }) })
        : fetchJson(`/api/roof-measurements/${m.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values }) }),
    onSuccess: () => {
      toast.success(isNew ? "Measurements saved" : "Measurements updated");
      done();
    },
    onError: (err) => toast.error(errorText(err)),
  });

  const review = useMutation({
    mutationFn: async (reviewed: boolean) => fetchJson(`/api/roof-measurements/${m!.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reviewed }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (err) => toast.error(errorText(err)),
  });

  const remove = useMutation({
    mutationFn: async () => fetchJson(`/api/roof-measurements/${m!.id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Measurement removed");
      setConfirmDelete(false);
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (err) => toast.error(errorText(err)),
  });

  function onSave() {
    const read = readDraft();
    if ("problem" in read) return void toast.error(read.problem);
    if (isNew && read.values.totalSquares == null && read.values.roofAreaSqFt == null) return void toast.error("Enter the total squares or the roof area");
    if (!isNew && Object.keys(read.values).length === 0) return done();
    save.mutate(read.values);
  }

  const unsure = new Set<MeasurementKey>(m?.review.unsureFields ?? []);
  const fields = editing ? MEASUREMENT_FIELDS : MEASUREMENT_FIELDS.filter((f) => m?.[f.key] != null || unsure.has(f.key) || !("manualOnly" in f));

  return (
    <Card>
      <CardContent className="space-y-3 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{isNew ? "New measurement" : (m.label ?? SOURCE_LABEL[m.source])}</span>
              {m && !editing && m.totalSquares != null && <Badge variant="secondary">{show(m.totalSquares, "squares")}</Badge>}
              {m?.review.needsReview && (
                <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="mr-1 h-3 w-3" /> Needs review
                </Badge>
              )}
              {m?.reviewedAt && !m.review.needsReview && (
                <Badge variant="outline">
                  <CheckCircle2 className="mr-1 h-3 w-3" /> Reviewed
                </Badge>
              )}
            </div>
            {m && (
              <p className="text-xs text-muted-foreground">
                {m.createdBy.firstName} {m.createdBy.lastName} · {format(new Date(m.createdAt), "MMM d, yyyy")}
                {m.reportDate ? ` · report dated ${format(new Date(m.reportDate), "MMM d, yyyy")}` : ""}
                {m.parsedAddress ? ` · ${m.parsedAddress}` : ""}
              </p>
            )}
            {m?.file && (
              <FileLink fileId={m.file.id} fileName={m.file.fileName} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                <FileText className="h-3 w-3" /> {m.file.fileName}
                {m.file.missing ? " (missing)" : ""}
              </FileLink>
            )}
          </div>
          {canEdit && !editing && m && (
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
              </Button>
              <Button size="icon" variant="ghost" aria-label="Remove measurement" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        {m?.review.needsReview && !editing && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <p>{m.review.reasons.join(". ")}.</p>
            {canEdit && m.review.unsureFields.length > 0 && (
              <Button size="sm" variant="outline" className="mt-2 h-7" disabled={review.isPending} onClick={() => review.mutate(true)}>
                The values are right
              </Button>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
          {fields.map((f) => {
            const value = m?.[f.key] ?? null;
            const over = m?.overrides?.[f.key];
            return (
              <div key={f.key} className="min-w-0">
                <p className="text-xs text-muted-foreground">{f.label}</p>
                {editing ? (
                  <Input
                    className="h-8"
                    inputMode={f.kind === "pitch" ? "text" : "decimal"}
                    aria-label={f.label}
                    placeholder={f.kind === "pitch" ? "6/12" : UNIT[f.kind]}
                    value={draft[f.key] ?? (value == null ? "" : String(value))}
                    onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                  />
                ) : (
                  <p className={`text-sm ${unsure.has(f.key) ? "font-medium text-amber-700 dark:text-amber-400" : ""}`}>
                    {show(value, f.kind)}
                    {over && over.previous != null && <span className="ml-1 text-xs font-normal text-muted-foreground">was {show(over.previous, f.kind)}</span>}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {!editing && m?.pitchBands && m.pitchBands.length > 0 && (
          <p className="text-xs text-muted-foreground">
            By pitch: {m.pitchBands.map((b) => `${b.pitch} ${b.areaSqFt.toLocaleString("en-US")} sq ft`).join(" · ")}
          </p>
        )}
        {!editing && m?.reportWastePct != null && (
          <p className="text-xs text-muted-foreground">Roofr recommends {Math.round(m.reportWastePct * 100)}% waste for this roof (based on asphalt shingles).</p>
        )}
        {!editing && m?.warnings && m.warnings.length > 0 && <p className="text-xs text-muted-foreground">{m.warnings.join(" ")}</p>}

        {editing && (
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" disabled={save.isPending} onClick={() => { setEditing(false); setDraft({}); onDone?.(); }}>
              Cancel
            </Button>
            <Button size="sm" disabled={save.isPending} onClick={onSave}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
      </CardContent>
      {m && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title="Remove this measurement?"
          description={m.file ? "The measurement is removed. The report it was read from stays in Files." : "The measurement is removed."}
          tone="danger"
          confirmLabel="Remove"
          pending={remove.isPending}
          onConfirm={() => remove.mutate()}
        />
      )}
    </Card>
  );
}
