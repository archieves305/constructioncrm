"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { toast } from "sonner";
import { useSession } from "@/lib/auth/session-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/shared/empty-state";
import { Callout } from "@/components/shared/callout";
import { toneClasses } from "@/lib/ui/tones";
import { CONTRACT_STATUS_LABEL, CONTRACT_STATUS_TONE, contractStatusLine, isSendLinkExpired } from "@/lib/customer-contracts/status";
import { canManageContracts, canVoidSignedContract } from "@/lib/customer-contracts/access";
import { Ban, Copy, Download, FileSignature, FileText, MoreHorizontal, RefreshCw, Send, ShieldCheck, Trash2 } from "lucide-react";
import {
  useDeleteContract,
  useJobContracts,
  useRegenerateContract,
  useSendContract,
  useVoidContract,
  type ContractRowData,
} from "@/components/customer-contracts/use-customer-contracts";

const money = (v: string | number) => `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function ContractPanel({
  jobId,
  job,
}: {
  jobId: string;
  job: { contractAmount: string; jobType: string; billingMethod?: string | null; lead: { email: string | null; fullName: string } };
}) {
  const { data: session } = useSession();
  const role = session?.user.role;
  const canManage = role ? canManageContracts(role) : false;
  const canVoidSigned = role ? canVoidSignedContract(role) : false;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: contracts = [], isLoading, error } = useJobContracts(jobId);
  const regenerate = useRegenerateContract(jobId);
  const remove = useDeleteContract(jobId);
  const [sending, setSending] = useState<{ contract: ContractRowData; resend: boolean } | null>(null);
  const [voiding, setVoiding] = useState<ContractRowData | null>(null);
  const [certificate, setCertificate] = useState<ContractRowData | null>(null);

  function goToEstimates() {
    const next = new URLSearchParams(searchParams.toString());
    next.set("tab", "money");
    next.set("sub", "estimates");
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  const signed = contracts.find((c) => c.status === "SIGNED");
  const jobAmount = Number(job.contractAmount);
  const drift = signed ? Math.round((jobAmount - Number(signed.contractAmount)) * 100) / 100 : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Contracts ({contracts.length})</h3>
          <p className="text-xs text-muted-foreground">Generated from an accepted estimate; sent to the customer to e-sign. Signing sets the job&rsquo;s contract amount.</p>
        </div>
        {canManage && job.jobType !== "OWNED_REHAB" && (
          <Button size="sm" variant="outline" onClick={goToEstimates}>
            <FileSignature className="mr-1 h-3.5 w-3.5" /> Generate from estimate…
          </Button>
        )}
      </div>

      {job.jobType === "OWNED_REHAB" && <Callout tone="info">An owned-rehab job has no customer to contract with.</Callout>}

      {signed && drift !== 0 && (
        <Callout tone="warning" title={`Signed ${money(signed.contractAmount)} · job contract now ${money(jobAmount)}`}>
          The difference of {money(Math.abs(drift))} comes from approved change orders or a manual edit on the Pricing card. The signed agreement is the base; nothing here changes it.
        </Callout>
      )}

      {error ? (
        <Callout tone="danger" title="Couldn't load contracts">{error instanceof Error ? error.message : "Something went wrong."}</Callout>
      ) : isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : contracts.length === 0 ? (
        <EmptyState
          icon={FileSignature}
          title="No contract yet"
          description="Mark an estimate accepted on the Estimates tab, then generate the customer agreement from it."
          action={canManage && job.jobType !== "OWNED_REHAB" ? <Button variant="brand" onClick={goToEstimates}>Go to estimates</Button> : undefined}
        />
      ) : (
        <div className="space-y-3">
          {contracts.map((c) => {
            const tone = toneClasses(CONTRACT_STATUS_TONE[c.status]);
            const source = c.estimate ? `${c.estimate.estimateNumber} · ${c.estimate.name}` : c.roofEstimate ? `${c.roofEstimate.estimateNumber} · Roofing proposal` : "estimate removed";
            const expired = isSendLinkExpired(c);
            const pdfHref = (kind: "unsigned" | "signed", download = false) => `/api/customer-contracts/${c.id}/pdf?kind=${kind}${download ? "&download=1" : ""}`;
            return (
              <Card key={c.id} className={c.status === "VOID" ? "opacity-70" : undefined}>
                <CardContent className="px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{c.contractNumber}</span>
                        <span className="text-xs text-muted-foreground">v{c.snapshotVersion}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone.pill}`}>{CONTRACT_STATUS_LABEL[c.status]}</span>
                        {expired && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${toneClasses("warning").pill}`}>Link expired</span>}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {c.templateVersion.title} (v{c.templateVersion.version}) · from {source} · {format(new Date(c.createdAt), "MMM d, yyyy")} · {c.createdBy.firstName} {c.createdBy.lastName}
                      </p>
                      <p className="mt-1 text-xs">{contractStatusLine(c)}</p>
                      {c.status === "SIGNED" && c.moneyApplyNote && <p className="mt-1 text-xs text-tone-warning-fg">{c.moneyApplyNote}</p>}
                    </div>
                    <div className="text-right">
                      <div className="text-xl font-bold text-emerald-700">{money(c.contractAmount)}</div>
                      <div className="text-xs text-muted-foreground">deposit {money(c.depositAmount)}</div>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {c.status === "DRAFT" && canManage && (
                      <Button size="sm" variant="brand" onClick={() => setSending({ contract: c, resend: false })}>
                        <Send className="mr-1 h-3.5 w-3.5" /> Send to customer…
                      </Button>
                    )}
                    {c.status === "SENT" && canManage && (
                      <Button size="sm" variant="outline" onClick={() => setSending({ contract: c, resend: true })}>
                        <Send className="mr-1 h-3.5 w-3.5" /> {expired ? "Resend (new link)" : "Resend"}
                      </Button>
                    )}
                    {c.status === "SIGNED" && (
                      <Button size="sm" variant="brand" onClick={() => window.open(pdfHref("signed"), "_blank", "noopener")}>
                        <Download className="mr-1 h-3.5 w-3.5" /> Signed PDF
                      </Button>
                    )}
                    {c.status === "DECLINED" && canManage && (
                      <Button size="sm" variant="outline" onClick={goToEstimates}>
                        <RefreshCw className="mr-1 h-3.5 w-3.5" /> Generate a new one
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => window.open(pdfHref("unsigned"), "_blank", "noopener")}>
                      <FileText className="mr-1 h-3.5 w-3.5" /> {c.status === "SIGNED" ? "Unsigned copy" : "Preview PDF"}
                    </Button>
                    {c.status === "SIGNED" && (
                      <Button size="sm" variant="ghost" onClick={() => setCertificate(c)}>
                        <ShieldCheck className="mr-1 h-3.5 w-3.5" /> Certificate
                      </Button>
                    )}
                    {canManage && c.status !== "VOID" && c.status !== "DECLINED" && (
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button size="sm" variant="ghost" aria-label="More" />}>
                          <MoreHorizontal className="h-4 w-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          {c.status === "DRAFT" && (
                            <>
                              <DropdownMenuItem disabled={regenerate.isPending} onClick={() => regenerate.mutate({ id: c.id })}>
                                <RefreshCw className="size-4" /> Regenerate from estimate
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {
                                  if (confirm(`Delete draft ${c.contractNumber}? Its PDFs stay in Files.`)) remove.mutate(c.id);
                                }}
                              >
                                <Trash2 className="size-4" /> Delete draft
                              </DropdownMenuItem>
                            </>
                          )}
                          {c.status === "SENT" && (
                            <DropdownMenuItem
                              onClick={async () => {
                                try {
                                  const r = await fetch(`/api/customer-contracts/${c.id}/sign-link`).then((x) => x.json());
                                  if (!r.signUrl) throw new Error(r.error || "No link");
                                  await navigator.clipboard?.writeText(r.signUrl);
                                  toast.success("Signing link copied");
                                } catch (e) {
                                  toast.error(e instanceof Error ? e.message : "Could not copy the link");
                                }
                              }}
                            >
                              <Copy className="size-4" /> Copy signing link
                            </DropdownMenuItem>
                          )}
                          {(c.status === "SENT" || (c.status === "SIGNED" && canVoidSigned) || c.status === "DRAFT") && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => setVoiding(c)}>
                                <Ban className="size-4" /> Void…
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <SendContractDialog jobId={jobId} state={sending} defaultEmail={job.lead.email} onOpenChange={(o) => !o && setSending(null)} />
      <VoidContractDialog jobId={jobId} contract={voiding} onOpenChange={(o) => !o && setVoiding(null)} />
      <ContractCertificateDialog contract={certificate} onOpenChange={(o) => !o && setCertificate(null)} />
    </div>
  );
}

function SendContractDialog({
  jobId,
  state,
  defaultEmail,
  onOpenChange,
}: {
  jobId: string;
  state: { contract: ContractRowData; resend: boolean } | null;
  defaultEmail: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const send = useSendContract(jobId);
  const [to, setTo] = useState("");
  const [message, setMessage] = useState("");
  const [key, setKey] = useState<string | null>(null);
  const [result, setResult] = useState<{ signUrl: string; emailed: boolean } | null>(null);
  const c = state?.contract;
  if (c && key !== c.id + String(state?.resend)) {
    setKey(c.id + String(state?.resend));
    setTo(c.sentToEmail ?? defaultEmail ?? "");
    setMessage("");
    setResult(null);
  }
  return (
    <Dialog open={Boolean(state)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{state?.resend ? `Resend ${c?.contractNumber}` : `Send ${c?.contractNumber} for signature`}</DialogTitle>
        </DialogHeader>
        {result ? (
          <div className="space-y-3 text-sm">
            <p>{result.emailed ? `Emailed to ${to}.` : "Email is not configured, so nothing was sent — share the link yourself:"}</p>
            <div className="flex gap-2">
              <Input readOnly value={result.signUrl} onFocus={(e) => e.currentTarget.select()} />
              <Button
                variant="outline"
                onClick={() => {
                  void navigator.clipboard?.writeText(result.signUrl);
                  toast.success("Link copied");
                }}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <div>
              <Label className="text-xs">Send to</Label>
              <Input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="customer@example.com" />
            </div>
            <div>
              <Label className="text-xs">Message (optional)</Label>
              <Textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Shown above the Review & Sign button." />
            </div>
            <p className="text-xs text-muted-foreground">
              The customer gets the agreement as a PDF plus a private signing link that expires 30 days after sending.
              {state?.resend ? " Resending issues a fresh link; the previous link stops working." : ""}
            </p>
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                variant="brand"
                disabled={!c || send.isPending || !to.trim()}
                onClick={() =>
                  c &&
                  send.mutate(
                    { id: c.id, resend: Boolean(state?.resend), to: to.trim(), message: message.trim() || null },
                    { onSuccess: (r) => setResult({ signUrl: r.signUrl, emailed: r.emailed }) },
                  )
                }
              >
                <Send className="mr-1 h-4 w-4" /> {state?.resend ? "Resend" : "Send contract"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function VoidContractDialog({ jobId, contract, onOpenChange }: { jobId: string; contract: ContractRowData | null; onOpenChange: (open: boolean) => void }) {
  const voidIt = useVoidContract(jobId);
  const [reason, setReason] = useState("");
  const [key, setKey] = useState<string | null>(null);
  if (contract && key !== contract.id) {
    setKey(contract.id);
    setReason("");
  }
  return (
    <Dialog open={Boolean(contract)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Void {contract?.contractNumber}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            {contract?.status === "SIGNED"
              ? "The signed agreement stays on file as evidence, but the job's contract amount set by it is reversed."
              : "The customer's signing link stops working immediately. The contract stays in the list for the record."}
          </p>
          <div>
            <Label className="text-xs">Reason</Label>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!contract || !reason.trim() || voidIt.isPending}
              onClick={() => contract && voidIt.mutate({ id: contract.id, reason: reason.trim() }, { onSuccess: () => onOpenChange(false) })}
            >
              <Ban className="mr-1 h-4 w-4" /> Void contract
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ContractCertificateDialog({ contract: c, onOpenChange }: { contract: ContractRowData | null; onOpenChange: (open: boolean) => void }) {
  const rows: [string, string | null][] = c
    ? [
        ["Contract", `${c.contractNumber} v${c.snapshotVersion}`],
        ["Record id", c.id],
        ["Sent", c.sentAt ? `${format(new Date(c.sentAt), "MMM d, yyyy h:mm a")}${c.sentToEmail ? ` to ${c.sentToEmail}` : ""}` : null],
        ["Unsigned PDF SHA-256", c.unsignedPdfSha256],
        ["Signer", c.signerName],
        ["Signer email", c.signerEmail],
        ["Consent", c.consentAt ? format(new Date(c.consentAt), "MMM d, yyyy h:mm:ss a") : null],
        ["Signed", c.signedAt ? format(new Date(c.signedAt), "MMM d, yyyy h:mm:ss a") : null],
        ["IP address", c.signerIp],
        ["Browser", c.signerUserAgent],
        ["Signed PDF SHA-256", c.signedPdfSha256],
        ["Money", c.moneyAppliedAt ? `Applied ${format(new Date(c.moneyAppliedAt), "MMM d, yyyy h:mm a")}` : c.moneyApplyNote],
      ]
    : [];
  return (
    <Dialog open={Boolean(c)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Signature certificate</DialogTitle>
        </DialogHeader>
        <dl className="space-y-2 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[150px_1fr] gap-2 border-b pb-1.5">
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className={`break-all ${/SHA|id$|IP/.test(k) ? "font-mono text-xs" : ""}`}>{v ?? "—"}</dd>
            </div>
          ))}
        </dl>
        <DialogFooter>
          {c && (
            <Button variant="outline" onClick={() => window.open(`/api/customer-contracts/${c.id}/pdf?kind=signed&download=1`, "_blank", "noopener")}>
              <Download className="mr-1 h-4 w-4" /> Download signed PDF
            </Button>
          )}
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
