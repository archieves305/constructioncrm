"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

type Stage = { id: string; name: string; stageOrder: number };
type UserOpt = { id: string; firstName: string; lastName: string; isActive: boolean };
type Template = {
  id: string;
  stageId: string;
  title: string;
  description: string | null;
  priority: (typeof PRIORITIES)[number];
  relativeDueInDays: number | null;
  defaultAssignedUserId: string | null;
  isActive: boolean;
  stage: Stage;
  defaultAssignee: { firstName: string; lastName: string } | null;
};

type Form = {
  stageId: string;
  title: string;
  description: string;
  priority: (typeof PRIORITIES)[number];
  relativeDueInDays: string;
  defaultAssignedUserId: string;
  isActive: boolean;
};

const emptyForm: Form = {
  stageId: "",
  title: "",
  description: "",
  priority: "MEDIUM",
  relativeDueInDays: "",
  defaultAssignedUserId: "",
  isActive: true,
};

export default function JobTaskTemplatesPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);

  const { data: templates = [], isLoading } = useQuery<Template[]>({
    queryKey: ["job-task-templates"],
    queryFn: () => fetch("/api/admin/job-task-templates").then((r) => r.json()),
  });

  const { data: stages = [] } = useQuery<Stage[]>({
    queryKey: ["jobStages"],
    queryFn: () => fetch("/api/jobs/stages").then((r) => r.json()),
  });

  const { data: users = [] } = useQuery<UserOpt[]>({
    queryKey: ["admin-users"],
    queryFn: () => fetch("/api/admin/users").then((r) => r.json()),
  });
  const activeUsers = users.filter((u) => u.isActive);

  const save = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        stageId: form.stageId,
        title: form.title,
        description: form.description || null,
        priority: form.priority,
        relativeDueInDays: form.relativeDueInDays
          ? Number(form.relativeDueInDays)
          : null,
        defaultAssignedUserId: form.defaultAssignedUserId || null,
        isActive: form.isActive,
      };
      const url = editingId
        ? `/api/admin/job-task-templates/${editingId}`
        : "/api/admin/job-task-templates";
      const res = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
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
      qc.invalidateQueries({ queryKey: ["job-task-templates"] });
      setOpen(false);
      setEditingId(null);
      setForm(emptyForm);
      toast.success(editingId ? "Template updated" : "Template created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/admin/job-task-templates/${id}`, { method: "DELETE" }).then((r) =>
        r.json(),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["job-task-templates"] });
      toast.success("Deleted");
    },
  });

  function startCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setOpen(true);
  }

  function startEdit(t: Template) {
    setEditingId(t.id);
    setForm({
      stageId: t.stageId,
      title: t.title,
      description: t.description ?? "",
      priority: t.priority,
      relativeDueInDays:
        t.relativeDueInDays !== null ? String(t.relativeDueInDays) : "",
      defaultAssignedUserId: t.defaultAssignedUserId ?? "",
      isActive: t.isActive,
    });
    setOpen(true);
  }

  const canSave = form.stageId && form.title.trim().length > 0;

  return (
    <div>
      <PageHeader
        title="Job Task Templates"
        description="Tasks auto-created when a job enters a stage"
        actions={
          <Button onClick={startCreate}>
            <Plus className="mr-2 h-4 w-4" />
            New Template
          </Button>
        }
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Edit Template" : "New Template"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Job stage (trigger)</Label>
              <Select
                value={form.stageId || "__none"}
                onValueChange={(v: string | null) =>
                  setForm({
                    ...form,
                    stageId: !v || v === "__none" ? "" : v,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pick a stage">
                    {(v: string) => {
                      if (!v || v === "__none") return "Pick a stage";
                      return stages.find((s) => s.id === v)?.name || "—";
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— pick a stage —</SelectItem>
                  {stages.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Task title</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. Order materials"
              />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea
                rows={2}
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Priority</Label>
                <Select
                  value={form.priority}
                  onValueChange={(v: string | null) =>
                    setForm({
                      ...form,
                      priority: (v as Form["priority"]) || "MEDIUM",
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue>{(v: string) => v || "MEDIUM"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Due in (days after stage entry)</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.relativeDueInDays}
                  onChange={(e) =>
                    setForm({ ...form, relativeDueInDays: e.target.value })
                  }
                  placeholder="e.g. 5"
                />
              </div>
            </div>
            <div>
              <Label>Default assignee</Label>
              <Select
                value={form.defaultAssignedUserId || "__none"}
                onValueChange={(v: string | null) =>
                  setForm({
                    ...form,
                    defaultAssignedUserId: !v || v === "__none" ? "" : v,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Use job's PM/rep">
                    {(v: string) => {
                      if (!v || v === "__none") return "Use job's PM / rep";
                      const u = activeUsers.find((x) => x.id === v);
                      return u ? `${u.firstName} ${u.lastName}` : "—";
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Use job's PM / rep</SelectItem>
                  {activeUsers.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.firstName} {u.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="tt-active"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              />
              <Label htmlFor="tt-active" className="cursor-pointer">
                Active
              </Label>
            </div>
            <Button
              className="w-full"
              disabled={!canSave || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? "Saving…" : editingId ? "Update" : "Create"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Stage</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Default assignee</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : templates.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="py-8 text-center text-muted-foreground"
                  >
                    No templates yet. Create one to auto-generate tasks when a
                    job enters a stage.
                  </TableCell>
                </TableRow>
              ) : (
                templates.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>
                      <Badge variant="outline">{t.stage.name}</Badge>
                    </TableCell>
                    <TableCell className="font-medium">{t.title}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          t.priority === "URGENT" ? "destructive" : "outline"
                        }
                        className="text-xs"
                      >
                        {t.priority}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {t.relativeDueInDays !== null
                        ? `+${t.relativeDueInDays}d`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {t.defaultAssignee
                        ? `${t.defaultAssignee.firstName} ${t.defaultAssignee.lastName}`
                        : "PM / rep"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={t.isActive ? "default" : "secondary"}
                        className="text-xs"
                      >
                        {t.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => startEdit(t)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          if (confirm(`Delete "${t.title}"?`)) remove.mutate(t.id);
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
