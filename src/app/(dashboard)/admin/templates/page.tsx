"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Send, Eye } from "lucide-react";
import { TEMPLATE_VARIABLES } from "@/lib/templates/render";

type Template = {
  id: string;
  name: string;
  channel: "SMS" | "EMAIL" | "IN_APP";
  templateBody: string;
  isActive: boolean;
};

type PreviewResult = {
  channel: Template["channel"];
  subject: string;
  html: string | null;
  text: string;
};

const CHANNELS = ["SMS", "EMAIL", "IN_APP"] as const;

const empty: Omit<Template, "id"> = {
  name: "",
  channel: "EMAIL",
  templateBody: "",
  isActive: true,
};

export default function TemplatesPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<Template, "id">>(empty);
  const [preview, setPreview] = useState<PreviewResult | null>(null);

  const { data: templates = [], isLoading } = useQuery<Template[]>({
    queryKey: ["templates"],
    queryFn: () => fetch("/api/admin/templates").then((r) => r.json()),
  });

  const save = useMutation({
    mutationFn: async () => {
      const url = editingId
        ? `/api/admin/templates/${editingId}`
        : "/api/admin/templates";
      const res = await fetch(url, {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Save failed" }));
        throw new Error(err.error || "Save failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["templates"] });
      setOpen(false);
      setEditingId(null);
      setForm(empty);
      toast.success(editingId ? "Template updated" : "Template created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/templates/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Delete failed" }));
        throw new Error(err.error || "Delete failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["templates"] });
      toast.success("Template deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const testSend = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/templates/${id}/test-send`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Test send failed" }));
        throw new Error(err.error || "Test send failed");
      }
      return res.json();
    },
    onSuccess: (data: { sentTo: string }) => {
      toast.success(`Test email sent to ${data.sentTo}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isEmptyBody = !form.templateBody.trim();
  const [prevEmptyBody, setPrevEmptyBody] = useState(isEmptyBody);
  if (isEmptyBody !== prevEmptyBody) {
    setPrevEmptyBody(isEmptyBody);
    if (isEmptyBody) setPreview(null);
  }

  // Live preview: re-render whenever the body or channel changes (debounced)
  useEffect(() => {
    if (!open || !form.templateBody.trim()) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/templates/draft/preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ templateBody: form.templateBody }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as PreviewResult;
        if (!cancelled) {
          setPreview({ ...data, channel: form.channel });
        }
      } catch {
        // ignore preview errors
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [form.templateBody, form.channel, open]);

  function startCreate() {
    setEditingId(null);
    setForm(empty);
    setPreview(null);
    setOpen(true);
  }

  function startEdit(t: Template) {
    setEditingId(t.id);
    setForm({
      name: t.name,
      channel: t.channel,
      templateBody: t.templateBody,
      isActive: t.isActive,
    });
    setPreview(null);
    setOpen(true);
  }

  return (
    <div>
      <PageHeader
        title="Message Templates"
        description="SMS and email bodies used by follow-up rules. Email templates render with company branding, signature, and unsubscribe footer."
        actions={
          <Button type="button" onClick={startCreate}>
            <Plus className="mr-2 h-4 w-4" />
            New Template
          </Button>
        }
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Template" : "New Template"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              <div>
                <Label>Name / subject</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. New lead welcome"
                />
                {form.channel === "EMAIL" && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    For email channel, this is the subject line. Variables work here too.
                  </p>
                )}
              </div>
              <div>
                <Label>Channel</Label>
                <Select
                  value={form.channel}
                  onValueChange={(v) =>
                    setForm({ ...form, channel: (v as Template["channel"]) || "EMAIL" })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CHANNELS.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Body {form.channel === "EMAIL" && "(markdown)"}</Label>
                <Textarea
                  rows={12}
                  value={form.templateBody}
                  onChange={(e) => setForm({ ...form, templateBody: e.target.value })}
                  placeholder={
                    form.channel === "EMAIL"
                      ? "Hi {{lead.firstName}},\n\nThanks for reaching out about your project at {{lead.addressLine1}}. I'd love to walk you through our process.\n\n**Next step:** I'll call you within 24 hours.\n\nReach out anytime if you have questions."
                      : "Hi {{lead.firstName}}, thanks for reaching out..."
                  }
                  className="font-mono text-sm"
                />
                {form.channel === "EMAIL" && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Markdown supported: **bold**, *italic*, [links](url), bullet lists, paragraphs.
                    Email layout, signature, and unsubscribe footer are added automatically.
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-1 text-[11px] text-muted-foreground">
                  Variables:{" "}
                  {TEMPLATE_VARIABLES.map((v) => (
                    <code key={v} className="rounded bg-muted px-1">
                      {`{{${v}}}`}
                    </code>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="active"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                />
                <Label htmlFor="active" className="cursor-pointer">
                  Active
                </Label>
              </div>
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  disabled={save.isPending}
                  onClick={() => save.mutate()}
                >
                  {save.isPending ? "Saving..." : editingId ? "Update" : "Create"}
                </Button>
                {editingId && form.channel === "EMAIL" && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={testSend.isPending}
                    onClick={() => testSend.mutate(editingId)}
                  >
                    <Send className="mr-1 h-4 w-4" />
                    {testSend.isPending ? "Sending…" : "Send test to me"}
                  </Button>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Eye className="h-4 w-4" />
                Live preview
              </div>
              {!preview ? (
                <p className="rounded border border-dashed p-6 text-center text-xs text-muted-foreground">
                  Type a body to see the preview.
                </p>
              ) : preview.channel === "EMAIL" && preview.html ? (
                <div className="rounded border bg-gray-50">
                  <div className="border-b px-3 py-2 text-xs">
                    <div className="text-muted-foreground">Subject</div>
                    <div className="font-medium">{preview.subject}</div>
                  </div>
                  <iframe
                    title="Email preview"
                    srcDoc={preview.html}
                    className="h-[460px] w-full bg-white"
                    sandbox=""
                  />
                </div>
              ) : (
                <pre className="rounded border bg-gray-50 p-3 text-xs whitespace-pre-wrap">
                  {preview.text}
                </pre>
              )}
              <p className="text-[11px] text-muted-foreground">
                Preview uses sample lead data (&ldquo;Sarah Johnson, Boca Raton&rdquo;) so you can see
                how variables render.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Body preview</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-28"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : templates.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    No templates yet.
                  </TableCell>
                </TableRow>
              ) : (
                templates.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{t.channel}</Badge>
                    </TableCell>
                    <TableCell className="max-w-md truncate text-sm text-muted-foreground">
                      {t.templateBody}
                    </TableCell>
                    <TableCell>
                      <Badge variant={t.isActive ? "default" : "secondary"}>
                        {t.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => startEdit(t)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          if (confirm(`Delete "${t.name}"?`)) remove.mutate(t.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
