"use client";

import { use, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { ExternalLink, FolderKanban, Phone, Plus } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { BID_OUTCOME_LABEL, BID_STATUS_LABEL } from "@/lib/partners/bid-state";
import { useBidOptions } from "@/components/partners/use-partners";
import { Pill } from "@/components/bids/pill";
import { PLANHUB_STAGE_LABEL } from "@/lib/bids/planhub/parse";
import { AddGcDialog, AwardDialog, ConfirmAwardDialog, ProjectStageDialog, ScopeDecisionDialog } from "@/components/bids/project-dialogs";
import { RecordSubmissionDialog } from "@/components/bids/record-submission-dialog";
import { UploadEstimateButton } from "@/components/bids/upload-estimate-dialog";
import { personLabel, PRIME_LABEL, PRIME_TONE, SCOPE_LABEL, SCOPE_TONE, STAGE_LABEL, STAGE_TONE, useBidProjectAction, useProject, usd, type Award, type Opportunity, type PrimeStatus, type ProjectDetail, type ProposalVersionRow } from "@/components/bids/use-bid-projects";

const when = (d: string | null, f = "MMM d, yyyy") => (d ? format(new Date(d), f) : "—");

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useProject(id);
  if (q.isLoading) return <ListSkeleton rows={6} />;
  if (q.isError || !q.data) return <EmptyState icon={FolderKanban} title="This project could not be loaded" description={(q.error as Error | null)?.message ?? "Not found"} action={<Button variant="outline" render={<Link href="/planhub/projects" />} nativeButton={false}>Back to projects</Button>} />;
  return <Project project={q.data} />;
}

function Project({ project: p }: { project: ProjectDetail }) {
  const [addingGc, setAddingGc] = useState(false);
  const [staging, setStaging] = useState(false);
  const [addingScope, setAddingScope] = useState(false);
  const can = p.permissions;
  const address = [p.address1, p.address2, [p.city, p.state].filter(Boolean).join(", "), p.zipCode].filter(Boolean).join(" · ");
  return (
    <div className="space-y-4">
      <PageHeader
        title={p.name}
        badge={<Pill tone={STAGE_TONE[p.stage]}>{STAGE_LABEL[p.stage]}</Pill>}
        breadcrumb={[{ label: "PlanHub Bids", href: "/planhub" }, { label: "Projects", href: "/planhub/projects" }, { label: p.number }]}
        description={address || "No address yet"}
        actions={
          can.canManage ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setStaging(true)}>Project status…</Button>
              <UploadEstimateButton projectId={p.id} variant="outline" />
              <Button variant="brand" size="sm" onClick={() => setAddingGc(true)} disabled={p.stage === "CANCELLED" || p.stage === "CLOSED"}><Plus className="mr-1.5 size-4" /> Add a GC</Button>
            </div>
          ) : undefined
        }
      />
      {(p.stage === "POSTPONED" || p.stage === "REBIDDING" || p.stage === "CANCELLED") && p.stageReason && (
        <div className="rounded-md border bg-tone-warning-soft p-3 text-sm">{STAGE_LABEL[p.stage]}: {p.stageReason}{p.stageReviewAt && <> — look again on {when(p.stageReviewAt)}</>}</div>
      )}

      {p.planhubSuggestion && (
        <div className="rounded-md border bg-tone-info-soft p-3 text-sm">{p.planhubSuggestion.text}</div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="min-w-0 lg:col-span-1">
          <CardHeader><CardTitle className="text-base">Project</CardTitle></CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <Row label="Number">{p.number}</Row>
            <Row label="Owner / client">{p.ownerName ?? "—"}</Row>
            <Row label="Type">{p.projectType ?? "—"}</Row>
            <Row label="County">{p.county ?? "—"}</Row>
            <Row label="GC bids due to owner">{when(p.ownerBidDueAt, "MMM d, yyyy h:mm a")}</Row>
            <Row label="Prime award expected">{when(p.expectedPrimeAwardAt)}</Row>
            <Row label="Expected start">{when(p.expectedStartAt)}</Row>
            <Row label="KNU owner">{personLabel(p.owner)}</Row>
            <Row label="PlanHub column">{p.planhubStage ? `${PLANHUB_STAGE_LABEL[p.planhubStage]}${p.planhubStageAt ? ` · since ${when(p.planhubStageAt, "MMM d")}` : ""}` : "—"}</Row>
            <Row label="Due to the GC (PlanHub)">{when(p.planhubDueAt, "MMM d, yyyy")}</Row>
            <Row label="PlanHub">{p.platformUrl ? <a className="inline-flex items-center gap-1 underline" href={p.platformUrl} target="_blank" rel="noreferrer">Open <ExternalLink className="size-3" /></a> : (p.platformRef ?? "—")}</Row>
            <div className="pt-2">
              <p className="mb-1 text-xs font-medium text-muted-foreground">Scopes</p>
              <div className="flex flex-wrap gap-1">{p.scopes.map((s) => <Pill key={s.id} tone="neutral">{s.label}</Pill>)}</div>
              {can.canManage && <Button variant="ghost" size="sm" className="mt-1 h-7 px-2 text-xs" onClick={() => setAddingScope((x) => !x)}>+ Add a scope</Button>}
              {addingScope && <AddScope projectId={p.id} taken={p.scopes.map((s) => s.serviceCategoryId)} onDone={() => setAddingScope(false)} />}
            </div>
          </CardContent>
        </Card>

        <div className="min-w-0 space-y-3 lg:col-span-2">
          <Proposals project={p} />
          <h2 className="text-sm font-semibold">GCs bidding this project ({p.opportunities.length}{p.hiddenOpportunities ? ` · ${p.hiddenOpportunities} not yours` : ""})</h2>
          {p.opportunities.length === 0 ? (
            <EmptyState icon={FolderKanban} title="No GC yet" description="Add each general contractor you are pricing this job for." action={can.canManage ? <Button variant="brand" onClick={() => setAddingGc(true)}><Plus className="mr-1.5 size-4" />Add a GC</Button> : undefined} />
          ) : (
            p.opportunities.map((o) => <GcCard key={o.id} o={o} canManage={can.canManage} canAdmin={can.canAdmin} />)
          )}
        </div>
      </div>
      <AddGcDialog project={p} open={addingGc} onOpenChange={setAddingGc} />
      <ProjectStageDialog project={p} open={staging} onOpenChange={setStaging} />
    </div>
  );
}

