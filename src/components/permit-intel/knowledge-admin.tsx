"use client";

import { useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Textarea } from "@/components/ui/textarea";
import { Callout } from "@/components/shared/callout";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import { jobLabel, type JobLabelInput } from "@/lib/labels/job";
import { CATEGORY_LABEL, TARGET_LABEL, type CorrectionCategory, type CorrectionTarget } from "@/lib/permit-intel/corrections-plan";
import { PERMIT_DOC_TYPES } from "@/lib/permit-intel/doc-types";
import { toneClasses } from "@/lib/ui/tones";
import { cn } from "@/lib/utils";
import { useJurisdictions, usePermitTypes } from "./use-permit-intel";

type Lesson = {
  id: string;
  status: "PROPOSED" | "APPROVED" | "REJECTED" | "RETIRED";
  title: string;
  body: string | null;
  jurisdictionId: string | null;
  permitTypeKey: string | null;
  category: string | null;
  target: string | null;
  check: { requiresDocType?: string } | null;
  occurrences: number;
  lastSeenAt: string | null;
  decidedAt: string | null;
  jurisdiction: { id: string; name: string } | null;
  decidedBy: { firstName: string; lastName: string } | null;
  sources: { id: string; text: string; reviewerItemNumber: string | null; notice: { receivedAt: string }; permit: { id: string; permitType: string | null; job: JobLabelInput & { id: string } } }[];
  seenBeforeApproval: number;
  seenSinceApproval: number | null;
};

const KEY = ["permit-lessons"] as const;
const STATUS_TONE = { PROPOSED: "warning", APPROVED: "success", REJECTED: "neutral", RETIRED: "neutral" } as const;
const STATUS_LABEL = { PROPOSED: "To decide", APPROVED: "Approved", REJECTED: "Rejected", RETIRED: "Retired" } as const;
const NONE = "__none";
const CHECK_ITEMS = [{ value: NONE, label: "No check — shown as a note" }, ...PERMIT_DOC_TYPES.map((t) => ({ value: t.key, label: `Warn when no ${t.label.toLowerCase()} is on the permit` }))];

/**
 * Admin → Permits → Knowledge: what the building departments' reviewers have
 * asked for, learned from corrections they accepted once answered. A lesson
 * is shown at preflight only once approved here — as a note, or as a warning
 * when its check (a document the permit should carry) fails.
 */
export function KnowledgeAdmin() {
  const { data, isLoading, error } = useQuery({ queryKey: KEY, queryFn: () => fetchJson<Lesson[]>("/api/permit-lessons"), retry: retryServerErrors });
  const [filter, setFilter] = useState<"PROPOSED" | "APPROVED" | "ALL">("PROPOSED");
  if (error) return <Callout tone="danger" title="Couldn't load the lessons">{(error as Error).message}</Callout>;
  if (isLoading || !data) return <ListSkeleton rows={4} />;
  const shown = data.filter((l) => filter === "ALL" || l.status === filter);
  const proposed = data.filter((l) => l.status === "PROPOSED").length;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl
          value={filter}
          onValueChange={setFilter}
          size="sm"
          ariaLabel="Which lessons"
          options={[
            { value: "PROPOSED", label: `To decide (${proposed})` },
            { value: "APPROVED", label: `Approved (${data.filter((l) => l.status === "APPROVED").length})` },
            { value: "ALL", label: `All (${data.length})` },
          ]}
        />
        <p className="text-xs text-muted-foreground">Learned when the department accepts a correction KNU answered. Approve the ones worth checking on every permit of that jurisdiction and type.</p>
      </div>
      {shown.length === 0 ? (
        <EmptyState icon={BookOpen} title={filter === "PROPOSED" ? "Nothing to decide" : "No lessons yet"} description="When a building department reviews a resubmission and accepts KNU's answers, the comments it had made become proposed lessons here." />
      ) : (
        shown.map((l) => <LessonCard key={l.id} l={l} />)
      )}
    </div>
  );
}

