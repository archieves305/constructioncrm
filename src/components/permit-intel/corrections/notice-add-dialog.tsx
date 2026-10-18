"use client";

import { useRef, useState } from "react";
import { format } from "date-fns";
import { ClipboardPaste, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson } from "@/lib/fetch-json";
import { formatFileSize, uploadProblem } from "@/lib/files/limits";
import { useInvalidateCorrections } from "./use-corrections";

const READABLE = "application/pdf,image/png,image/jpeg,image/webp";

/**
 * A correction notice arrived. The letter is uploaded to the permit (as a
 * correction notice) or its text pasted from the portal or an email; the AI
 * then reads it into items for a person to check.
 */
export function NoticeAddForm({ permitId, aiReady, onClose }: { permitId: string; aiReady: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<"UPLOAD" | "PASTE">("UPLOAD");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [receivedOn, setReceivedOn] = useState(format(new Date(), "yyyy-MM-dd"));
  const [reviewer, setReviewer] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const invalidate = useInvalidateCorrections(permitId);

  const choose = (list: FileList | null) => {
    const f = list?.[0] ?? null;
    if (input.current) input.current.value = "";
    if (!f) return;
    const problem = uploadProblem(f);
    if (problem) return void toast.error(problem);
    if (!READABLE.split(",").includes(f.type)) return void toast.error("Upload the notice as a PDF or a picture, or paste its text");
    setFile(f);
  };

  const ready = mode === "UPLOAD" ? !!file : text.trim().length > 0;

  const submit = async () => {
    setBusy(true);
    try {
      let fileId: string | undefined;
      if (mode === "UPLOAD" && file) {
        const form = new FormData();
        form.append("file", file);
        form.append("permitId", permitId);
        form.append("permitDocType", "correction_notice");
        fileId = (await fetchJson<{ id: string }>("/api/files", { method: "POST", body: form })).id;
      }
      await fetchJson(`/api/permits/${permitId}/corrections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: mode, fileId, text: mode === "PASTE" ? text : undefined, receivedAt: `${receivedOn}T12:00:00.000Z`, reviewerName: reviewer || null }),
      });
      toast.success(aiReady ? "Notice added — reading it now" : "Notice added — type its items by hand");
      invalidate();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add a correction notice</DialogTitle>
        <DialogDescription>{aiReady ? "The AI reads the notice into items. Nothing changes on the permit until you check and confirm them." : "AI is not set up on this server: you will type the items yourself."}</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <SegmentedControl
          value={mode}
          onValueChange={setMode}
          ariaLabel="How the notice arrived"
          size="sm"
          options={[
            { value: "UPLOAD", label: "Upload the letter", icon: Upload },
            { value: "PASTE", label: "Paste its text", icon: ClipboardPaste },
          ]}
        />
        {mode === "UPLOAD" ? (
          <div className="space-y-1">
            <input ref={input} type="file" accept={READABLE} className="hidden" onChange={(e) => choose(e.target.files)} />
            <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()}>
              <Upload className="size-3.5" /> {file ? "Choose another file" : "Choose the PDF or a picture"}
            </Button>
            {file && (
              <p className="truncate text-xs text-muted-foreground">
                {file.name} · {formatFileSize(file.size)}
              </p>
            )}
            <p className="text-xs text-muted-foreground">Scanned pages are read too. It is filed on the permit as a correction notice.</p>
          </div>
        ) : (
          <div className="space-y-1">
            <Label htmlFor="notice-text">The comments</Label>
            <Textarea id="notice-text" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the plan review comments from the portal or the email" />
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="min-w-0 space-y-1">
            <Label htmlFor="notice-day">Received</Label>
            <Input id="notice-day" type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />
          </div>
          <div className="min-w-0 space-y-1">
            <Label htmlFor="notice-reviewer">Reviewer (optional)</Label>
            <Input id="notice-reviewer" value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="Read from the notice if left empty" />
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="brand" onClick={submit} disabled={!ready || !receivedOn || busy}>
          {busy ? "Adding…" : aiReady ? "Add and read it" : "Add the notice"}
        </Button>
      </DialogFooter>
    </>
  );
}
