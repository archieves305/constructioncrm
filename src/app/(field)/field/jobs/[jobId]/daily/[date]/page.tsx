"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "@/lib/auth/session-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  ArrowLeft,
  Check,
  ClipboardCopy,
  FileDown,
  History,
  LogIn,
  LogOut,
  Send,
  UserCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { newEntryId } from "@/lib/labor/ids";
import {
  useLaborSheet,
  type EntryDraft,
  type ServerEntry,
} from "@/hooks/use-labor-sheet";
import { TouchTimeField } from "@/components/field/touch-time-field";
import { AutosaveIndicator } from "@/components/field/autosave-indicator";
import { WorkLogSection } from "@/components/field/work-log-section";
import { PhotoSection } from "@/components/field/photo-section";
import { SignaturePad } from "@/components/field/signature-pad";
import { Input } from "@/components/ui/input";
import {
  narrativeFromLog,
  useLogNarrative,
} from "@/hooks/use-log-narrative";
import type { SaveStatus } from "@/hooks/use-labor-sheet";

const DEFAULT_START = 7 * 60; // 7:00 AM
const DEFAULT_END = 15 * 60 + 30; // 3:30 PM
const BREAK_OPTIONS = [0, 30, 60];

type Person = {
  id: string;
  firstName: string;
  lastName: string;
  trade: string | null;
  crew: { id: string; name: string } | null;
};

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  SUBMITTED: "bg-amber-100 text-amber-800",
  APPROVED: "bg-green-100 text-green-800",
};

