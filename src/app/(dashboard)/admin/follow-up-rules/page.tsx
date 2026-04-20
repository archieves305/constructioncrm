"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
import { Plus, Pencil, Trash2 } from "lucide-react";

const TRIGGERS = ["LEAD_CREATED", "LEAD_STAGE_CHANGED", "LEAD_ASSIGNED"] as const;

type Template = { id: string; name: string; channel: string };

type Rule = {
  id: string;
  name: string;
  triggerEvent: (typeof TRIGGERS)[number];
  delayMinutes: number;
  messageTemplateId: string | null;
  messageTemplate: Template | null;
  taskTemplateJson: {
    title?: string;
    description?: string;
    dueInDays?: number;
    priority?: string;
  } | null;
  isActive: boolean;
};

type FormState = {
  name: string;
  triggerEvent: (typeof TRIGGERS)[number];
  delayMinutes: number;
  messageTemplateId: string;
  taskTitle: string;
  taskDescription: string;
  taskDueInDays: string;
  taskPriority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  isActive: boolean;
};

const empty: FormState = {
  name: "",
  triggerEvent: "LEAD_CREATED",
  delayMinutes: 0,
  messageTemplateId: "",
  taskTitle: "",
  taskDescription: "",
  taskDueInDays: "",
  taskPriority: "MEDIUM",
  isActive: true,
};

export default function FollowUpRulesPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(empty);

  const { data: rules = [], isLoading } = useQuery<Rule[]>({
    queryKey: ["follow-up-rules"],
    queryFn: () => fetch("/api/admin/follow-up-rules").then((r) => r.json()),
  });

  const { data: templates = [] } = useQuery<Template[]>({
    queryKey: ["templates"],
    queryFn: () => fetch("/api/admin/templates").then((r) => r.json()),
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name,
        triggerEvent: form.triggerEvent,
        delayMinutes: form.delayMinutes,
        messageTemplateId: form.messageTemplateId || null,
        taskTemplateJson: form.taskTitle
          ? {
              title: form.taskTitle,
              description: form.taskDescription || undefined,
              dueInDays: form.taskDueInDays ? Number(form.taskDueInDays) : undefined,
              priority: form.taskPriority,
            }
          : null,
        isActive: form.isActive,
      };
      const url = editingId
        ? `/api/admin/follow-up-rules/${editingId}`
        : "/api/admin/follow-up-rules";
      const res = await fetch(url, {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Save failed" }));
        throw new Error(err.error || "Save failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["follow-up-rules"] });
      setOpen(false);
      setEditingId(null);
      setForm(empty);
      toast.success(editingId ? "Rule updated" : "Rule created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/follow-up-rules/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["follow-up-rules"] });
      toast.success("Rule deleted");
    },
  });

  function startCreate() {
    setEditingId(null);
    setForm(empty);
    setOpen(true);
  }

  function startEdit(r: Rule) {
    setEditingId(r.id);
    setForm({
      name: r.name,
      triggerEvent: r.triggerEvent,
      delayMinutes: r.delayMinutes,
      messageTemplateId: r.messageTemplateId || "",
      taskTitle: r.taskTemplateJson?.title || "",
      taskDescription: r.taskTemplateJson?.description || "",
      taskDueInDays:
        r.taskTemplateJson?.dueInDays != null ? String(r.taskTemplateJson.dueInDays) : "",
      taskPriority:
        (r.taskTemplateJson?.priority as FormState["taskPriority"]) || "MEDIUM",
      isActive: r.isActive,
    });
    setOpen(true);
  }

  function formatDelay(min: number) {
    if (min < 60) return `${min}m`;
    if (min < 1440) return `${Math.round(min / 60)}h`;
    return `${Math.round(min / 1440)}d`;
  }

  return (
    <div>
      <PageHeader
        title="Follow-Up Rules"
        description="Automated SMS, email, and tasks triggered by lead events"
        actions={
          <Button type="button" onClick={startCreate}>
            <Plus className="mr-2 h-4 w-4" />
            New Rule
          </Button>
        }
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Rule" : "New Rule"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Welcome SMS 5m after creation"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Trigger</Label>
                <Select
                  value={form.triggerEvent}
                  onValueChange={(v) =>
                    setForm({ ...form, triggerEvent: v as FormState["triggerEvent"] })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRIGGERS.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Delay (minutes)</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.delayMinutes}
                  onChange={(e) =>
                    setForm({ ...form, delayMinutes: Number(e.target.value) })
                  }
                />
              </div>
            </div>
            <div>
              <Label>Message Template (optional)</Label>
              <Select
                value={form.messageTemplateId || "__none"}
                onValueChange={(v) =>
                  setForm({
                    ...form,
                    messageTemplateId: v && v !== "__none" ? v : "",
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="No message" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— no message —</SelectItem>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} ({t.channel})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="rounded border p-3 space-y-3">
              <div className="text-sm font-medium">Task to create (optional)</div>
              <Input
                placeholder="Task title (e.g. Call {{lead.firstName}})"
                value={form.taskTitle}
                onChange={(e) => setForm({ ...form, taskTitle: e.target.value })}
              />
              <Textarea
                rows={2}
                placeholder="Task description"
                value={form.taskDescription}
                onChange={(e) => setForm({ ...form, taskDescription: e.target.value })}
              />
              <div className="grid grid-cols-2 gap-3">
                <Input
                  type="number"
                  min={0}
                  placeholder="Due in days"
                  value={form.taskDueInDays}
                  onChange={(e) => setForm({ ...form, taskDueInDays: e.target.value })}
                />
                <Select
                  value={form.taskPriority}
                  onValueChange={(v) =>
                    setForm({ ...form, taskPriority: v as FormState["taskPriority"] })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["LOW", "MEDIUM", "HIGH", "URGENT"].map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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

            <Button className="w-full" disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? "Saving..." : editingId ? "Update" : "Create"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead>Delay</TableHead>
                <TableHead>Message</TableHead>
                <TableHead>Task</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-28"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : rules.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    No rules yet.
                  </TableCell>
                </TableRow>
              ) : (
                rules.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{r.triggerEvent.replace(/_/g, " ")}</Badge>
                    </TableCell>
                    <TableCell>{formatDelay(r.delayMinutes)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.messageTemplate
                        ? `${r.messageTemplate.name} (${r.messageTemplate.channel})`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.taskTemplateJson?.title || "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.isActive ? "default" : "secondary"}>
                        {r.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => startEdit(r)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          if (confirm(`Delete "${r.name}"?`)) remove.mutate(r.id);
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
