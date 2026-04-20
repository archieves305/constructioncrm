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
import { TEMPLATE_VARIABLES } from "@/lib/templates/render";

type Template = {
  id: string;
  name: string;
  channel: "SMS" | "EMAIL" | "IN_APP";
  templateBody: string;
  isActive: boolean;
};

const CHANNELS = ["SMS", "EMAIL", "IN_APP"] as const;

const empty: Omit<Template, "id"> = {
  name: "",
  channel: "SMS",
  templateBody: "",
  isActive: true,
};

export default function TemplatesPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Omit<Template, "id">>(empty);

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

  function startCreate() {
    setEditingId(null);
    setForm(empty);
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
    setOpen(true);
  }

  return (
    <div>
      <PageHeader
        title="Message Templates"
        description="SMS and email bodies used by follow-up rules. Use {{lead.firstName}}, {{lead.fullName}}, etc."
        actions={
          <Button type="button" onClick={startCreate}>
            <Plus className="mr-2 h-4 w-4" />
            New Template
          </Button>
        }
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Template" : "New Template"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. New lead welcome SMS"
              />
            </div>
            <div>
              <Label>Channel</Label>
              <Select
                value={form.channel}
                onValueChange={(v) => setForm({ ...form, channel: v as Template["channel"] })}
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
              <Label>Body</Label>
              <Textarea
                rows={6}
                value={form.templateBody}
                onChange={(e) => setForm({ ...form, templateBody: e.target.value })}
                placeholder="Hi {{lead.firstName}}, thanks for reaching out..."
              />
              <p className="mt-2 text-xs text-muted-foreground">
                Variables:{" "}
                {TEMPLATE_VARIABLES.map((v) => (
                  <code key={v} className="mr-1 rounded bg-muted px-1">
                    {`{{${v}}}`}
                  </code>
                ))}
              </p>
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
