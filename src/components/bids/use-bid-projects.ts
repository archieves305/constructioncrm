"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import type { Bid, LossReason } from "@/components/partners/use-partners";

/** PlanHub bid projects: the project, its GCs (opportunities), scopes and awards. */

export type ProjectStage = "OPEN" | "PRIME_AWARDED" | "POSTPONED" | "REBIDDING" | "CANCELLED" | "CLOSED";
export type PrimeStatus = "UNKNOWN" | "PENDING" | "GC_AWARDED" | "GC_LOST" | "REBIDDING" | "CANCELLED";
export type ScopeStatus = "PENDING" | "VERBAL" | "AWARDED" | "EXECUTED" | "LOST" | "WITHDRAWN" | "NO_BID" | "CANCELLED";
export type AwardKind = "VERBAL" | "WRITTEN" | "EXECUTED";
type Person = { id: string; firstName: string; lastName: string; isActive?: boolean };

export type OpportunityScope = { id: string; status: ScopeStatus; quotedAmount: number | null; awardId: string | null; lossReason: LossReason | null; decidedAt: string | null; scope: { id: string; label: string; serviceCategoryId: string } };

/** A GC opportunity: the partners module's bid plus the project fields. */
export type Opportunity = Bid & {
  bidProjectId: string | null;
  primeStatus: PrimeStatus;
  pmUserId: string | null;
  pmUser: Person | null;
  nextActionAt: string | null;
  nextActionLabel: string | null;
  lastMeaningfulContactAt: string | null;
  bidProject: { id: string; number: string; name: string; stage: ProjectStage } | null;
  scopes: OpportunityScope[];
  owner: Person | null;
};

export type Award = { id: string; kind: AwardKind; amount: number; awardedAt: string; evidenceFileId: string | null; notes: string | null; job: { id: string; jobNumber: string; title: string } | null; scopeIds: string[] };

export type ProjectDetail = {
  id: string;
  number: string;
  name: string;
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  county: string | null;
  timeZone: string;
  source: string;
  platformRef: string | null;
  platformUrl: string | null;
  ownerName: string | null;
  projectType: string | null;
  stage: ProjectStage;
  stageReason: string | null;
  stageReviewAt: string | null;
  ownerBidDueAt: string | null;
  expectedPrimeAwardAt: string | null;
  expectedStartAt: string | null;
  notes: string | null;
  owner: Person | null;
  scopes: { id: string; label: string; serviceCategoryId: string; serviceCategory: { name: string } }[];
  opportunities: (Opportunity & { awards: Award[] })[];
  proposals: ProposalRow[];
  hiddenOpportunities: number;
  permissions: { canManage: boolean; canAdmin: boolean };
};

export type ProposalVersionRow = {
  id: string;
  version: number;
  status: "EXTRACTING" | "REVIEW" | "VERIFIED" | "FAILED" | "SUPERSEDED";
  total: number | null;
  bundleAdjustment: number | null;
  proposalDate: string | null;
  validUntil: string | null;
  organizationId: string | null;
  organization: { name: string } | null;
  verifiedAt: string | null;
  createdAt: string;
  file: { id: string; fileName: string } | null;
  lines: { scopeId: string | null; kind: string; amount: number; description: string | null }[];
  submissions: number;
};
export type ProposalRow = { id: string; number: string | null; title: string; versions: ProposalVersionRow[] };

export type ProjectRow = {
  id: string;
  number: string;
  name: string;
  city: string | null;
  county: string | null;
  stage: ProjectStage;
  source: string;
  ownerBidDueAt: string | null;
  updatedAt: string;
  owner: Person | null;
  scopes: { id: string; label: string }[];
  gcCount: number;
  openGcCount: number;
  nextSubDueAt: string | null;
  nextActionAt: string | null;
  gcs: { id: string; name: string; status: string; primeStatus: PrimeStatus }[];
};

export type Queue = "mine" | "deadlines" | "ready" | "awaiting" | "gc_awarded" | "unassigned" | "history";

