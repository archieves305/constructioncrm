"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { HandCoins, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ComplianceCallout, type ComplianceSummary } from "@/components/vendors/compliance-badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AssigneePicker } from "@/components/tasks/assignee-picker";
import { useAssignableUsers, useInvalidateTasks } from "@/components/tasks/use-tasks";
import { useSession } from "@/lib/auth/session-client";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";
import { canManageJobMoney } from "@/lib/money/access";
import { toneClasses, type Tone } from "@/lib/ui/tones";
import { cn } from "@/lib/utils";

type Person = { id: string; firstName: string; lastName: string };

export type PaymentRequestRow = {
  id: string;
  amount: string;
  note: string | null;
  neededBy: string | null;
  status: "REQUESTED" | "PAID" | "CANCELLED" | "CLOSED_UNPAID";
  createdAt: string;
  requestedBy: Person;
  task: { id: string; status: string; assignedTo: Person | null } | null;
  laborPayment: { id: string; amount: string; paidDate: string } | null;
  lines: { id: string; name: string }[];
};

type Listing = { requests: PaymentRequestRow[]; defaultAssigneeId: string | null };

const STATUS: Record<PaymentRequestRow["status"], { label: string; tone: Tone }> = {
  REQUESTED: { label: "Waiting to be paid", tone: "warning" },
  PAID: { label: "Paid", tone: "success" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
  CLOSED_UNPAID: { label: "Closed — no payment recorded", tone: "danger" },
};

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
/** A day stored at noon UTC: read the date part so it never slips. */
const dayLabel = (iso: string) => format(new Date(`${iso.slice(0, 10)}T12:00:00`), "MMM d");

export const paymentRequestKeys = { contract: (contractId: string) => ["labor-payment-requests", contractId] as const };

/** POST a payment request; shared by the contract card and the schedule dialog. */
export function useRequestPayment(jobId: string, contractId: string) {
  const qc = useQueryClient();
  const invalidateTasks = useInvalidateTasks();
  return useMutation({
    mutationFn: (body: { amount: number; note?: string | null; neededBy?: string | null; assignedUserId?: string | null; lineIds?: string[] }) =>
      fetchJson<PaymentRequestRow>(`/api/labor-contracts/${contractId}/payment-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: paymentRequestKeys.contract(contractId) });
      qc.invalidateQueries({ queryKey: ["labor-contract-tasks", contractId] });
      invalidateTasks([["job", jobId]]);
      const who = r.task?.assignedTo;
      toast.success(who ? `Payment requested — sent to ${who.firstName} ${who.lastName}` : "Payment requested");
    },
    onError: (e: Error) => toast.error(e.message || "Could not request the payment"),
  });
}

/**
 * Payment requests on one labor contract: ask for a payment, see what is
 * waiting, record the payment against a request (money roles), or withdraw it.
 * Each request is an ordinary task for the person it was sent to.
 */
export function LaborPaymentRequests({
  jobId,
  contractId,
  crewName,
  outstanding,
  vendorName,
  vendorCompliance,
  onRecord,
}: {
  jobId: string;
  contractId: string;
  crewName: string;
  /** What is still unpaid on the contract, to pre-fill the amount. */
  outstanding: number;
  /** The contractor's vendor and its document status; a gap is shown in the request dialog and never blocks. */
  vendorName?: string;
  vendorCompliance?: ComplianceSummary | null;
  /** Open the Record payment dialog for this request. */
  onRecord: (request: PaymentRequestRow) => void;
}) {
  const { data: session } = useSession();
  const canRecord = canManageJobMoney(session?.user.role);
  const qc = useQueryClient();
  const invalidateTasks = useInvalidateTasks();
  const { data: users = [] } = useAssignableUsers();
  const { data } = useQuery<Listing>({
    queryKey: paymentRequestKeys.contract(contractId),
    queryFn: () => fetchJson<Listing>(`/api/labor-contracts/${contractId}/payment-requests`),
    retry: retryServerErrors,
  });
  const requests = data?.requests ?? [];
  const defaultAssigneeId = data?.defaultAssigneeId ?? null;

  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [note, setNote] = useState("");
  const [assignee, setAssignee] = useState<string | null>(null);

  const request = useRequestPayment(jobId, contractId);
  const cancel = useMutation({
    mutationFn: (id: string) => fetchJson(`/api/labor-payment-requests/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: paymentRequestKeys.contract(contractId) });
      qc.invalidateQueries({ queryKey: ["labor-contract-tasks", contractId] });
      invalidateTasks([["job", jobId]]);
      toast.success("Payment request withdrawn");
    },
    onError: (e: Error) => toast.error(e.message || "Could not withdraw the request"),
  });

  function start() {
    // What is unpaid and not already asked for.
    const asked = requests.filter((r) => r.status === "REQUESTED").reduce((sum, r) => sum + Number(r.amount), 0);
    const left = Math.round((outstanding - asked) * 100) / 100;
    setAmount(left > 0 ? String(left) : "");
    setNeededBy(new Date().toISOString().slice(0, 10));
    setNote("");
    setAssignee(defaultAssigneeId);
    setOpen(true);
  }

  const valid = Number(amount) > 0 && Boolean(assignee);

  return (
    <div className="space-y-1.5 border-t pt-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Payment requests</span>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={start}>
          <HandCoins className="size-3.5" /> Request payment
        </Button>
      </div>

      {requests.length === 0 ? (
        <p className="text-xs text-muted-foreground">None yet. A request goes to the job&apos;s accountant as a task, with an email.</p>
      ) : (
        <ul className="space-y-1">
          {requests.map((r) => {
            const s = STATUS[r.status];
            const who = r.task?.assignedTo;
            return (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="font-medium tabular-nums">{money(Number(r.amount))}</span>
                  <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-medium", toneClasses(s.tone).pill)}>{s.label}</span>
                  <span className="text-muted-foreground">
                    {r.status === "REQUESTED" && who ? `with ${who.firstName} ${who.lastName}` : `by ${r.requestedBy.firstName} ${r.requestedBy.lastName}`}
                    {r.status === "REQUESTED" && r.neededBy ? ` · needed ${dayLabel(r.neededBy)}` : ` · ${format(new Date(r.createdAt), "MMM d")}`}
                  </span>
                  {(r.note || r.lines.length > 0) && (
                    <span className="truncate text-muted-foreground" title={[r.note, r.lines.map((l) => l.name).join(", ")].filter(Boolean).join(" — ")}>
                      · {r.note ?? r.lines.map((l) => l.name).join(", ")}
                    </span>
                  )}
                </span>
                {r.status === "REQUESTED" && (
                  <span className="flex shrink-0 items-center gap-1">
                    {canRecord && (
                      <Button size="sm" className="h-6 px-2 text-[11px]" onClick={() => onRecord(r)}>
                        Record payment
                      </Button>
                    )}
                    {(canRecord || r.requestedBy.id === session?.user.id) && (
                      <button
                        type="button"
                        className="rounded p-1 text-muted-foreground hover:bg-gray-100 hover:text-foreground"
                        title="Withdraw this request"
                        aria-label="Withdraw this request"
                        disabled={cancel.isPending}
                        onClick={() => cancel.mutate(r.id)}
                      >
                        <X className="size-3.5" />
                      </button>
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request a payment — {crewName}</DialogTitle>
            <DialogDescription>
              This creates a task for the person below and emails them. It closes by itself when the payment is recorded here.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {vendorName && <ComplianceCallout compliance={vendorCompliance} vendorName={vendorName} />}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Amount ($)</Label>
                <Input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
              </div>
              <div>
                <Label className="text-xs">Needed by</Label>
                <Input type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Send to</Label>
              <AssigneePicker
                value={assignee}
                onChange={setAssignee}
                users={users.filter((u) => u.isActive)}
                className="w-full"
                placeholder="Pick who should pay it"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                {defaultAssigneeId
                  ? "Pre-filled with the job's accountant."
                  : "This job has no accountant yet — pick someone, or set the Accounting default under Admin → Workflow Roles."}
              </p>
            </div>
            <div>
              <Label className="text-xs">What it is for (optional)</Label>
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Second draw — tile and cabinets complete" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              size="sm"
              disabled={!valid || request.isPending}
              onClick={() =>
                request.mutate(
                  { amount: Number(amount), neededBy: neededBy || null, note: note || null, assignedUserId: assignee },
                  { onSuccess: () => setOpen(false) },
                )
              }
            >
              {request.isPending ? "Sending…" : "Request payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
