"use client";

import { Suspense, useEffect, useState } from "react";
import { ClipboardPaste, Inbox } from "lucide-react";
import { toast } from "sonner";
import { useMutation } from "@tanstack/react-query";
import { Callout } from "@/components/shared/callout";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { useSearchParamState } from "@/components/shared/use-search-param-state";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson } from "@/lib/fetch-json";
import { IntakeCard } from "@/components/partners/intake-card";
import { useIntakes, useInvalidateBids, type IntakeStatusFilter } from "@/components/partners/use-partners";

export default function IntakePage() {
  return (
    <Suspense fallback={<ListSkeleton rows={4} />}>
      <Intake />
    </Suspense>
  );
}

function Intake() {
  const url = useSearchParamState();
  const s = url.get("status");
  const status: IntakeStatusFilter = s === "DONE" || s === "DISMISSED" ? s : "NEW";
  const item = url.get("item");
  const list = useIntakes(status);
  const [pasting, setPasting] = useState(false);
  const counts = list.data?.counts;
  const channels = list.data?.channels;

  useEffect(() => {
    if (!item || !list.data) return;
    document.getElementById(`intake-${item}`)?.scrollIntoView({ block: "center" });
  }, [item, list.data]);

  return (
    <div>
      <PageHeader
        title="Bid intake"
        breadcrumb={[{ label: "Business Development" }, { label: "Bid intake" }]}
        description="Bid invitations that arrived by email. The CRM reads each one; a person creates the bid, files it on a bid already logged, or dismisses it."
        actions={<Button variant="brand" size="sm" onClick={() => setPasting(true)}><ClipboardPaste className="mr-1.5 size-4" /> Paste an email</Button>}
      />
      {channels && !channels.mailersend && !channels.outlook && (
        <Callout tone="info" className="mb-3">
          Forwarding by email is not connected yet, so invitations come in by pasting them here (copy the whole email, From and Subject lines included). Once the inbound address is set up, anything forwarded to it lands here on its own.
        </Callout>
      )}
      <div className="mb-3">
        <SegmentedControl<IntakeStatusFilter>
          ariaLabel="Which"
          size="sm"
          value={status}
          onValueChange={(v) => url.set("status", v === "NEW" ? null : v)}
          options={[
            { value: "NEW", label: `To review${counts ? ` · ${counts.NEW}` : ""}` },
            { value: "DONE", label: `Filed${counts ? ` · ${counts.DONE}` : ""}` },
            { value: "DISMISSED", label: `Dismissed${counts ? ` · ${counts.DISMISSED}` : ""}` },
          ]}
        />
      </div>
      {list.isLoading ? (
        <ListSkeleton rows={4} />
      ) : list.isError ? (
        <EmptyState icon={Inbox} title="The intake could not be loaded" description={(list.error as Error).message} action={<Button variant="outline" onClick={() => list.refetch()}>Try again</Button>} />
      ) : (list.data?.rows.length ?? 0) === 0 ? (
        <EmptyState icon={Inbox} title={status === "NEW" ? "Nothing to review" : "Nothing here yet"} description={status === "NEW" ? "New bid invitations appear here as they arrive." : undefined} />
      ) : (
        <div className="space-y-3">{list.data!.rows.map((r) => <IntakeCard key={r.id} item={r} highlight={r.id === item} />)}</div>
      )}
      <PasteDialog open={pasting} onOpenChange={setPasting} onQueued={() => url.set("status", null)} />
    </div>
  );
}

function PasteDialog({ open, onOpenChange, onQueued }: { open: boolean; onOpenChange: (o: boolean) => void; onQueued: () => void }) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const invalidate = useInvalidateBids();
  const paste = useMutation({
    mutationFn: () => fetchJson<{ status: string; intakeId: string | null }>("/api/partners/intake", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject: subject || null, body }) }),
    onSuccess: (r) => {
      invalidate();
      toast.success(r.status === "duplicate" ? "That email is already in the intake" : "Read — check it below");
      setSubject("");
      setBody("");
      onOpenChange(false);
      onQueued();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Paste a bid invitation</DialogTitle>
          <DialogDescription>Copy the whole email — the From and Subject lines too, if your mail program shows them — and paste it here. Nothing becomes a bid until you confirm it.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="paste-subject">Subject (if it is not in the paste)</Label>
            <Input id="paste-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={500} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="paste-body">The email</Label>
            <Textarea id="paste-body" value={body} onChange={(e) => setBody(e.target.value)} rows={14} className="font-mono text-xs" placeholder={"From: Jane Smith <jsmith@gc.com>\nSubject: Invitation to Bid – …\n\nBid Due: …"} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={body.trim().length < 20 || paste.isPending} onClick={() => paste.mutate()}>{paste.isPending ? "Reading…" : "Read it"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