export default function DailyLaborPage({
  params,
}: {
  params: Promise<{ jobId: string; date: string }>;
}) {
  const { jobId, date } = use(params);
  const qc = useQueryClient();
  const { data: session } = useSession();
  const role = session?.user?.role;

  const sheet = useLaborSheet(jobId, date);
  const log = sheet.log;
  const logStatus = log?.status ?? "DRAFT";
  // Mirrors canEditLogAtStatus: office roles may correct a submitted day
  // without bouncing it back to the crew. APPROVED stays frozen for everyone
  // until an admin reopens it.
  const canFixSubmitted = role === "ADMIN" || role === "MANAGER";
  const editable =
    logStatus === "DRAFT" || (logStatus === "SUBMITTED" && canFixSubmitted);

  const narrative = useLogNarrative(
    jobId,
    date,
    sheet.isLoading ? null : narrativeFromLog(log as Record<string, unknown> | null),
  );
  const [section, setSection] = useState<"crew" | "work" | "photos">("crew");

  const { data: fieldToday } = useQuery<{
    jobs: { id: string; title: string; jobNumber: string }[];
  }>({
    queryKey: ["field-today-jobs"],
    queryFn: () => fetch("/api/field/today").then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  });
  const job = fieldToday?.jobs.find((j) => j.id === jobId);

  const { data: roster = [] } = useQuery<Person[]>({
    queryKey: ["personnel", "field-roster"],
    queryFn: () => fetch("/api/personnel?activeOnly=true").then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  });

  const entryByPersonnel = useMemo(() => {
    const map = new Map<string, EntryDraft>();
    for (const e of sheet.entries) {
      if (!map.has(e.personnelId)) map.set(e.personnelId, e);
    }
    return map;
  }, [sheet.entries]);

  // Server-computed hours per entry (authoritative reg/OT split).
  const serverEntryById = useMemo(() => {
    const map = new Map<string, ServerEntry>();
    for (const e of log?.entries ?? []) map.set(e.id, e);
    return map;
  }, [log]);

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const togglePresence = (person: Person) => {
    if (!editable) return;
    const existing = entryByPersonnel.get(person.id);
    if (existing) {
      sheet.update((prev) => prev.filter((e) => e.personnelId !== person.id));
      if (expandedId === existing.id) setExpandedId(null);
    } else {
      const entry: EntryDraft = {
        id: newEntryId(),
        personnelId: person.id,
        trade: person.trade,
        jobAreaId: null,
        workArea: null,
        startMinutes: DEFAULT_START,
        endMinutes: DEFAULT_END,
        breakMinutes: 30,
        costCodeId: null,
        phase: null,
        budgetLineId: null,
        isAbsent: false,
        isLate: false,
        leftEarly: false,
        absenceReason: null,
        notes: null,
      };
      sheet.update((prev) => [...prev, entry]);
    }
  };

  const updateEntry = (id: string, patch: Partial<EntryDraft>) => {
    sheet.update((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    );
  };

  const markAllPresent = () => {
    if (!editable) return;
    const missing = roster.filter((p) => !entryByPersonnel.has(p.id));
    if (missing.length === 0) {
      toast.info("Everyone is already on the sheet");
      return;
    }
    sheet.update((prev) => [
      ...prev,
      ...missing.map(
        (p): EntryDraft => ({
          id: newEntryId(),
          personnelId: p.id,
          trade: p.trade,
          jobAreaId: null,
          workArea: null,
          startMinutes: DEFAULT_START,
          endMinutes: DEFAULT_END,
          breakMinutes: 30,
          costCodeId: null,
          phase: null,
          budgetLineId: null,
          isAbsent: false,
          isLate: false,
          leftEarly: false,
          absenceReason: null,
          notes: null,
        }),
      ),
    ]);
    toast.success(`Added ${missing.length} workers`);
  };

  const copyPrevious = useMutation({
    mutationFn: async () => {
      const ok = await sheet.flush();
      if (!ok) throw new Error("Couldn't sync the current sheet first");
      const res = await fetch(
        `/api/jobs/${jobId}/daily-logs/${date}/copy-previous`,
        { method: "POST" },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Copy failed");
      return body as { copiedFrom: string; added: number };
    },
    onSuccess: async (data) => {
      await sheet.reloadFromServer();
      toast.success(
        `Copied ${data.added} workers from ${format(new Date(`${data.copiedFrom}T12:00:00`), "EEE MMM d")}`,
      );
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const [submitOpen, setSubmitOpen] = useState(false);
  const [signatureUri, setSignatureUri] = useState<string | null>(null);
  const [signedByName, setSignedByName] = useState("");
  const submit = useMutation({
    mutationFn: async () => {
      const [sheetOk, narrativeOk] = await Promise.all([
        sheet.flush(),
        narrative.flush(),
      ]);
      if (!sheetOk || !narrativeOk) {
        throw new Error("Sync failed — check your connection and try again");
      }
      if (signatureUri && signedByName.trim()) {
        const sigRes = await fetch(
          `/api/jobs/${jobId}/daily-logs/${date}/signature`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              dataUri: signatureUri,
              signedByName: signedByName.trim(),
            }),
          },
        );
        if (!sigRes.ok) {
          const body = await sigRes.json().catch(() => ({}));
          throw new Error(body.error || "Signature upload failed");
        }
      }
      const res = await fetch(`/api/jobs/${jobId}/daily-logs/${date}/submit`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Submit failed");
      return body;
    },
    onSuccess: async () => {
      setSubmitOpen(false);
      await qc.invalidateQueries({ queryKey: ["daily-log", jobId, date] });
      await qc.invalidateQueries({ queryKey: ["field-today"] });
      toast.success("Daily report submitted");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const clock = useMutation({
    mutationFn: async ({ entryId, action }: { entryId: string; action: "check-in" | "check-out" }) => {
      const now = new Date();
      const minutes = Math.round((now.getHours() * 60 + now.getMinutes()) / 15) * 15;
      const coords = await new Promise<{ lat: number; lng: number } | null>((resolve) => {
        if (!navigator.geolocation) return resolve(null);
        navigator.geolocation.getCurrentPosition(
          (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
          () => resolve(null),
          { timeout: 4000, maximumAge: 300_000 },
        );
      });
      // Flush drafts first so the entry exists server-side.
      const ok = await sheet.flush();
      if (!ok) throw new Error("Couldn't sync the sheet — check your connection");
      const res = await fetch(
        `/api/jobs/${jobId}/daily-logs/${date}/labor/${entryId}/${action}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ minutes, ...(coords ?? {}) }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `${action} failed`);
      return { entryId, action, minutes };
    },
    onSuccess: async ({ entryId, action, minutes }) => {
      sheet.update((prev) =>
        prev.map((e) =>
          e.id === entryId
            ? action === "check-in"
              ? { ...e, startMinutes: minutes, isAbsent: false }
              : { ...e, endMinutes: minutes }
            : e,
        ),
      );
      toast.success(action === "check-in" ? "Checked in" : "Checked out");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const [addWorkerOpen, setAddWorkerOpen] = useState(false);
  const [newWorker, setNewWorker] = useState({ firstName: "", lastName: "", trade: "", phone: "" });
  const addWorker = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/personnel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: newWorker.firstName.trim(),
          lastName: newWorker.lastName.trim(),
          trade: newWorker.trade.trim() || null,
          phone: newWorker.phone.trim() || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to add worker");
      return body as Person;
    },
    onSuccess: async (person) => {
      setAddWorkerOpen(false);
      setNewWorker({ firstName: "", lastName: "", trade: "", phone: "" });
      await qc.invalidateQueries({ queryKey: ["personnel", "field-roster"] });
      // Straight onto today's sheet — that's why they were added.
      togglePresence({
        id: person.id,
        firstName: person.firstName,
        lastName: person.lastName,
        trade: person.trade ?? null,
        crew: null,
      });
      toast.success(
        `${person.firstName} ${person.lastName} added — office can fill in rate and details later`,
      );
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const presentCount = sheet.entries.filter((e) => !e.isAbsent).length;
  const totals = log?.totals;

  if (sheet.isLoading) {
    return <div className="text-muted-foreground p-6 text-center">Loading…</div>;
  }

  return (
    <div className="mx-auto max-w-3xl p-4 pb-32">
      <div className="mb-4 flex items-center gap-2">
        <Link href="/field">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold">{job?.title ?? "Job"}</h1>
          <p className="text-muted-foreground text-sm">
            {format(new Date(`${date}T12:00:00`), "EEEE, MMM d, yyyy")}
          </p>
        </div>
        <Badge className={cn("text-sm", STATUS_STYLES[logStatus])}>
          {logStatus === "DRAFT" ? "Draft" : logStatus === "SUBMITTED" ? "Submitted" : "Approved"}
        </Badge>
        {log && (
          <a
            href={`/api/jobs/${jobId}/daily-logs/${date}/pdf`}
            target="_blank"
            rel="noreferrer"
            aria-label="View PDF"
          >
            <Button variant="ghost" size="sm">
              <FileDown className="h-5 w-5" />
            </Button>
          </a>
        )}
        <Link href={`/field/jobs/${jobId}/logs`} aria-label="All logs">
          <Button variant="ghost" size="sm">
            <History className="h-5 w-5" />
          </Button>
        </Link>
      </div>

      {log?.returnNote && logStatus === "DRAFT" && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          <span className="font-semibold">Returned by the office:</span>{" "}
          {log.returnNote}
        </div>
      )}
      {logStatus === "SUBMITTED" && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Submitted
          {log?.submittedAt
            ? ` ${format(new Date(log.submittedAt), "MMM d, h:mm a")}`
            : ""}{" "}
          {canFixSubmitted
            ? "— awaiting approval. You can still make corrections."
            : "— awaiting office approval. Hours are locked."}
        </div>
      )}
      {logStatus === "APPROVED" && (
        <div className="mb-4 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-900">
          Approved — this day is locked.
        </div>
      )}
      {(sheet.status === "locked" || narrative.status === "locked") && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          <span className="font-semibold">
            This day was locked before your latest changes could sync.
          </span>{" "}
          {(sheet.lockedMessage ?? "It was submitted or approved in the meantime").replace(/\.?$/, ".")}{" "}
          Your changes are saved on this device — ask the office to return the
          day to draft, then reopen this page and they will sync automatically.
        </div>
      )}

      <div className="mb-4 grid grid-cols-3 gap-1 rounded-lg bg-gray-200/70 p-1">
        {(
          [
            ["crew", "Crew"],
            ["work", "Work Log"],
            ["photos", "Photos"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setSection(value)}
            className={cn(
              "h-11 rounded-md text-sm font-semibold transition-colors",
              section === value ? "bg-white shadow" : "text-gray-600",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {section === "photos" ? (
        <PhotoSection
          jobId={jobId}
          date={date}
          dailyLogId={log?.id ?? null}
          editable={logStatus !== "APPROVED"}
        />
      ) : section === "work" ? (
        <WorkLogSection
          jobId={jobId}
          date={date}
          dailyLogId={log?.id ?? null}
          draft={narrative.draft}
          set={narrative.set}
          editable={editable}
        />
      ) : (
        <>
      {editable && (
        <div className="mb-4 flex gap-2">
          <Button
            variant="outline"
            className="h-12 flex-1"
            onClick={() => copyPrevious.mutate()}
            disabled={copyPrevious.isPending}
          >
            <ClipboardCopy className="mr-2 h-4 w-4" />
            Copy yesterday&apos;s crew
          </Button>
          <Button variant="outline" className="h-12 flex-1" onClick={markAllPresent}>
            <UserCheck className="mr-2 h-4 w-4" />
            Mark all present
          </Button>
        </div>
      )}

      <div className="space-y-2">
        {roster.length === 0 && (
          <Card>
            <CardContent className="text-muted-foreground py-8 text-center">
              No active personnel. Ask the office to add crew members.
            </CardContent>
          </Card>
        )}
        {roster.map((person) => {
          const entry = entryByPersonnel.get(person.id);
          const present = Boolean(entry && !entry.isAbsent);
          const server = entry ? serverEntryById.get(entry.id) : undefined;
          const expanded = entry && expandedId === entry.id;
          return (
            <Card key={person.id} className={cn(!present && "opacity-70")}>
              <CardContent className="p-0">
                <div className="flex min-h-[56px] items-center gap-3 px-4 py-2">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() =>
                      entry ? setExpandedId(expanded ? null : entry.id) : togglePresence(person)
                    }
                  >
                    <div className="truncate text-base font-semibold">
                      {person.firstName} {person.lastName}
                    </div>
                    <div className="text-muted-foreground truncate text-xs">
                      {[entry?.trade ?? person.trade, person.crew?.name]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                      {entry && server && !entry.isAbsent && (
                        <>
                          {" · "}
                          <span className="font-medium text-gray-700">
                            {server.regularHours}h
                            {server.otHours > 0 ? ` + ${server.otHours}h OT` : ""}
                          </span>
                        </>
                      )}
                    </div>
                  </button>
                  {entry && (entry.isLate || entry.leftEarly) && (
                    <div className="flex gap-1">
                      {entry.isLate && <Badge variant="secondary">Late</Badge>}
                      {entry.leftEarly && <Badge variant="secondary">Left early</Badge>}
                    </div>
                  )}
                  <Button
                    type="button"
                    variant={present ? "default" : "outline"}
                    className={cn("h-11 w-24", present && "bg-green-600 hover:bg-green-700")}
                    disabled={!editable}
                    onClick={() => togglePresence(person)}
                  >
                    {present ? (
                      <>
                        <Check className="mr-1 h-4 w-4" /> Here
                      </>
                    ) : (
                      "Absent"
                    )}
                  </Button>
                </div>

                {entry && expanded && (
                  <div className="space-y-3 border-t bg-gray-50/60 px-4 py-3">
                    <div className="grid grid-cols-2 gap-3">
                      <TouchTimeField
                        label="Start"
                        value={entry.startMinutes}
                        defaultValue={DEFAULT_START}
                        disabled={!editable}
                        onChange={(v) => updateEntry(entry.id, { startMinutes: v })}
                      />
                      <TouchTimeField
                        label="End"
                        value={entry.endMinutes}
                        defaultValue={DEFAULT_END}
                        disabled={!editable}
                        onChange={(v) => updateEntry(entry.id, { endMinutes: v })}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground text-xs font-medium">
                        Break
                      </span>
                      <div className="flex gap-1">
                        {BREAK_OPTIONS.map((mins) => (
                          <Button
                            key={mins}
                            type="button"
                            size="sm"
                            variant={entry.breakMinutes === mins ? "default" : "outline"}
                            className="h-10 min-w-[56px]"
                            disabled={!editable}
                            onClick={() => updateEntry(entry.id, { breakMinutes: mins })}
                          >
                            {mins === 0 ? "None" : `${mins}m`}
                          </Button>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-10 flex-1"
                        disabled={!editable || clock.isPending}
                        onClick={() => clock.mutate({ entryId: entry.id, action: "check-in" })}
                      >
                        <LogIn className="mr-1 h-4 w-4" /> Check in now
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-10 flex-1"
                        disabled={!editable || clock.isPending}
                        onClick={() => clock.mutate({ entryId: entry.id, action: "check-out" })}
                      >
                        <LogOut className="mr-1 h-4 w-4" /> Check out now
                      </Button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={entry.isLate ? "default" : "outline"}
                        className="h-10"
                        disabled={!editable}
                        onClick={() => updateEntry(entry.id, { isLate: !entry.isLate })}
                      >
                        Late
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={entry.leftEarly ? "default" : "outline"}
                        className="h-10"
                        disabled={!editable}
                        onClick={() =>
                          updateEntry(entry.id, { leftEarly: !entry.leftEarly })
                        }
                      >
                        Left early
                      </Button>
                    </div>
                    <div>
                      <span className="text-muted-foreground text-xs font-medium">
                        What did they work on today?
                      </span>
                      <Textarea
                        rows={2}
                        placeholder="e.g. Hung and taped drywall, rooms 210–214"
                        value={entry.notes ?? ""}
                        disabled={!editable}
                        onChange={(e) =>
                          updateEntry(entry.id, { notes: e.target.value || null })
                        }
                        className="mt-1 bg-white"
                        style={{ fontSize: 16 }}
                      />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {editable && (
        <Button
          variant="outline"
          className="mt-2 h-12 w-full"
          onClick={() => setAddWorkerOpen(true)}
        >
          <UserPlus className="mr-2 h-4 w-4" />
          Add worker not on the list
        </Button>
      )}
        </>
      )}

      {/* Bottom action bar */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-white px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Users className="h-4 w-4" />
              {presentCount} onsite
              {totals && (
                <span className="text-muted-foreground">
                  · {totals.totalHours}h
                  {totals.otHours > 0 ? ` (${totals.otHours} OT)` : ""}
                  {"totalCost" in (totals ?? {}) && totals.totalCost != null
                    ? ` · $${Number(totals.totalCost).toLocaleString()}`
                    : ""}
                </span>
              )}
            </div>
            <AutosaveIndicator status={combineStatus(sheet.status, narrative.status)} />
          </div>
          {logStatus === "DRAFT" && sheet.status !== "locked" && (
            <Button
              className="h-12 px-6"
              disabled={submit.isPending}
              onClick={() => setSubmitOpen(true)}
            >
              <Send className="mr-2 h-4 w-4" />
              Submit daily report
            </Button>
          )}
        </div>
      </div>

      {/* Add worker dialog */}
      <Dialog open={addWorkerOpen} onOpenChange={setAddWorkerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a worker</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-muted-foreground text-sm">
              For someone who showed up and isn&apos;t in the system yet. The
              office fills in pay rate and paperwork later.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Input
                placeholder="First name"
                value={newWorker.firstName}
                onChange={(e) => setNewWorker({ ...newWorker, firstName: e.target.value })}
                style={{ fontSize: 16 }}
              />
              <Input
                placeholder="Last name"
                value={newWorker.lastName}
                onChange={(e) => setNewWorker({ ...newWorker, lastName: e.target.value })}
                style={{ fontSize: 16 }}
              />
            </div>
            <Input
              placeholder="Trade (e.g. Drywall)"
              value={newWorker.trade}
              onChange={(e) => setNewWorker({ ...newWorker, trade: e.target.value })}
              style={{ fontSize: 16 }}
            />
            <Input
              placeholder="Phone (optional)"
              type="tel"
              value={newWorker.phone}
              onChange={(e) => setNewWorker({ ...newWorker, phone: e.target.value })}
              style={{ fontSize: 16 }}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAddWorkerOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={
                  !newWorker.firstName.trim() ||
                  !newWorker.lastName.trim() ||
                  addWorker.isPending
                }
                onClick={() => addWorker.mutate()}
              >
                {addWorker.isPending ? "Adding…" : "Add & mark present"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Submit confirmation */}
      <Dialog open={submitOpen} onOpenChange={setSubmitOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Submit daily report?</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p>
              {presentCount} worker{presentCount === 1 ? "" : "s"} onsite
              {totals ? ` · ${totals.totalHours} hours` : ""}.
            </p>
            {presentCount === 0 && (
              <p className="font-medium text-amber-700">
                No workers are marked present — submit anyway?
              </p>
            )}
            <p className="text-muted-foreground">
              Submitting locks crew hours for office review. The office can
              return it to you if something needs fixing.
            </p>
            <div className="space-y-2 border-t pt-3">
              <span className="text-sm font-medium">Sign off (optional)</span>
              <SignaturePad onChange={setSignatureUri} />
              <Input
                placeholder="Print name"
                value={signedByName}
                onChange={(e) => setSignedByName(e.target.value)}
                style={{ fontSize: 16 }}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setSubmitOpen(false)}>
              Cancel
            </Button>
            <Button disabled={submit.isPending} onClick={() => submit.mutate()}>
              {submit.isPending ? "Submitting…" : "Submit"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Conflict dialog */}
      <Dialog open={sheet.status === "conflict"} onOpenChange={() => {}}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>This log was edited somewhere else</DialogTitle>
          </DialogHeader>
          <p className="text-sm">
            Someone else changed this day
            {sheet.conflictAt
              ? ` at ${format(new Date(sheet.conflictAt), "h:mm a")}`
              : ""}
            . Keep your version or load theirs?
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => sheet.loadTheirs()}>
              Load theirs
            </Button>
            <Button onClick={() => sheet.keepMine()}>Keep mine</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const STATUS_PRIORITY: SaveStatus[] = ["locked", "conflict", "error", "saving", "local", "saved", "idle"];

function combineStatus(a: SaveStatus, b: SaveStatus): SaveStatus {
  return STATUS_PRIORITY[Math.min(STATUS_PRIORITY.indexOf(a), STATUS_PRIORITY.indexOf(b))];
}
