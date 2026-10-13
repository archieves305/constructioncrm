"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { format, formatDistanceToNowStrict } from "date-fns";
import { ArrowDownLeft, ArrowUpRight, Building2, CalendarClock, CheckSquare, ExternalLink, Globe, Mail, MapPin, MessageSquarePlus, MoreHorizontal, Pencil, Phone, Plus, Star, Trash2, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { EntityHeader } from "@/components/shared/entity-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { PageHeader } from "@/components/shared/page-header";
import { StageStepper } from "@/components/shared/stage-stepper";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { UserAvatar } from "@/components/shared/user-avatar";
import { useSearchParamState } from "@/components/shared/use-search-param-state";
import { useIsPhone } from "@/components/shared/use-media-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchJson, HttpError } from "@/lib/fetch-json";
import { lastTouchLabel } from "@/lib/partners/derive";
import { stageDef, stagesAsStageLike } from "@/lib/partners/stages";
import { cn } from "@/lib/utils";
import { ContactFormDialog, contactFormValues } from "@/components/partners/contact-form-dialog";
import { InteractionDialog } from "@/components/partners/interaction-dialog";
import { OrgFormDialog, orgFormValues } from "@/components/partners/org-form-dialog";
import { OwnerDialog } from "@/components/partners/owner-dialog";
import { OrgBadges, PriorityBadge } from "@/components/partners/stage-badges";
import { KIND_LABEL, personName, useChangeStage, useInteractions, useInvalidatePartners, useOrganization, usePartnerOptions, type Contact, type Interaction, type InteractionKind, type OrgDetail } from "@/components/partners/use-partners";
import { QualificationPanel } from "@/components/partners/qualification-panel";
import { OrgDocumentsTab } from "@/components/partners/org-documents-tab";

const STAGES = stagesAsStageLike();
const TABS = ["overview", "contacts", "qualification", "documents", "activity"] as const;
type Tab = (typeof TABS)[number];

export default function PartnerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const url = useSearchParamState();
  const isPhone = useIsPhone();
  const tab: Tab = (TABS as readonly string[]).includes(url.get("tab") ?? "") ? (url.get("tab") as Tab) : "overview";
  const { data, isLoading, error, refetch } = useOrganization(id);
  const invalidate = useInvalidatePartners();
  const changeStage = useChangeStage(id);

  const [editing, setEditing] = useState(false);
  const [logging, setLogging] = useState<{ open: boolean; interaction?: Interaction | null }>({ open: false });
  const [contactDialog, setContactDialog] = useState<{ open: boolean; contact?: Contact | null }>({ open: false });
  const [ownerOpen, setOwnerOpen] = useState(false);
  const [writeOff, setWriteOff] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const remove = useMutation({
    mutationFn: () => fetchJson(`/api/partners/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      toast.success("Account deleted");
      router.push("/partners");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const crumbs = [{ label: "Business Development" }, { label: "GC Partnerships", href: "/partners" }, { label: data?.organization.name ?? "Account" }];

  if (isLoading) return <ListSkeleton rows={8} />;
  if (error || !data) {
    const missing = error instanceof HttpError && error.status === 404;
    return (
      <div>
        <PageHeader title="Account" breadcrumb={crumbs} />
        <EmptyState icon={Building2} title={missing ? "Account not found" : "This account could not be loaded"} description={missing ? "It may have been deleted." : (error as Error | null)?.message} action={!missing && <Button variant="outline" onClick={() => refetch()}>Try again</Button>} />
      </div>
    );
  }

  const { organization: org, permissions, badges } = data;
  const now = new Date();
  const activeContacts = org.contacts.filter((c) => c.isActive);
  const stageNote = (from: { name: string }, to: { id?: string; name: string }) =>
    to.id === "DO_NOT_PURSUE" ? "A reason is required; the account leaves the open board and raises no more follow-ups." : to.id === "DORMANT" ? "Parked on purpose: no follow-ups until it is moved back." : undefined;

  const header = (
    <EntityHeader
      breadcrumb={crumbs}
      title={org.name}
      subtitle={[KIND_LABEL[org.kind], org.city, org.markets.slice(0, 3).join(", ")].filter(Boolean).join(" · ")}
      badges={
        <>
          <PriorityBadge priority={org.priority} />
          {!org.isActive && <Badge variant="outline">Inactive</Badge>}
          <OrgBadges badges={badges} />
        </>
      }
      actions={
        <>
          {permissions.canManage && (
            <Button variant="brand" onClick={() => setLogging({ open: true })}>
              <MessageSquarePlus className="mr-2 size-4" /> Log interaction
            </Button>
          )}
          {permissions.canManage && (
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil className="mr-2 size-4" /> Edit
            </Button>
          )}
          {permissions.canAdmin && (
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="More actions" />}>
                <MoreHorizontal className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setOwnerOpen(true)}>
                  <UserCheck className="size-4" /> Change owner
                </DropdownMenuItem>
                {org.stage !== "DO_NOT_PURSUE" && (
                  <DropdownMenuItem onClick={() => setWriteOff(true)}>
                    <Trash2 className="size-4" /> Do not pursue…
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setDeleting(true)} className="text-tone-danger-fg">
                  <Trash2 className="size-4" /> Delete account…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </>
      }
    >
      <StageStepper
        stages={STAGES}
        currentStageId={org.stage}
        entityLabel="account"
        disabled={!permissions.canManage || changeStage.isPending}
        confirmNote={stageNote}
        onChange={(stageId) => {
          if (stageId === "DO_NOT_PURSUE") {
            if (!permissions.canAdmin) return toast.error("Only a manager can mark an account Do not pursue");
            setWriteOff(true);
            return;
          }
          changeStage.mutate({ stage: stageId as OrgDetail["organization"]["stage"] });
        }}
      />
    </EntityHeader>
  );

  return (
    <div className={cn(isPhone && "pb-20")}>
      {header}

      <Tabs value={tab} onValueChange={(v) => v && url.set("tab", v === "overview" ? null : String(v))}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="contacts">Contacts ({activeContacts.length})</TabsTrigger>
          <TabsTrigger value="qualification">Qualification</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="activity">Activity ({data.interactionCount})</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab data={data} now={now} onLog={() => setLogging({ open: true })} onAddContact={() => setContactDialog({ open: true })} />
        </TabsContent>

        <TabsContent value="contacts" className="mt-4">
          <ContactsTab org={org} canManage={permissions.canManage} now={now} onAdd={() => setContactDialog({ open: true })} onEdit={(c) => setContactDialog({ open: true, contact: c })} />
        </TabsContent>

        <TabsContent value="qualification" className="mt-4">
          <QualificationPanel organizationId={org.id} organizationName={org.name} canManage={permissions.canManage} />
        </TabsContent>

        <TabsContent value="documents" className="mt-4">
          <OrgDocumentsTab organizationId={org.id} organizationName={org.name} />
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          <ActivityTab org={org} canManage={permissions.canManage} onEdit={(i) => setLogging({ open: true, interaction: i })} onLog={() => setLogging({ open: true })} />
        </TabsContent>
      </Tabs>

      {isPhone && permissions.canManage && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-white p-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
          <Button variant="brand" className="h-11 w-full" onClick={() => setLogging({ open: true })}>
            <MessageSquarePlus className="mr-2 size-4" /> Log interaction
          </Button>
        </div>
      )}

      <OrgFormDialog open={editing} onOpenChange={setEditing} organizationId={org.id} initial={orgFormValues(org)} canAdmin={permissions.canAdmin} />
      <InteractionDialog
        open={logging.open}
        onOpenChange={(o) => setLogging({ open: o, interaction: o ? logging.interaction : null })}
        organizationId={org.id}
        organizationName={org.name}
        contacts={org.contacts}
        ownerUserId={org.ownerUserId}
        interaction={logging.interaction}
      />
      <ContactFormDialog
        open={contactDialog.open}
        onOpenChange={(o) => setContactDialog({ open: o, contact: o ? contactDialog.contact : null })}
        organizationId={org.id}
        contactId={contactDialog.contact?.id}
        initial={contactDialog.contact ? contactFormValues(contactDialog.contact) : { isPrimary: activeContacts.length === 0 }}
      />
      <OwnerDialog open={ownerOpen} onOpenChange={setOwnerOpen} organizationId={org.id} current={org.ownerUserId} />
      <ConfirmDialog
        open={writeOff}
        onOpenChange={setWriteOff}
        title={`Stop pursuing ${org.name}?`}
        description="It leaves the board's open columns and raises no more follow-ups. The reason stays on the account's history; a manager can move it back."
        tone="warning"
        confirmLabel="Do not pursue"
        requireReason
        reasonLabel="Why"
        pending={changeStage.isPending}
        onConfirm={async (reason) => {
          await changeStage.mutateAsync({ stage: "DO_NOT_PURSUE", reason });
          setWriteOff(false);
        }}
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${org.name}?`}
        description="Its contacts, interactions and history go with it. An account with leads or bids attached cannot be deleted — mark it Do not pursue instead."
        tone="danger"
        confirmLabel="Delete"
        checkboxLabel="I understand this cannot be undone"
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}

function OverviewTab({ data, now, onLog, onAddContact }: { data: OrgDetail; now: Date; onLog: () => void; onAddContact: () => void }) {
  const { organization: org, openTasks, permissions } = data;
  const primary = org.contacts.find((c) => c.isPrimary && c.isActive) ?? org.contacts.find((c) => c.isActive) ?? null;
  const recent = useInteractions(org.id);
  const hasProfile = Boolean(org.annualVolume || org.companySize || org.projectTypes.length || org.typicalProjectSize || org.biddingPlatform || org.prequalPlatform || org.vendorRegistrationUrl || org.requirementsNotes);
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="min-w-0 space-y-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Relationship</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Owner">
              <span className="flex items-center gap-1.5">
                <UserAvatar user={org.owner} size="xs" />
                {personName(org.owner) ?? <span className="text-muted-foreground">Nobody yet</span>}
              </span>
            </Row>
            <Row label="Stage">
              {stageDef(org.stage).name} <span className="text-xs text-muted-foreground">since {format(new Date(org.stageChangedAt), "MMM d, yyyy")}</span>
            </Row>
            <Row label="Last touch">{lastTouchLabel(org.lastContactAt, now)}</Row>
            {org.nextFollowUpAt && <Row label="Next follow-up">{format(new Date(org.nextFollowUpAt), "EEE, MMM d")}</Row>}
            {org.potentialAnnualRevenue !== null && <Row label="Potential / year">{org.potentialAnnualRevenue.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}</Row>}
            {org.paymentTermsDays !== null && <Row label="Payment terms">{org.paymentTermsDays} days</Row>}
            {org.trades.length > 0 && (
              <Row label="Trades">
                <span className="flex flex-wrap gap-1">{org.trades.map((t) => <Badge key={t.id} variant="outline" className="text-[11px]">{t.name}</Badge>)}</span>
              </Row>
            )}
            {org.markets.length > 0 && <Row label="Markets">{org.markets.join(", ")}</Row>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Company</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {org.website && <a href={org.website.startsWith("http") ? org.website : `https://${org.website}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 break-all hover:underline"><Globe className="size-4 shrink-0 text-muted-foreground" />{org.website.replace(/^https?:\/\//, "")}<ExternalLink className="size-3 text-muted-foreground" /></a>}
            {org.phone && <a href={`tel:${org.phone}`} className="flex items-center gap-2 hover:underline"><Phone className="size-4 text-muted-foreground" />{org.phone}</a>}
            {org.email && <a href={`mailto:${org.email}`} className="flex items-center gap-2 break-all hover:underline"><Mail className="size-4 shrink-0 text-muted-foreground" />{org.email}</a>}
            {(org.address1 || org.city) && (
              <div className="flex items-start gap-2"><MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><span>{[org.address1, org.address2].filter(Boolean).join(", ")}{org.address1 && <br />}{[org.city, org.state, org.zipCode].filter(Boolean).join(" ")}</span></div>
            )}
            {org.localOffices && <Row label="Local offices">{org.localOffices}</Row>}
            {!org.website && !org.phone && !org.email && !org.address1 && !org.city && <p className="text-muted-foreground">No company details yet.</p>}
            {org.notes && <p className="whitespace-pre-wrap border-t pt-2 text-muted-foreground">{org.notes}</p>}
          </CardContent>
        </Card>

        {hasProfile && (
          <Card>
            <CardHeader><CardTitle className="text-base">What they expect of a trade partner</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {org.annualVolume && <Row label="Annual volume">{org.annualVolume}</Row>}
              {org.companySize && <Row label="Size">{org.companySize}</Row>}
              {org.projectTypes.length > 0 && <Row label="Project types">{org.projectTypes.join(", ")}</Row>}
              {org.typicalProjectSize && <Row label="Typical project">{org.typicalProjectSize}</Row>}
              {org.biddingPlatform && <Row label="Bids through">{org.biddingPlatform}</Row>}
              {org.prequalPlatform && <Row label="Prequal through">{org.prequalPlatform}</Row>}
              {org.vendorRegistrationUrl && <Row label="Register at"><a href={org.vendorRegistrationUrl} target="_blank" rel="noreferrer" className="break-all hover:underline">{org.vendorRegistrationUrl.replace(/^https?:\/\//, "")}</a></Row>}
              {org.requirementsNotes && <p className="whitespace-pre-wrap border-t pt-2 text-muted-foreground">{org.requirementsNotes}</p>}
            </CardContent>
          </Card>
        )}
      </div>

      <div className="min-w-0 space-y-4 lg:col-span-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">Open follow-ups</CardTitle>
            {permissions.canManage && <Button size="sm" variant="outline" onClick={onLog}><Plus className="mr-1 size-4" /> Log interaction</Button>}
          </CardHeader>
          <CardContent className="p-0">
            {openTasks.length === 0 ? (
              <p className="px-6 pb-4 text-sm text-muted-foreground">Nothing open. Follow-ups appear here when the rules raise one or someone creates one from an interaction.</p>
            ) : (
              <ul className="divide-y">
                {openTasks.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-6 py-2.5 text-sm">
                    <CheckSquare className="size-4 shrink-0 text-muted-foreground" />
                    <Link href={`/tasks?task=${t.id}`} className="min-w-0 flex-1 truncate hover:underline">{t.title}</Link>
                    {t.dueAt && <span className={cn("shrink-0 text-xs", new Date(t.dueAt) < now ? "font-medium text-tone-danger-fg" : "text-muted-foreground")}>{format(new Date(t.dueAt), "MMM d")}</span>}
                    <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{personName(t.assignedTo) ?? "unassigned"}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">Primary contact</CardTitle>
            {permissions.canManage && <Button size="sm" variant="outline" onClick={onAddContact}><Plus className="mr-1 size-4" /> Add contact</Button>}
          </CardHeader>
          <CardContent className="text-sm">
            {primary ? (
              <div className="space-y-1">
                <div className="font-medium">{primary.firstName} {primary.lastName}{primary.title ? <span className="font-normal text-muted-foreground"> · {primary.title}</span> : null}</div>
                <div className="flex flex-wrap gap-3 text-muted-foreground">
                  {(primary.mobile || primary.phone) && <a href={`tel:${primary.mobile || primary.phone}`} className="flex items-center gap-1 hover:underline"><Phone className="size-3.5" />{primary.mobile || primary.phone}</a>}
                  {primary.email && <a href={`mailto:${primary.email}`} className="flex items-center gap-1 break-all hover:underline"><Mail className="size-3.5" />{primary.email}</a>}
                </div>
                <div className="text-xs text-muted-foreground">Last touch {lastTouchLabel(primary.lastContactAt, now)}{org.contacts.filter((c) => c.isActive).length > 1 ? ` · ${org.contacts.filter((c) => c.isActive).length} contacts on the account` : ""}</div>
              </div>
            ) : (
              <p className="text-muted-foreground">No contacts yet. Add the estimator or preconstruction manager you deal with.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Recent activity</CardTitle></CardHeader>
          <CardContent className="p-0">
            {recent.isLoading ? (
              <ListSkeleton rows={3} />
            ) : (recent.data?.rows.length ?? 0) === 0 ? (
              <p className="px-6 pb-4 text-sm text-muted-foreground">Nobody has logged a touch with {org.name} yet.</p>
            ) : (
              <ul className="divide-y">
                {recent.data!.rows.slice(0, 5).map((i) => (
                  <InteractionLine key={i.id} i={i} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="w-28 shrink-0 text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

function ContactsTab({ org, canManage, now, onAdd, onEdit }: { org: OrgDetail["organization"]; canManage: boolean; now: Date; onAdd: () => void; onEdit: (c: Contact) => void }) {
  const invalidate = useInvalidatePartners();
  const { data: options } = usePartnerOptions();
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => fetchJson(`/api/contacts/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });
  const roleLabel = (r: Contact["roleTag"]) => options?.contactRoles.find((x) => x.value === r)?.label ?? r;
  if (org.contacts.length === 0) {
    return <EmptyState icon={Star} title="No contacts yet" description="The estimators, preconstruction managers and executives KNU deals with at this account." action={canManage ? <Button onClick={onAdd}>Add a contact</Button> : undefined} />;
  }
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">People at {org.name}</CardTitle>
        {canManage && <Button size="sm" onClick={onAdd}><Plus className="mr-1 size-4" /> Add contact</Button>}
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="hidden md:table-cell">Role</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead className="hidden md:table-cell">Email</TableHead>
              <TableHead className="hidden lg:table-cell">Rating</TableHead>
              <TableHead className="hidden sm:table-cell">Last touch</TableHead>
              {canManage && <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {org.contacts.map((c) => (
              <TableRow key={c.id} className={c.isActive ? undefined : "opacity-60"}>
                <TableCell>
                  <div className="flex items-center gap-1.5 font-medium">
                    {c.firstName} {c.lastName}
                    {c.isPrimary && <Star className="size-3.5 fill-current text-tone-warning-fg" aria-label="Primary" />}
                    {!c.isActive && <Badge variant="outline" className="text-[10px]">Inactive</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">{[c.title, c.office].filter(Boolean).join(" · ")}</div>
                </TableCell>
                <TableCell className="hidden text-sm md:table-cell">{roleLabel(c.roleTag)}</TableCell>
                <TableCell className="text-sm">
                  {(c.mobile || c.phone) ? <a href={`tel:${c.mobile || c.phone}`} className="hover:underline">{c.mobile || c.phone}</a> : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="hidden text-sm md:table-cell">{c.email ? <a href={`mailto:${c.email}`} className="break-all hover:underline">{c.email}</a> : <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">{[c.relationshipStrength ? `strength ${c.relationshipStrength}/5` : null, c.influence ? `influence ${c.influence}/5` : null].filter(Boolean).join(" · ") || "—"}</TableCell>
                <TableCell className="hidden text-sm sm:table-cell">{lastTouchLabel(c.lastContactAt, now)}</TableCell>
                {canManage && (
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={`Actions for ${c.firstName}`} />}>
                        <MoreHorizontal className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => onEdit(c)}><Pencil className="size-4" /> Edit</DropdownMenuItem>
                        {!c.isPrimary && c.isActive && <DropdownMenuItem onClick={() => patch.mutate({ id: c.id, body: { isPrimary: true } })}><Star className="size-4" /> Make primary</DropdownMenuItem>}
                        <DropdownMenuItem onClick={() => patch.mutate({ id: c.id, body: { isActive: !c.isActive, ...(c.isActive ? { isPrimary: false } : {}) } })}>
                          {c.isActive ? "Mark inactive" : "Mark active"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function ActivityTab({ org, canManage, onEdit, onLog }: { org: OrgDetail["organization"]; canManage: boolean; onEdit: (i: Interaction) => void; onLog: () => void }) {
  const [kind, setKind] = useState<InteractionKind | null>(null);
  const { data, isLoading } = useInteractions(org.id, kind);
  const { data: options } = usePartnerOptions();
  const invalidate = useInvalidatePartners();
  const remove = useMutation({
    mutationFn: (id: string) => fetchJson(`/api/interactions/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      toast.success("Removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const merged = useMemo(() => {
    const items: { at: Date; node: React.ReactNode; key: string }[] = [];
    for (const i of data?.rows ?? []) items.push({ at: new Date(i.occurredAt), key: `i:${i.id}`, node: <InteractionLine i={i} canEdit={canManage} onEdit={() => onEdit(i)} onDelete={() => remove.mutate(i.id)} /> });
    if (!kind) {
      for (const h of org.stageHistory) {
        items.push({
          at: new Date(h.changedAt),
          key: `s:${h.id}`,
          node: (
            <li className="flex items-center gap-3 px-6 py-2 text-xs text-muted-foreground">
              <CalendarClock className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1">
                {h.fromStage ? `${stageDef(h.fromStage).name} → ` : "Added as "}{stageDef(h.toStage).name}
                {h.reason ? ` — ${h.reason}` : ""} · {personName(h.changedBy)}
              </span>
              <span className="shrink-0">{format(new Date(h.changedAt), "MMM d, yyyy")}</span>
            </li>
          ),
        });
      }
    }
    return items.sort((a, b) => b.at.getTime() - a.at.getTime());
  }, [data, org.stageHistory, kind, canManage, onEdit, remove]);

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">Activity</CardTitle>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant={kind ? "outline" : "default"} className="h-7 rounded-full text-xs" onClick={() => setKind(null)}>All</Button>
          {(options?.interactionKinds ?? []).slice(0, 6).map((k) => (
            <Button key={k.value} size="sm" variant={kind === k.value ? "default" : "outline"} className="h-7 rounded-full text-xs" onClick={() => setKind(k.value)}>{k.label}</Button>
          ))}
          {canManage && <Button size="sm" onClick={onLog}><Plus className="mr-1 size-4" /> Log</Button>}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? <ListSkeleton rows={4} /> : merged.length === 0 ? <p className="px-6 pb-4 text-sm text-muted-foreground">Nothing logged yet.</p> : <ul className="divide-y">{merged.map((m) => <li key={m.key} className="list-none">{m.node}</li>)}</ul>}
      </CardContent>
    </Card>
  );
}

function InteractionLine({ i, canEdit, onEdit, onDelete }: { i: Interaction; canEdit?: boolean; onEdit?: () => void; onDelete?: () => void }) {
  const { data: options } = usePartnerOptions();
  const kindLabel = options?.interactionKinds.find((k) => k.value === i.kind)?.label ?? i.kind;
  const outcomeLabel = i.outcome === "NOT_APPLICABLE" ? null : (options?.outcomes.find((o) => o.value === i.outcome)?.label ?? i.outcome);
  const Dir = i.direction === "INBOUND" ? ArrowDownLeft : ArrowUpRight;
  return (
    <div className="flex items-start gap-3 px-6 py-3 text-sm">
      <Dir className={cn("mt-0.5 size-4 shrink-0", i.direction === "INBOUND" ? "text-tone-success-fg" : "text-muted-foreground")} aria-label={i.direction === "INBOUND" ? "They reached out" : "We reached out"} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="font-medium">{kindLabel}</span>
          {i.contact && <span className="text-muted-foreground">with {i.contact.firstName} {i.contact.lastName}</span>}
          {outcomeLabel && <Badge variant="outline" className="text-[11px]">{outcomeLabel}</Badge>}
          {i.lead && <Link href={`/leads/${i.lead.id}`} className="text-xs text-muted-foreground hover:underline">about {i.lead.companyName ?? i.lead.fullName} · {i.lead.propertyAddress1}</Link>}
        </div>
        <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{i.summary}</p>
        <p className="mt-1 text-xs text-muted-foreground" title={format(new Date(i.occurredAt), "PPpp")}>
          {format(new Date(i.occurredAt), "EEE, MMM d, yyyy 'at' h:mm a")} · {formatDistanceToNowStrict(new Date(i.occurredAt), { addSuffix: true })} · {personName(i.user)}
        </p>
      </div>
      {canEdit && onEdit && (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="Interaction actions" />}>
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}><Pencil className="size-4" /> Edit</DropdownMenuItem>
            {onDelete && <DropdownMenuItem onClick={onDelete} className="text-tone-danger-fg"><Trash2 className="size-4" /> Delete</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
