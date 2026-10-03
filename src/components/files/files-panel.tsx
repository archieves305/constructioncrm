"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { AlertTriangle, Camera, FileText, FolderOpen, Image as ImageIcon, MoreHorizontal, Search, Upload } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import { formatFileSize, uploadProblem } from "@/lib/files/limits";
import { CATEGORY_LABEL, UPLOAD_CATEGORIES, categoryCounts, categoryLabel, filterFiles, groupByCategory, isImageType, type FileCategoryName } from "@/lib/files/scope";
import { jobLabel, type JobLabelInput } from "@/lib/labels/job";
import { FilePreviewDialog } from "./file-preview";

export type FileRecord = {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  category: string;
  createdAt: string;
  jobId: string | null;
  taskId: string | null;
  /** The stored data is gone; the record is kept so it can be uploaded again. */
  missing: boolean;
  /** Written by the CRM (a contract, a signed agreement): never deleted or replaced here. */
  generated: boolean;
  uploadedBy: { id: string; firstName: string; lastName: string };
  job: (JobLabelInput & { id: string }) | null;
  task: { id: string; title: string } | null;
};

/**
 * Files on a record. On a job: the job's own files, and beside them the
 * lead's documents that belong to no job. On a lead: everything on it, each
 * with its job. On a code-violation case or item: that case's files.
 */
export type FilesScope = { leadId: string; jobId?: string; violationCaseId?: string; violationItemId?: string };

type Listing = { files: FileRecord[]; leadFiles: FileRecord[] };

function scopeQuery(scope: FilesScope): { key: readonly unknown[]; url: string } {
  if (scope.violationItemId) return { key: ["violation-item-files", scope.violationItemId], url: `/api/files?violationItemId=${scope.violationItemId}` };
  if (scope.violationCaseId) return { key: ["violation-files", scope.violationCaseId], url: `/api/files?violationCaseId=${scope.violationCaseId}` };
  if (scope.jobId) return { key: ["job-files", scope.jobId], url: `/api/files?jobId=${scope.jobId}` };
  return { key: ["lead-files", scope.leadId], url: `/api/files?leadId=${scope.leadId}` };
}