const VERSION_TONE = { EXTRACTING: "info", REVIEW: "warning", FAILED: "danger", VERIFIED: "success", SUPERSEDED: "neutral" } as const;
const VERSION_LABEL = { EXTRACTING: "Reading", REVIEW: "Needs checking", FAILED: "Type the values", VERIFIED: "Checked", SUPERSEDED: "Superseded" } as const;

function Proposals({ project: p }: { project: ProjectDetail }) {
  const [sending, setSending] = useState<ProposalVersionRow | null>(null);
  const versions = p.proposals.flatMap((pr) => pr.versions.map((v) => ({ ...v, title: pr.number ? `${pr.number} · ${pr.title}` : pr.title })));
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">Proposals</CardTitle>
        {p.permissions.canManage && versions.length === 0 && <UploadEstimateButton projectId={p.id} variant="outline" />}
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {versions.length === 0 && <p className="text-muted-foreground">No proposal yet. Upload KNU&rsquo;s estimate: the AI reads it and you check it before it can be recorded as sent.</p>}
        {versions.map((v) => (
          <div key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/planhub/proposals/${v.id}`} className="font-medium hover:underline">{v.title} · v{v.version}</Link>
                <Pill tone={VERSION_TONE[v.status]}>{VERSION_LABEL[v.status]}</Pill>
                {v.organization && <Pill tone="info">For {v.organization.name} only</Pill>}
              </div>
              <p className="text-xs text-muted-foreground">
                {v.total != null ? usd(v.total) : "No total yet"}{v.validUntil ? ` · good until ${when(v.validUntil)}` : ""} · {v.submissions} sent{v.file ? <> · <a className="underline" href={`/api/files/${v.file.id}`} target="_blank" rel="noreferrer">{v.file.fileName}</a></> : null}
              </p>
            </div>
            {p.permissions.canManage && v.status === "VERIFIED" && <Button size="sm" variant="brand" onClick={() => setSending(v)}>Record as sent…</Button>}
            {p.permissions.canManage && (v.status === "REVIEW" || v.status === "FAILED") && <Button size="sm" variant="outline" render={<Link href={`/planhub/proposals/${v.id}`} />} nativeButton={false}>Check it</Button>}
          </div>
        ))}
      </CardContent>
      {sending && <RecordSubmissionDialog project={p} version={sending} open onOpenChange={(o) => !o && setSending(null)} />}
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right">{children}</span>
    </div>
  );
}

function AddScope({ projectId, taken, onDone }: { projectId: string; taken: string[]; onDone: () => void }) {
  const { data: options } = useBidOptions();
  const add = useBidProjectAction<{ scopes: { serviceCategoryId: string }[] }>(`/api/bid-projects/${projectId}/scopes`, "POST", "Scope added");
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {(options?.trades ?? []).filter((t) => !taken.includes(t.value)).map((t) => (
        <Button key={t.value} size="sm" variant="outline" className="h-7 rounded-full text-xs" disabled={add.isPending} onClick={() => add.mutate({ scopes: [{ serviceCategoryId: t.value }] }, { onSuccess: onDone })}>{t.label}</Button>
      ))}
    </div>
  );
}

const PRIME_CHOICES: PrimeStatus[] = ["PENDING", "GC_AWARDED", "GC_LOST", "REBIDDING", "CANCELLED", "UNKNOWN"];

function GcCard({ o, canManage, canAdmin }: { o: Opportunity & { awards: Award[] }; canManage: boolean; canAdmin: boolean }) {
  const [awarding, setAwarding] = useState(false);
  const [decision, setDecision] = useState<{ id: string; label: string; status: Opportunity["scopes"][number]["status"] } | null>(null);
  const [confirming, setConfirming] = useState<Award | null>(null);
  const prime = useBidProjectAction<{ primeStatus: PrimeStatus; note?: string | null }>(`/api/bids/${o.id}/prime`, "POST", "Prime status saved");
  const phone = o.contact?.mobile ?? o.contact?.phone ?? null;
  const open = o.status !== "CLOSED";
  const pending = o.scopes.some((s) => s.status === "PENDING");
  return (
    <Card>
      <CardContent className="space-y-2 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/partners/${o.organizationId}`} className="font-medium hover:underline">{o.organization.name}</Link>
              <Link href={`/leads/${o.leadId}?tab=bid`} className="font-mono text-2xs text-muted-foreground hover:underline">{o.number}</Link>
              <Pill tone={open ? "info" : "neutral"}>{open ? BID_STATUS_LABEL[o.status] : o.outcome ? BID_OUTCOME_LABEL[o.outcome] : "Closed"}</Pill>
              <Pill tone={PRIME_TONE[o.primeStatus]}>{PRIME_LABEL[o.primeStatus]}</Pill>
            </div>
            <p className="text-xs text-muted-foreground">
              {o.contact ? `${o.contact.firstName} ${o.contact.lastName}${o.contact.email ? ` · ${o.contact.email}` : " · no email"}` : "No GC contact yet"} · KNU: {personLabel(o.owner)}
              {o.pmUser && <> · PM {personLabel(o.pmUser)}</>}
            </p>
            <p className="text-xs text-muted-foreground">
              Due to GC {when(o.bidDueAt, "MMM d, h:mm a")} · {o.latestAmount != null ? `sent ${usd(o.latestAmount)}${o.submittedAt ? ` on ${when(o.submittedAt, "MMM d")}` : ""}` : "not sent yet"}
              {o.expectedAwardAt && <> · decision expected {when(o.expectedAwardAt, "MMM d")}</>}
            </p>
            {o.nextActionAt && open && <p className="text-xs font-medium">Next: {o.nextActionLabel ?? "Follow up"} · {when(o.nextActionAt, "EEE MMM d, h:mm a")}</p>}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {phone && <Button variant="outline" size="sm" render={<a href={`tel:${phone.replace(/[^\d+]/g, "")}`} />} nativeButton={false}><Phone className="mr-1.5 size-4" /> Call</Button>}
            <Button variant="outline" size="sm" render={<Link href={`/leads/${o.leadId}?tab=bid`} />} nativeButton={false}>Open bid</Button>
            {canManage && (
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>Prime…</DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {PRIME_CHOICES.filter((s) => s !== o.primeStatus).map((s) => (
                    <DropdownMenuItem key={s} onClick={() => prime.mutate({ primeStatus: s })}>{PRIME_LABEL[s]}</DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {canManage && pending && <Button variant="brand" size="sm" onClick={() => setAwarding(true)}>Record award</Button>}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {o.scopes.map((s) => (
            <button key={s.id} type="button" disabled={!canManage || s.status === "AWARDED" || s.status === "EXECUTED"} onClick={() => setDecision({ id: s.id, label: `${s.scope.label} — ${o.organization.name}`, status: s.status })} className="disabled:cursor-default" title={canManage ? "Record a loss, a withdrawal, or reopen" : undefined}>
              <Pill tone={SCOPE_TONE[s.status]}>{s.scope.label}: {SCOPE_LABEL[s.status]}</Pill>
            </button>
          ))}
        </div>
        {o.awards.length > 0 && (
          <ul className="space-y-1 border-t pt-2 text-xs">
            {o.awards.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2">
                <Pill tone={a.kind === "VERBAL" ? "warning" : "success"}>{a.kind === "VERBAL" ? "Verbal" : a.kind === "WRITTEN" ? "Written award" : "Signed subcontract"}</Pill>
                <span>{usd(a.amount)} · {when(a.awardedAt, "MMM d")}</span>
                {a.job && <Link href={`/jobs/${a.job.id}`} className="underline">{a.job.jobNumber}</Link>}
                {a.kind === "VERBAL" && canAdmin && <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => setConfirming(a)}>Confirm in writing</Button>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <AwardDialog opp={o} open={awarding} onOpenChange={setAwarding} canConfirm={canAdmin} />
      {decision && <ScopeDecisionDialog oppScopeId={decision.id} label={decision.label} current={decision.status} open onOpenChange={(v) => !v && setDecision(null)} />}
      {confirming && <ConfirmAwardDialog opp={o} awardId={confirming.id} amount={confirming.amount} open onOpenChange={(v) => !v && setConfirming(null)} />}
    </Card>
  );
}
