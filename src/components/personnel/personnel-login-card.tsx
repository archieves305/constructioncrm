"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/ui/field";
import { fetchJson } from "@/lib/fetch-json";
import { roleDisplayName } from "@/lib/auth/role-display";
import type { RoleName } from "@/generated/prisma/enums";

type Linked = { user: { id: string; name: string; email: string; role: RoleName; isActive: boolean } | null };
type Candidate = { id: string; firstName: string; lastName: string; role: { name: RoleName } };
const NONE = "__none__";

/**
 * Which CRM login this worker uses in KNU Field. Once linked, the jobs their
 * crew is assigned to appear in their crew mode. The login itself (and its
 * Crew Member role) is created in CareyOS; this only connects the two.
 */
export function PersonnelLoginCard({ personnelId }: { personnelId: string }) {
  const qc = useQueryClient();
  const linked = useQuery<Linked>({ queryKey: ["personnel-login", personnelId], queryFn: () => fetchJson(`/api/personnel/${personnelId}/login`) });
  const users = useQuery<Candidate[]>({ queryKey: ["assignable-users"], queryFn: () => fetchJson("/api/users/assignable") });
  const [draft, setDraft] = useState<string | null>(null);
  const currentId = linked.data?.user?.id ?? NONE;
  const value = draft ?? currentId;

  const save = useMutation({
    mutationFn: (userId: string | null) =>
      fetchJson<Linked>(`/api/personnel/${personnelId}/login`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }) }),
    onSuccess: (data) => {
      qc.setQueryData(["personnel-login", personnelId], data);
      setDraft(null);
      toast.success(data.user ? `Linked to ${data.user.name}` : "Login unlinked");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const items: Record<string, string> = { [NONE]: "No login" };
  for (const u of users.data ?? []) items[u.id] = `${u.firstName} ${u.lastName} · ${roleDisplayName(u.role.name)}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>KNU Field login</CardTitle>
        <p className="text-sm text-muted-foreground">
          The CRM login this worker signs in to the phone app with. Their crew&apos;s jobs then show in their crew mode. Create the login in CareyOS with the Crew Member role first.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <Field label="Login">
          <Select items={items} value={value} onValueChange={(v) => v && setDraft(v)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(items).map(([id, label]) => (
                <SelectItem key={id} value={id}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {linked.data?.user && !linked.data.user.isActive ? <p className="text-sm text-tone-warning-fg">That login is switched off in the CRM.</p> : null}
        <div className="flex justify-end">
          <Button disabled={value === currentId} loading={save.isPending} onClick={() => save.mutate(value === NONE ? null : value)}>
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