export function FilesPanel(props: { leadId: string; scope?: FilesScope } | { scope: FilesScope; leadId?: string }) {
  const scope: FilesScope = props.scope ?? { leadId: props.leadId! };
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [uploadCategory, setUploadCategory] = useState<FileCategoryName>(scope.violationCaseId ? "PHOTOS" : "OTHER");
  const [uploadingCount, setUploadingCount] = useState(0);
  const [category, setCategory] = useState<string | null>(null);
  const [missingOnly, setMissingOnly] = useState(false);
  const [q, setQ] = useState("");
  const [preview, setPreview] = useState<{ files: FileRecord[]; index: number } | null>(null);
  const [editing, setEditing] = useState<FileRecord | null>(null);
  const [removing, setRemoving] = useState<FileRecord | null>(null);

  const { key, url } = scopeQuery(scope);
  const { data, isLoading, error, refetch } = useQuery<Listing>({
    queryKey: key,
    // A job answers with its files and the lead's documents; every other scope with one list.
    queryFn: async () => {
      const r = await fetchJson<FileRecord[] | Listing>(url);
      return Array.isArray(r) ? { files: r, leadFiles: [] } : r;
    },
    retry: retryServerErrors,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: key });
    queryClient.invalidateQueries({ queryKey: ["lead-files", scope.leadId] });
    queryClient.invalidateQueries({ queryKey: ["job-files"] });
    queryClient.invalidateQueries({ queryKey: ["job-photos"] });
    if (scope.violationCaseId) {
      queryClient.invalidateQueries({ queryKey: ["violation-files", scope.violationCaseId] });
      queryClient.invalidateQueries({ queryKey: ["violation", scope.violationCaseId] });
    }
  };

  async function handleFiles(fileList: FileList | null) {
    const picked = Array.from(fileList ?? []);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
    if (picked.length === 0) return;
    setUploadingCount(picked.length);
    let ok = 0;
    for (const f of picked) {
      const problem = uploadProblem(f);
      if (problem) {
        toast.error(problem);
        continue;
      }
      const form = new FormData();
      form.append("file", f);
      form.append("leadId", scope.leadId);
      if (scope.jobId) form.append("jobId", scope.jobId);
      if (scope.violationCaseId) form.append("violationCaseId", scope.violationCaseId);
      if (scope.violationItemId) form.append("violationItemId", scope.violationItemId);
      form.append("category", uploadCategory);
      try {
        await fetchJson("/api/files", { method: "POST", body: form });
        ok += 1;
      } catch (e) {
        toast.error(`${f.name}: ${(e as Error).message}`);
      }
    }
    setUploadingCount(0);
    if (ok > 0) toast.success(`Uploaded ${ok} file${ok === 1 ? "" : "s"}`);
    invalidate();
  }

  const remove = useMutation({
    // fetchJson carries the server's reason ("Contract documents cannot be deleted…").
    mutationFn: (id: string) => fetchJson(`/api/files/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("File deleted");
      setRemoving(null);
      invalidate();
    },
    onError: (e: Error) => {
      setRemoving(null);
      toast.error(e.message);
    },
  });

  const move = useMutation({
    mutationFn: ({ id, jobId }: { id: string; jobId: string | null }) =>
      fetchJson(`/api/files/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId }) }),
    onSuccess: (_r, v) => {
      toast.success(v.jobId ? "Attached to this job" : "Moved back to the lead's documents");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const all = useMemo(() => [...(data?.files ?? []), ...(data?.leadFiles ?? [])], [data]);
  const filter = { category, q, missingOnly };
  const own = filterFiles(data?.files ?? [], filter);
  const fromLead = filterFiles(data?.leadFiles ?? [], filter);
  const counts = categoryCounts(all);
  const missingCount = all.filter((f) => f.missing).length;
  const uploading = uploadingCount > 0;
  const filtered = Boolean(category || q.trim() || missingOnly);

  const open = (list: FileRecord[], f: FileRecord) => setPreview({ files: list, index: list.findIndex((x) => x.id === f.id) });

  const row = (f: FileRecord, list: FileRecord[]) => (
    <li key={f.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
      <span className={cn("shrink-0", f.missing ? "text-amber-600" : "text-muted-foreground")}>
        {f.missing ? <AlertTriangle className="size-5" /> : isImageType(f.fileType) ? <ImageIcon className="size-5" /> : <FileText className="size-5" />}
      </span>
      <div className="min-w-0 flex-1">
        <button type="button" onClick={() => open(list, f)} className="block max-w-full truncate text-left font-medium text-gray-900 hover:underline">
          {f.fileName}
        </button>
        <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          {f.missing && <span className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">File missing</span>}
          <span>
            {[formatFileSize(f.fileSize), `${f.uploadedBy.firstName} ${f.uploadedBy.lastName}`, format(new Date(f.createdAt), "MMM d, yyyy")].join(" · ")}
          </span>
          {f.task && <span className="truncate">· Task: {f.task.title}</span>}
          {!scope.jobId && f.job && <span className="truncate">· {jobLabel(f.job, { customer: false, trade: false }).primary} <span className="font-mono text-[10px]">{f.job.jobNumber}</span></span>}
          {f.generated && <span>· Generated by the CRM</span>}
        </div>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button size="icon" variant="ghost" className="size-8 shrink-0" aria-label={`Actions for ${f.fileName}`} />}>
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => open(list, f)}>{f.missing ? "Upload again…" : "Open"}</DropdownMenuItem>
          {!f.missing && <DropdownMenuItem render={<a href={`/api/files/${f.id}?download=1`} />}>Download</DropdownMenuItem>}
          {!f.generated && <DropdownMenuItem onClick={() => setEditing(f)}>Rename or recategorise…</DropdownMenuItem>}
          {scope.jobId && !f.generated && !f.taskId && !f.jobId && <DropdownMenuItem onClick={() => move.mutate({ id: f.id, jobId: scope.jobId! })}>Attach to this job</DropdownMenuItem>}
          {scope.jobId && !f.generated && !f.taskId && f.jobId && <DropdownMenuItem onClick={() => move.mutate({ id: f.id, jobId: null })}>Move to the lead&rsquo;s documents</DropdownMenuItem>}
          {!f.generated && <DropdownMenuItem onClick={() => setRemoving(f)}>Delete</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );

  const groups = (list: FileRecord[]) =>
    groupByCategory(list).map((g) => (
      <section key={g.category}>
        <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {g.label} <span className="font-normal">· {g.files.length}</span>
        </h4>
        <ul className="divide-y rounded-lg border bg-white">{g.files.map((f) => row(f, list))}</ul>
      </section>
    ));

  return (
    <div className="space-y-4">
      {/* Upload */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1 space-y-1 sm:max-w-xs">
          <label className="text-xs text-muted-foreground">Upload as</label>
          <Select value={uploadCategory} onValueChange={(v) => v && setUploadCategory(v as FileCategoryName)}>
            <SelectTrigger className="w-full" aria-label="Upload as">
              <SelectValue>{(v: string) => categoryLabel(v)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {UPLOAD_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>{CATEGORY_LABEL[c]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => handleFiles(e.target.files)} />
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1 sm:hidden" onClick={() => cameraInputRef.current?.click()} disabled={uploading}>
            <Camera className="mr-2 size-4" />
            Photo
          </Button>
          <Button type="button" className="flex-1 sm:flex-none" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            <Upload className="mr-2 size-4" />
            {uploading ? `Uploading ${uploadingCount}…` : "Upload"}
          </Button>
        </div>
      </div>

      {/* Filter */}
      {all.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip active={!category && !missingOnly} onClick={() => { setCategory(null); setMissingOnly(false); }}>All · {all.length}</Chip>
          {counts.map((c) => (
            <Chip key={c.category} active={category === c.category} onClick={() => setCategory(category === c.category ? null : c.category)}>
              {c.label} · {c.count}
            </Chip>
          ))}
          {missingCount > 0 && (
            <Chip active={missingOnly} tone="warning" onClick={() => setMissingOnly(!missingOnly)}>
              Missing · {missingCount}
            </Chip>
          )}
          <div className="relative w-full sm:ml-auto sm:w-56">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name" className="h-8 pl-8" aria-label="Search files by name" />
          </div>
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <ListSkeleton rows={4} />
      ) : error ? (
        <EmptyState icon={FolderOpen} title="The files could not be loaded" description={(error as Error).message} action={<Button variant="outline" onClick={() => refetch()}>Try again</Button>} />
      ) : all.length === 0 ? (
        <EmptyState icon={FolderOpen} title="No files yet" description="Upload photos, estimates, signed documents, permits and anything else that belongs with this record." />
      ) : own.length + fromLead.length === 0 ? (
        <EmptyState icon={FolderOpen} title="No files match" description="Try another category or a different name." action={filtered ? <Button variant="outline" onClick={() => { setCategory(null); setMissingOnly(false); setQ(""); }}>Clear filters</Button> : undefined} />
      ) : (
        <div className="space-y-5">
          {own.length > 0 && <div className="space-y-4">{groups(own)}</div>}
          {fromLead.length > 0 && (
            <div className="space-y-3 rounded-lg border border-dashed p-3">
              <div>
                <h3 className="text-sm font-medium">Lead documents</h3>
                <p className="text-xs text-muted-foreground">On the customer&rsquo;s record and not tied to a job — estimates, and anything uploaded before this job existed.</p>
              </div>
              {groups(fromLead)}
            </div>
          )}
        </div>
      )}

      <FilePreviewDialog files={preview?.files ?? []} index={preview?.index ?? null} onIndexChange={(i) => setPreview(i === null || !preview ? null : { ...preview, index: i })} onChanged={invalidate} />
      <EditFileDialog file={editing} onClose={() => setEditing(null)} onSaved={invalidate} />
      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Delete this file?"
        description={removing ? `"${removing.fileName}" will be removed for everyone. This cannot be undone.` : undefined}
        tone="danger"
        confirmLabel="Delete"
        pending={remove.isPending}
        onConfirm={() => {
          if (removing) remove.mutate(removing.id);
        }}
      />
    </div>
  );
}

function Chip({ active, tone, onClick, children }: { active: boolean; tone?: "warning"; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-xs",
        active
          ? tone === "warning" ? "border-amber-500 bg-amber-500 text-white" : "border-gray-900 bg-gray-900 text-white"
          : tone === "warning" ? "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100" : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50",
      )}
    >
      {children}
    </button>
  );
}

function EditFileDialog({ file, onClose, onSaved }: { file: FileRecord | null; onClose: () => void; onSaved: () => void }) {
  return (
    <Dialog open={Boolean(file)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">{file && <EditFileForm key={file.id} file={file} onClose={onClose} onSaved={onSaved} />}</DialogContent>
    </Dialog>
  );
}

function EditFileForm({ file, onClose, onSaved }: { file: FileRecord; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(file.fileName);
  const [category, setCategory] = useState(file.category);
  // A category the CRM writes (a receipt, a contract) stays as it is unless changed to one a person may pick.
  const choices = (UPLOAD_CATEGORIES as readonly string[]).includes(file.category) ? UPLOAD_CATEGORIES : [file.category, ...UPLOAD_CATEGORIES];

  const save = useMutation({
    mutationFn: () =>
      fetchJson(`/api/files/${file.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(name.trim() !== file.fileName ? { fileName: name } : {}), ...(category !== file.category ? { category } : {}) }),
      }),
    onSuccess: () => {
      toast.success("File updated");
      onSaved();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) save.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>Rename or recategorise</DialogTitle>
        <DialogDescription>The file itself is not changed.</DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5">
        <Label htmlFor="file-name">Name</Label>
        <Input id="file-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoFocus />
      </div>
      <div className="space-y-1.5">
        <Label>Category</Label>
        <Select value={category} onValueChange={(v: string | null) => v && setCategory(v)}>
          <SelectTrigger className="w-full" aria-label="Category">
            <SelectValue>{(v: string) => categoryLabel(v)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {choices.map((c) => (
              <SelectItem key={c} value={c}>{categoryLabel(c)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={!name.trim() || save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
      </DialogFooter>
    </form>
  );
}
