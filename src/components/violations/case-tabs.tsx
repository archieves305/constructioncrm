"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { format } from "date-fns";
import { Camera, FileText, MessageSquare, Pencil, Shield, StickyNote, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Callout } from "@/components/shared/callout";
import { EmptyState } from "@/components/shared/empty-state";
import { UserAvatar } from "@/components/shared/user-avatar";
import { NoteComposer } from "@/components/tasks/note-composer";
import { useAssignableUsers } from "@/components/tasks/use-tasks";
import { JobPhotoGallery } from "@/components/photos/job-photo-gallery";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import { toneClasses } from "@/lib/ui/tones";
import { EVENT_LABEL } from "./status";
import { useCaseAction, violationKeys, type CaseData } from "./use-violations";

type Person = { id: string; firstName: string; lastName: string };

/** The linked job's permits, read-only, plus the case's own permit decision. */
export function PermitsPanel({ data, onSetPermit }: { data: CaseData; onSetPermit: () => void }) {
  const status = data.workflow?.permitStatus ?? null;
  const label = status === "REQUIRED" ? "Permit required" : status === "NOT_REQUIRED" ? "No permit required" : status === "UNDETERMINED" ? "Permit undetermined" : "No workflow yet";
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 pt-4 text-sm">
          <Shield className="size-4 text-muted-foreground" />
          <span className="font-medium">{label}</span>
          {status === "UNDETERMINED" && (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onSetPermit}>
              Set permit status
            </Button>
          )}
          <span className="text-xs text-muted-foreground">The permit itself lives on the corrective job; this is the case&apos;s decision, with the legal warning when “no permit” is chosen.</span>
        </CardContent>
      </Card>
      {data.job ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              Permits on{" "}
              <Link href={`/jobs/${data.job.id}?tab=permits`} className="font-mono text-brand-fg hover:underline">
                {data.job.jobNumber}
              </Link>
            </p>
            <Link href={`/jobs/${data.job.id}?tab=permits`} className="text-xs underline">
              Manage on the job →
            </Link>
          </div>
          {data.job.permits.length === 0 ? (
            <EmptyState icon={Shield} title="No permits on the linked job yet" description="Add the permit on the job's Permits tab; the case's permit steps read it from there." />
          ) : (
            <ul className="space-y-2">
              {data.job.permits.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg border bg-white p-3 text-sm">
                  <Badge variant="outline" className="text-[10px]">
                    {p.status}
                  </Badge>
                  <span className="font-medium">{p.permitNumber ?? "No number yet"}</span>
                  <span className="text-xs text-muted-foreground">{p.permitType ?? ""} · {p.municipality}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {p.submittedDate ? `Submitted ${format(new Date(p.submittedDate), "MMM d")}` : ""}
                    {p.approvedDate ? ` · Issued ${format(new Date(p.approvedDate), "MMM d")}` : ""}
                    {p.finalPassedDate ? ` · Finaled ${format(new Date(p.finalPassedDate), "MMM d")}` : ""}
                    {p.expirationDate ? ` · Expires ${format(new Date(p.expirationDate), "MMM d, yyyy")}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <Callout tone="info" title="No corrective job linked">
          Link or create the construction job from the case header to track permit applications and inspections on it.
        </Callout>
      )}
    </div>
  );
}

type FileRow = { id: string; fileName: string; fileType: string; fileSize: number; category: string; createdAt: string; uploadedBy: Person; violationItem: { id: string; itemNumber: number } | null; task: { id: string; title: string } | null };

/** Case photos (files with category PHOTOS) as a grid, plus the linked job's field photos read-only. */
export function PhotosPanel({ data }: { data: CaseData }) {
  const { data: files = [], isLoading } = useQuery<FileRow[]>({ queryKey: [...violationKeys.files(data.id), "photos"], queryFn: () => fetchJson(`/api/violations/${data.id}/files?category=PHOTOS`), retry: retryServerErrors });
  const photos = files.filter((f) => f.fileType.startsWith("image/"));
  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-sm font-medium">Case photos</p>
        {isLoading ? (
          <Skeleton className="h-32" />
        ) : photos.length === 0 ? (
          <EmptyState icon={Camera} title="No photos on the case yet" description="Upload before/after photos on the Documents tab (category Photos), or on an item." />
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {photos.map((f) => (
              <a key={f.id} href={`/api/files/${f.id}`} target="_blank" rel="noreferrer" className="group relative aspect-square overflow-hidden rounded-md border bg-gray-50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/files/${f.id}`} alt={f.fileName} className="size-full object-cover transition-transform group-hover:scale-105" loading="lazy" />
                <span className="absolute inset-x-0 bottom-0 truncate bg-black/50 px-1.5 py-0.5 text-[10px] text-white">
                  {f.violationItem ? `Item ${f.violationItem.itemNumber} · ` : ""}
                  {format(new Date(f.createdAt), "MMM d")}
                </span>
              </a>
            ))}
          </div>
        )}
      </div>
      {data.job && (
        <div>
          <p className="mb-2 text-sm font-medium">
            From the linked job&apos;s field logs ·{" "}
            <Link href={`/jobs/${data.job.id}?tab=field&sub=photos`} className="font-mono text-brand-fg hover:underline">
              {data.job.jobNumber}
            </Link>
          </p>
          <JobPhotoGallery jobId={data.job.id} readOnly />
        </div>
      )}
    </div>
  );
}