export const STAGE_LABEL: Record<ProjectStage, string> = { OPEN: "Open", PRIME_AWARDED: "Prime awarded", POSTPONED: "Postponed", REBIDDING: "Rebidding", CANCELLED: "Cancelled", CLOSED: "Closed" };
export const STAGE_TONE: Record<ProjectStage, "neutral" | "info" | "warning" | "success" | "danger"> = { OPEN: "info", PRIME_AWARDED: "success", POSTPONED: "warning", REBIDDING: "warning", CANCELLED: "danger", CLOSED: "neutral" };
export const PRIME_LABEL: Record<PrimeStatus, string> = { UNKNOWN: "Prime: not known", PENDING: "Owner deciding", GC_AWARDED: "GC won the job", GC_LOST: "GC lost the job", REBIDDING: "Rebidding", CANCELLED: "Cancelled" };
export const PRIME_TONE: Record<PrimeStatus, "neutral" | "info" | "warning" | "success" | "danger"> = { UNKNOWN: "neutral", PENDING: "info", GC_AWARDED: "success", GC_LOST: "danger", REBIDDING: "warning", CANCELLED: "danger" };
export const SCOPE_LABEL: Record<ScopeStatus, string> = { PENDING: "Pending", VERBAL: "Verbal", AWARDED: "Awarded", EXECUTED: "Signed", LOST: "Lost", WITHDRAWN: "Withdrawn", NO_BID: "Not bid", CANCELLED: "Cancelled" };
export const SCOPE_TONE: Record<ScopeStatus, "neutral" | "info" | "warning" | "success" | "danger"> = { PENDING: "neutral", VERBAL: "warning", AWARDED: "success", EXECUTED: "success", LOST: "danger", WITHDRAWN: "neutral", NO_BID: "neutral", CANCELLED: "neutral" };
export const QUEUE_LABEL: Record<Queue, string> = { mine: "My follow-ups", deadlines: "Bid deadlines", ready: "Ready to submit", awaiting: "Awaiting award", gc_awarded: "GC awarded · KNU pending", unassigned: "Unassigned", history: "Won / lost" };
export const QUEUE_HINT: Record<Queue, string> = {
  mine: "Open GC opportunities you own, estimate or manage — soonest next action first",
  deadlines: "Not yet submitted, due within two weeks or already late",
  ready: "Priced and checked; waiting to go out",
  awaiting: "Submitted; the owner has not picked a GC yet",
  gc_awarded: "The GC won the job and our scope is still undecided — call first",
  unassigned: "No owner, or the owner has left: pick someone",
  history: "Closed opportunities, newest first",
};

const json = (body: unknown, method: string): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export function useInvalidateBidProjects() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["bid-projects"] });
    qc.invalidateQueries({ queryKey: ["bids"] });
    qc.invalidateQueries({ queryKey: ["partners"] });
  };
}

export function useProjects(params: URLSearchParams) {
  const key = params.toString();
  return useQuery<{ rows: ProjectRow[]; total: number; canManage: boolean }>({ queryKey: ["bid-projects", "list", key], queryFn: () => fetchJson(`/api/bid-projects?${key}`), retry: retryServerErrors });
}

export function useProject(id: string) {
  return useQuery<ProjectDetail>({ queryKey: ["bid-projects", "detail", id], queryFn: () => fetchJson(`/api/bid-projects/${id}`), retry: retryServerErrors });
}

export function useQueue(queue: Queue, params: URLSearchParams) {
  const key = params.toString();
  return useQuery<{ rows: Opportunity[]; total: number; canManage: boolean }>({ queryKey: ["bid-projects", "queue", queue, key], queryFn: () => fetchJson(`/api/bid-projects/queues?queue=${queue}&${key}`), retry: retryServerErrors });
}

export function useQueueCounts() {
  return useQuery<{ counts: Record<Queue, number> }>({ queryKey: ["bid-projects", "counts"], queryFn: () => fetchJson("/api/bid-projects/queues?counts=1"), retry: retryServerErrors, staleTime: 30_000 });
}

/** One POST/PUT/PATCH with a toast; every bid-project query refreshes after it. */
export function useBidProjectAction<I, O = unknown>(url: string | ((i: I) => string), method: "POST" | "PUT" | "PATCH", success: string | ((o: O) => string)) {
  const invalidate = useInvalidateBidProjects();
  return useMutation({
    mutationFn: (input: I) => fetchJson<O>(typeof url === "function" ? url(input) : url, json(input, method)),
    onSuccess: (o: O) => {
      invalidate();
      toast.success(typeof success === "function" ? success(o) : success);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export const usd = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }));
export const personLabel = (p: Person | null | undefined) => (p ? `${p.firstName} ${p.lastName}${p.isActive === false ? " (inactive)" : ""}` : "Unassigned");

/** Upload one file onto a lead (the GC's) and return its id — for award evidence. */
export async function uploadToLead(leadId: string, file: File, category = "SIGNED_DOC"): Promise<string> {
  const form = new FormData();
  form.set("file", file);
  form.set("leadId", leadId);
  form.set("category", category);
  const res = await fetchJson<{ id: string }>("/api/files", { method: "POST", body: form });
  return res.id;
}
