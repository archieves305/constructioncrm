"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { HardHat, Plus, X } from "lucide-react";

type Assignment = {
  id: string;
  userId: string;
  user: { id: string; firstName: string; lastName: string; email: string };
};

type UserRow = {
  id: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  role: { name: string };
};

// Who runs this job in Field Mode. Crew leads only see jobs they're assigned
// to here (or where they're the PM); office roles see everything regardless.
export function FieldAssignmentsPanel({ jobId }: { jobId: string }) {
  const qc = useQueryClient();
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const canManage = role === "ADMIN" || role === "MANAGER";

  const [selectedUserId, setSelectedUserId] = useState("");

  const { data: assignments = [] } = useQuery<Assignment[]>({
    queryKey: ["field-assignments", jobId],
    queryFn: () =>
      fetch(`/api/jobs/${jobId}/field-assignments`).then((r) => r.json()),
  });

  const { data: users = [] } = useQuery<UserRow[]>({
    queryKey: ["users"],
    queryFn: () => fetch("/api/admin/users").then((r) => r.json()),
    enabled: canManage,
  });

  const assigned = new Set(assignments.map((a) => a.userId));
  // Crew leads first — they're the usual assignees — then other active users.
  const candidates = users
    .filter((u) => u.isActive && !assigned.has(u.id))
    .sort((a, b) =>
      a.role.name === b.role.name
        ? a.lastName.localeCompare(b.lastName)
        : a.role.name === "CREW_LEAD"
          ? -1
          : b.role.name === "CREW_LEAD"
            ? 1
            : 0,
    );

  const add = useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch(`/api/jobs/${jobId}/field-assignments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to assign");
      return body;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["field-assignments", jobId] });
      setSelectedUserId("");
      toast.success("Field access granted");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch(
        `/api/jobs/${jobId}/field-assignments?userId=${userId}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("Failed to remove");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["field-assignments", jobId] });
      toast.success("Field access removed");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <HardHat className="h-4 w-4" /> Field access
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-muted-foreground text-sm">
          Crew leads assigned here (or set as project manager) see this job in
          Field Mode and can run its daily logs.
        </p>

        {assignments.length === 0 ? (
          <p className="text-muted-foreground text-sm italic">
            No one assigned yet.
          </p>
        ) : (
          <ul className="space-y-1">
            {assignments.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm"
              >
                <span className="flex-1 font-medium">
                  {a.user.firstName} {a.user.lastName}
                </span>
                <span className="text-muted-foreground">{a.user.email}</span>
                {canManage && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => remove.mutate(a.userId)}
                    disabled={remove.isPending}
                    aria-label="Remove field access"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {canManage && (
          <div className="flex items-center gap-2">
            <Select
              value={selectedUserId || undefined}
              onValueChange={(v) => v && setSelectedUserId(v)}
            >
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Choose a user…" />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.firstName} {u.lastName}
                    {u.role.name === "CREW_LEAD" ? " (Crew Lead)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              disabled={!selectedUserId || add.isPending}
              onClick={() => add.mutate(selectedUserId)}
            >
              <Plus className="mr-1 h-4 w-4" /> Assign
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