type Comm = { id: string; communicationType: string; direction: string; toValue: string; fromValue: string; subject: string | null; body: string; createdAt: string; createdBy: Person | null };

export function CommunicationsPanel({ data }: { data: CaseData }) {
  const { data: rows = [], isLoading } = useQuery<Comm[]>({ queryKey: violationKeys.communications(data.id), queryFn: () => fetchJson(`/api/violations/${data.id}/communications`), retry: retryServerErrors });
  const log = useCaseAction<Record<string, unknown>, unknown>(data.id, "/communications", { success: "Communication logged" });
  const [type, setType] = useState("CALL");
  const [direction, setDirection] = useState("OUTBOUND");
  const [to, setTo] = useState(data.officerName ?? "");
  const [body, setBody] = useState("");
  return (
    <div className="space-y-4">
      {data.permissions.canEdit && (
        <Card>
          <CardContent className="grid gap-2 pt-4 sm:grid-cols-[120px_130px_1fr]">
            <Select value={type} onValueChange={(v: string | null) => v && setType(v)}>
              <SelectTrigger>
                <SelectValue>{(v: string) => v}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {["CALL", "EMAIL", "SMS"].map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={direction} onValueChange={(v: string | null) => v && setDirection(v)}>
              <SelectTrigger>
                <SelectValue>{(v: string) => (v === "OUTBOUND" ? "To the agency" : "From the agency")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="OUTBOUND">To the agency</SelectItem>
                <SelectItem value="INBOUND">From the agency</SelectItem>
              </SelectContent>
            </Select>
            <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Who" />
            <Textarea className="sm:col-span-3" rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What was said or sent" />
            <div className="flex justify-end sm:col-span-3">
              <Button size="sm" variant="brand" disabled={!body.trim() || log.isPending} onClick={() => log.mutate({ communicationType: type, direction, toValue: to.trim() || null, body: body.trim() }, { onSuccess: () => setBody("") })}>
                <MessageSquare className="size-3.5" /> Log
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      {isLoading ? (
        <Skeleton className="h-24" />
      ) : rows.length === 0 ? (
        <EmptyState icon={MessageSquare} title="No communications logged" description="Calls, emails and texts with the code officer go here and on the lead's Communications tab." />
      ) : (
        <ul className="space-y-2">
          {rows.map((c) => (
            <li key={c.id} className="rounded-lg border bg-white p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="text-[10px]">
                  {c.communicationType} {c.direction === "OUTBOUND" ? "→" : "←"} {c.direction === "OUTBOUND" ? c.toValue : c.fromValue}
                </Badge>
                <span className="ml-auto text-xs text-muted-foreground">
                  {format(new Date(c.createdAt), "MMM d, yyyy h:mm a")}
                  {c.createdBy ? ` · ${c.createdBy.firstName} ${c.createdBy.lastName}` : ""}
                </span>
              </div>
              {c.subject && <p className="mt-1 text-xs font-medium">{c.subject}</p>}
              <p className="mt-1 whitespace-pre-wrap">{c.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type Note = { id: string; body: string | null; editedAt: string | null; createdAt: string; actor: Person | null };

export function NotesPanel({ data, currentUserId }: { data: CaseData; currentUserId: string }) {
  const { data: notes = [], isLoading } = useQuery<Note[]>({ queryKey: violationKeys.notes(data.id), queryFn: () => fetchJson(`/api/violations/${data.id}/notes`), retry: retryServerErrors });
  const { data: users = [] } = useAssignableUsers();
  const add = useCaseAction<{ body: string }, unknown>(data.id, "/notes");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const edit = useCaseAction<{ body: string }, unknown>(data.id, `/notes/${editing ?? ""}`, { method: "PATCH" });
  const [removing, setRemoving] = useState<string | null>(null);
  const remove = useCaseAction<Record<string, never>, unknown>(data.id, `/notes/${removing ?? ""}`, { method: "DELETE", success: "Note deleted" });
  const isManager = data.permissions.canClose; // ADMIN/MANAGER
  return (
    <div className="space-y-4">
      {data.permissions.canComment && <NoteComposer users={users} submitting={add.isPending} onSubmit={(body) => add.mutate({ body })} placeholder="Add a note about the case…" />}
      {isLoading ? (
        <Skeleton className="h-24" />
      ) : notes.length === 0 ? (
        <EmptyState icon={StickyNote} title="No notes yet" />
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-lg border bg-white p-3 text-sm">
              <div className="flex items-center gap-2">
                <UserAvatar user={n.actor} size="xs" />
                <span className="text-xs font-medium">{n.actor ? `${n.actor.firstName} ${n.actor.lastName}` : "System"}</span>
                <span className="text-xs text-muted-foreground">
                  {format(new Date(n.createdAt), "MMM d, yyyy h:mm a")}
                  {n.editedAt ? " · edited" : ""}
                </span>
                {(n.actor?.id === currentUserId || isManager) && (
                  <span className="ml-auto flex gap-1">
                    <button type="button" className="rounded p-1 text-muted-foreground hover:bg-gray-100" title="Edit" onClick={() => { setEditing(n.id); setDraft(n.body ?? ""); }}>
                      <Pencil className="size-3.5" />
                    </button>
                    <button type="button" className="rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-destructive" title="Delete" onClick={() => { setRemoving(n.id); setTimeout(() => remove.mutate({} as never, { onSettled: () => setRemoving(null) }), 0); }}>
                      <Trash2 className="size-3.5" />
                    </button>
                  </span>
                )}
              </div>
              {editing === n.id ? (
                <div className="mt-2 space-y-2">
                  <Textarea rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} />
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                    <Button size="sm" disabled={!draft.trim() || edit.isPending} onClick={() => edit.mutate({ body: draft.trim() }, { onSuccess: () => setEditing(null) })}>
                      Save
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="mt-1.5 whitespace-pre-wrap">{n.body}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type Activity = {
  events: { id: string; type: string; body: string | null; fromValue: string | null; toValue: string | null; createdAt: string; actor: Person | null; itemId: string | null }[];
  audit: { id: string; action: string; entityType: string; entityId: string; actor: Person | null; beforeJson: unknown; afterJson: unknown; createdAt: string }[];
};

export function ActivityPanel({ data }: { data: CaseData }) {
  const { data: act, isLoading } = useQuery<Activity>({ queryKey: violationKeys.activity(data.id), queryFn: () => fetchJson(`/api/violations/${data.id}/activity`), retry: retryServerErrors });
  const [showAudit, setShowAudit] = useState(false);
  if (isLoading || !act) return <Skeleton className="h-32" />;
  const rows: { id: string; at: string; who: Person | null; label: string; body: string | null; audit?: boolean }[] = [
    ...act.events.filter((e) => e.type !== "NOTE").map((e) => ({ id: e.id, at: e.createdAt, who: e.actor, label: EVENT_LABEL[e.type] ?? e.type, body: e.body ?? (e.fromValue || e.toValue ? [e.fromValue, e.toValue].filter(Boolean).join(" → ") : null) })),
    ...(showAudit ? act.audit.map((a) => ({ id: a.id, at: a.createdAt, who: a.actor, label: `audit · ${a.action.replace(/^violation_/, "").replace(/_/g, " ")}`, body: a.afterJson ? JSON.stringify(a.afterJson).slice(0, 200) : null, audit: true })) : []),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return (
    <div className="space-y-3">
      {act.audit.length > 0 && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={showAudit} onChange={(e) => setShowAudit(e.target.checked)} /> Include audit records ({act.audit.length})
        </label>
      )}
      {rows.length === 0 ? (
        <EmptyState icon={FileText} title="No activity yet" />
      ) : (
        <ol className="relative space-y-3 border-l pl-4">
          {rows.map((r) => (
            <li key={r.id} className="text-sm">
              <span className={`absolute -left-1.5 mt-1.5 size-3 rounded-full border-2 border-white ${r.audit ? "bg-gray-300" : toneClasses("info").dot}`} />
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{r.label}</span>
                <span className="text-xs text-muted-foreground">
                  {format(new Date(r.at), "MMM d, yyyy h:mm a")}
                  {r.who ? ` · ${r.who.firstName} ${r.who.lastName}` : ""}
                </span>
              </div>
              {r.body && <p className={`mt-0.5 text-xs ${r.audit ? "break-all font-mono text-muted-foreground" : "text-gray-700"}`}>{r.body}</p>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** A `Label`-less compact key/value grid used by the Overview. */
export function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1.5 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-xs text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-words">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export { Label };
