"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow, format } from "date-fns";
import { Smartphone } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { Callout } from "@/components/shared/callout";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson, retryServerErrors } from "@/lib/fetch-json";

type Device = {
  id: string;
  platform: "ios" | "android";
  appVersion: string | null;
  deviceName: string | null;
  lastSeenAt: string;
  createdAt: string;
  revokedAt: string | null;
  revokedReason: string | null;
  revokedBy: string | null;
  activeSessions: number;
  user: { id: string; firstName: string; lastName: string; email: string };
};

/**
 * Every phone signed in to the KNU Field app. Signing a phone out here stops
 * every sign-in it holds at once (lost or handed-on phone); the person's
 * CareyOS account and other phones are untouched. "Allow again" lets the phone
 * sign in afresh. Both are recorded in the audit log.
 */
export default function PhonesPage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "mobile-devices"],
    queryFn: () => fetchJson<{ devices: Device[] }>("/api/admin/mobile-devices"),
    retry: retryServerErrors,
  });
  const [revoking, setRevoking] = useState<Device | null>(null);
  const [reason, setReason] = useState("");

  const revoke = useMutation({
    mutationFn: ({ id, why }: { id: string; why: string }) =>
      fetchJson(`/api/admin/mobile-devices/${id}/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: why }),
      }),
    onSuccess: () => {
      toast.success("Phone signed out");
      setRevoking(null);
      setReason("");
      void qc.invalidateQueries({ queryKey: ["admin", "mobile-devices"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't sign the phone out"),
  });

  const restore = useMutation({
    mutationFn: (id: string) => fetchJson(`/api/admin/mobile-devices/${id}/restore`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Phone allowed again. The person signs in on it afresh.");
      void qc.invalidateQueries({ queryKey: ["admin", "mobile-devices"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't allow the phone again"),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Phones"
        description="Phones signed in to the KNU Field app. Sign one out if it is lost or no longer used."
      />
      {error ? (
        <Callout tone="danger" title="Couldn't load phones">{error instanceof Error ? error.message : "Something went wrong."}</Callout>
      ) : isLoading || !data ? (
        <Skeleton className="h-48" />
      ) : data.devices.length === 0 ? (
        <EmptyState icon={Smartphone} title="No phones yet" description="Phones appear here once someone signs in to the KNU Field app." />
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>App</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right"> </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.devices.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>
                      <div className="font-medium">{`${d.user.firstName} ${d.user.lastName}`.trim()}</div>
                      <div className="text-xs text-muted-foreground">{d.user.email}</div>
                    </TableCell>
                    <TableCell>
                      <div>{d.deviceName ?? "Unnamed phone"}</div>
                      <div className="text-xs text-muted-foreground">
                        {d.platform === "ios" ? "iPhone" : "Android"} · since {format(new Date(d.createdAt), "MMM d, yyyy")}
                      </div>
                    </TableCell>
                    <TableCell className="tabular-nums">{d.appVersion ?? "—"}</TableCell>
                    <TableCell title={format(new Date(d.lastSeenAt), "PPpp")}>
                      {formatDistanceToNow(new Date(d.lastSeenAt), { addSuffix: true })}
                    </TableCell>
                    <TableCell>
                      {d.revokedAt ? (
                        <div className="space-y-1">
                          <Badge variant="destructive">Signed out</Badge>
                          <div className="text-xs text-muted-foreground">
                            {d.revokedBy ? `by ${d.revokedBy}, ` : ""}
                            {format(new Date(d.revokedAt), "MMM d")}: {d.revokedReason}
                          </div>
                        </div>
                      ) : d.activeSessions > 0 ? (
                        <Badge variant="secondary">Signed in</Badge>
                      ) : (
                        <Badge variant="outline">Signed out on the phone</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {d.revokedAt ? (
                        <Button variant="outline" size="sm" disabled={restore.isPending} onClick={() => restore.mutate(d.id)}>
                          Allow again
                        </Button>
                      ) : (
                        <Button variant="outline" size="sm" onClick={() => setRevoking(d)}>
                          Sign out this phone
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={revoking !== null} onOpenChange={(open) => !open && setRevoking(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign out this phone?</DialogTitle>
            <DialogDescription>
              {revoking
                ? `${revoking.user.firstName}'s ${revoking.deviceName ?? "phone"} stops working with the CRM on its next request. Their CareyOS account and other phones keep working.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="revoke-reason">Why (kept in the audit log)</Label>
            <Textarea
              id="revoke-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Phone lost on site"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevoking(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={reason.trim().length < 3 || revoke.isPending}
              onClick={() => revoking && revoke.mutate({ id: revoking.id, why: reason.trim() })}
            >
              Sign out this phone
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
