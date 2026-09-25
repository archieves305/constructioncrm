"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
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
import { Shield } from "lucide-react";
import { roleDisplayName } from "@/lib/auth/role-display";
import type { RoleName } from "@/generated/prisma/client";
import { useSession } from "@/lib/auth/session-client";

type SelectableRole = {
  id: string;
  name: RoleName;
  displayName: string;
  description: string;
};

type UserRow = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: { id: string; name: RoleName };
  isActive: boolean;
  canViewSensitivePersonnel: boolean;
  canEditPayRates: boolean;
  canViewPayrollReports: boolean;
  canEnterJobCosts: boolean;
};

const GRANT_OPTIONS = [
  {
    key: "canViewSensitivePersonnel" as const,
    label: "View sensitive personnel data",
    description: "Reveal SSNs and open W-9/ID documents (every access is logged)",
  },
  {
    key: "canEditPayRates" as const,
    label: "Edit pay rates",
    description: "Set hourly rates on personnel records",
  },
  {
    key: "canViewPayrollReports" as const,
    label: "View payroll reports",
    description: "Cross-job per-person labor reports and payroll exports",
  },
  {
    key: "canEnterJobCosts" as const,
    label: "Enter job costs",
    description:
      "Add and amend charges on jobs. Admin, Manager and Accounting already can — grant this to a PM or crew lead who buys materials",
  },
];

type SessionUser = {
  id?: string;
  role?: RoleName;
};

async function parseError(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const json = JSON.parse(text) as {
      error?: string;
      suggestions?: string[];
    };
    if (json?.error) {
      return json.suggestions?.length
        ? `${json.error} — ${json.suggestions.join(" ")}`
        : json.error;
    }
  } catch {
    /* not json */
  }
  return text || `Request failed (${res.status})`;
}

export default function AdminUsersPage() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const currentUser = (session?.user as SessionUser | undefined) ?? {};
  const isAdmin = currentUser.role === "ADMIN";
  const [grantsUserId, setGrantsUserId] = useState<string | null>(null);

  const { data: users, isLoading } = useQuery<UserRow[]>({
    queryKey: ["users"],
    queryFn: () => fetch("/api/admin/users").then((r) => r.json()),
  });

  const { data: roles } = useQuery<SelectableRole[]>({
    queryKey: ["roles"],
    queryFn: () => fetch("/api/admin/roles").then((r) => r.json()),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (!res.ok) throw new Error(await parseError(res));
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success("User updated");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const changeRole = useMutation({
    mutationFn: async ({ id, roleId }: { id: string; roleId: string }) => {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleId }),
      });
      if (!res.ok) throw new Error(await parseError(res));
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success("Role updated");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateGrant = useMutation({
    mutationFn: async ({
      id,
      key,
      value,
    }: {
      id: string;
      key: (typeof GRANT_OPTIONS)[number]["key"];
      value: boolean;
    }) => {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      if (!res.ok) throw new Error(await parseError(res));
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success("Permissions updated");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div>
      <PageHeader
        title="Users"
        description="Manage CRM users and roles"
        actions={
          <p className="max-w-xs text-right text-xs text-muted-foreground">
            Users are created in the CareyOS admin and appear here on their first sign-in.
          </p>
        }
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : (
                users?.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">
                      {user.firstName} {user.lastName}
                    </TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      {isAdmin ? (
                        <Select
                          value={user.role.id}
                          onValueChange={(v: string | null) => {
                            if (!v || v === user.role.id) return;
                            const next = roles?.find((r) => r.id === v);
                            const isSelf = currentUser.id === user.id;
                            const confirmMsg = isSelf
                              ? `Change your own role to ${next?.displayName ?? "the selected role"}? You'll keep ADMIN access only if the new role is ADMIN.`
                              : `Change ${user.firstName} ${user.lastName}'s role to ${next?.displayName ?? "the selected role"}?`;
                            if (confirm(confirmMsg)) {
                              changeRole.mutate({ id: user.id, roleId: v });
                            }
                          }}
                        >
                          <SelectTrigger className="h-8 w-[170px]">
                            <SelectValue>
                              <div className="flex items-center gap-1">
                                <Shield className="h-3 w-3" />
                                {roleDisplayName(user.role.name)}
                              </div>
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {roles?.map((r) => (
                              <SelectItem key={r.id} value={r.id} label={r.displayName}>
                                <div className="flex flex-col">
                                  <span>{r.displayName}</span>
                                  <span className="text-xs text-muted-foreground">
                                    {r.description}
                                  </span>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant="outline">
                          {roleDisplayName(user.role.name)}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={user.isActive ? "default" : "secondary"}>
                        {user.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      {isAdmin && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setGrantsUserId(user.id)}
                        >
                          <Shield className="mr-1 h-4 w-4" />
                          Permissions
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          toggleActive.mutate({
                            id: user.id,
                            isActive: !user.isActive,
                          })
                        }
                      >
                        {user.isActive ? "Deactivate" : "Activate"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog
        open={grantsUserId !== null}
        onOpenChange={(open) => {
          if (!open) setGrantsUserId(null);
        }}
      >
        <DialogContent>
          {(() => {
            const gu = users?.find((u) => u.id === grantsUserId);
            if (!gu) return null;
            return (
              <>
                <DialogHeader>
                  <DialogTitle>
                    Field permissions — {gu.firstName} {gu.lastName}
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  {gu.role.name === "ADMIN" ? (
                    <p className="text-muted-foreground text-sm">
                      Admins implicitly hold all field permissions.
                    </p>
                  ) : (
                    GRANT_OPTIONS.map((opt) => (
                      <label
                        key={opt.key}
                        className="flex cursor-pointer items-start gap-3"
                      >
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={gu[opt.key]}
                          disabled={updateGrant.isPending}
                          onChange={(e) =>
                            updateGrant.mutate({
                              id: gu.id,
                              key: opt.key,
                              value: e.target.checked,
                            })
                          }
                        />
                        <span>
                          <span className="block text-sm font-medium">
                            {opt.label}
                          </span>
                          <span className="text-muted-foreground block text-xs">
                            {opt.description}
                          </span>
                        </span>
                      </label>
                    ))
                  )}
                  <p className="text-muted-foreground text-xs">
                    Grants apply on top of the user&apos;s role: they only take
                    effect for Sales Manager and Accounting roles. Changes are
                    audited.
                  </p>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

    </div>
  );
}