function LessonCard({ l }: { l: Lesson }) {
  const qc = useQueryClient();
  const { data: jurisdictions = [] } = useJurisdictions(true);
  const { data: types = [] } = usePermitTypes();
  const [title, setTitle] = useState(l.title);
  const [body, setBody] = useState(l.body ?? "");
  const [jurisdictionId, setJurisdictionId] = useState(l.jurisdictionId ?? NONE);
  const [typeKey, setTypeKey] = useState(l.permitTypeKey ?? NONE);
  const [check, setCheck] = useState(l.check?.requiresDocType ?? NONE);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const jItems = [{ value: NONE, label: "Every jurisdiction" }, ...jurisdictions.map((j) => ({ value: j.id, label: j.name }))];
  const tItems = [{ value: NONE, label: "Every permit type" }, ...types.map((t) => ({ value: t.key, label: t.name }))];

  const save = async (status?: Lesson["status"]) => {
    setBusy(true);
    try {
      await fetchJson(`/api/permit-lessons/${l.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body: body || null, jurisdictionId: jurisdictionId === NONE ? null : jurisdictionId, permitTypeKey: typeKey === NONE ? null : typeKey, check: check === NONE ? null : { requiresDocType: check }, ...(status ? { status } : {}) }),
      });
      toast.success(status === "APPROVED" ? "Approved — shown at preflight from now on" : status ? STATUS_LABEL[status] : "Saved");
      qc.invalidateQueries({ queryKey: KEY });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const sel = (id: string, label: string, value: string, items: { value: string; label: string }[], on: (v: string) => void) => (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Select items={items} value={value} onValueChange={(v: string | null) => v && on(v)}>
        <SelectTrigger id={id} className="h-8 w-full text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((i) => (
            <SelectItem key={i.value} value={i.value}>
              {i.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <Card className={cn("min-w-0", (l.status === "REJECTED" || l.status === "RETIRED") && "opacity-70")}>
      <CardHeader className="space-y-1 pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", toneClasses(STATUS_TONE[l.status]).pill)}>{STATUS_LABEL[l.status]}</span>
          <span className="text-xs text-muted-foreground">
            {l.jurisdiction?.name ?? "Every jurisdiction"} · {l.permitTypeKey ? (types.find((t) => t.key === l.permitTypeKey)?.name ?? l.permitTypeKey) : "every type"}
            {l.category ? ` · ${CATEGORY_LABEL[l.category as CorrectionCategory] ?? l.category}` : ""}
            {l.target ? ` · ${TARGET_LABEL[l.target as CorrectionTarget] ?? l.target}` : ""} · asked {l.occurrences} time{l.occurrences === 1 ? "" : "s"}
            {l.seenSinceApproval != null ? ` (${l.seenBeforeApproval} before approval, ${l.seenSinceApproval} since)` : ""}
            {l.decidedBy && l.decidedAt ? ` · ${STATUS_LABEL[l.status].toLowerCase()} ${format(new Date(l.decidedAt), "MMM d, yyyy")} by ${l.decidedBy.firstName} ${l.decidedBy.lastName}` : ""}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <div className="space-y-1">
          <Label htmlFor={`t-${l.id}`} className="text-xs">
            Lesson
          </Label>
          <Input id={`t-${l.id}`} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What the reviewer asked for and how to have it in the package" aria-label="Details" />
        <div className="grid min-w-0 gap-3 sm:grid-cols-3">
          {sel(`j-${l.id}`, "Jurisdiction", jurisdictionId, jItems, setJurisdictionId)}
          {sel(`p-${l.id}`, "Permit type", typeKey, tItems, setTypeKey)}
          {sel(`c-${l.id}`, "Check at preflight", check, CHECK_ITEMS, setCheck)}
        </div>
        <button type="button" className="inline-flex items-center gap-1 text-xs text-primary hover:underline" onClick={() => setOpen((o) => !o)}>
          {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />} The {l.sources.length} comment{l.sources.length === 1 ? "" : "s"} it came from
        </button>
        {open && (
          <ul className="space-y-2 rounded-md border p-2 text-xs">
            {l.sources.map((s) => (
              <li key={s.id}>
                <p className="whitespace-pre-wrap">{s.reviewerItemNumber ? `${s.reviewerItemNumber}. ` : ""}{s.text}</p>
                <Link href={`/permits/${s.permit.id}?tab=corrections`} className="text-muted-foreground hover:underline">
                  {jobLabel(s.permit.job, { customer: false, trade: false }).primary} · {s.permit.permitType ?? "Permit"} · {format(new Date(s.notice.receivedAt), "MMM d, yyyy")}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          {l.status !== "APPROVED" && (
            <Button size="sm" variant="brand" disabled={busy || title.trim().length < 3} onClick={() => save("APPROVED")}>
              Approve
            </Button>
          )}
          <Button size="sm" variant="outline" disabled={busy} onClick={() => save()}>
            Save
          </Button>
          {l.status === "PROPOSED" && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => save("REJECTED")}>
              Reject
            </Button>
          )}
          {l.status === "APPROVED" && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => save("RETIRED")}>
              Retire
            </Button>
          )}
          {(l.status === "REJECTED" || l.status === "RETIRED") && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => save("PROPOSED")}>
              Back to decide
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
