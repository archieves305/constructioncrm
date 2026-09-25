"use client";

import { useState } from "react";
import Link from "next/link";
import { FileSignature, Plus, Star } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Callout } from "@/components/shared/callout";
import { useSession } from "@/lib/auth/session-client";
import { useContractTemplates, useCreateContractTemplate, useUpdateContractTemplate, type AdminTemplateRow } from "@/components/customer-contracts/use-contract-templates";

export default function ContractTemplatesPage() {
  const { data: session } = useSession();
  const isAdmin = session?.user.role === "ADMIN";
  const { data: templates = [], isLoading, error } = useContractTemplates();
  const [creating, setCreating] = useState(false);

  return (
    <div>
      <PageHeader
        title="Contract Templates"
        description="The customer agreement text. A contract pins the published version it was generated from; editing means publishing a new version."
        actions={
          isAdmin ? (
            <Button variant="brand" onClick={() => setCreating(true)}>
              <Plus className="size-4" /> New template
            </Button>
          ) : undefined
        }
      />
      <NewTemplateDialog open={creating} onOpenChange={setCreating} />
      {error ? (
        <Callout tone="danger" title="Couldn't load the templates">{error instanceof Error ? error.message : "Something went wrong."}</Callout>
      ) : isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : templates.length === 0 ? (
        <EmptyState icon={FileSignature} title="No templates yet" description="Create one to start generating customer contracts." action={isAdmin ? <Button variant="brand" onClick={() => setCreating(true)}>New template</Button> : undefined} />
      ) : (
        <div className="space-y-3">
          {templates.map((t) => (
            <TemplateCard key={t.id} template={t} isAdmin={isAdmin} />
          ))}
        </div>
      )}
    </div>
  );
}

function TemplateCard({ template: t, isAdmin }: { template: AdminTemplateRow; isAdmin: boolean }) {
  const update = useUpdateContractTemplate(t.id);
  const published = t.versions.find((v) => v.status === "PUBLISHED");
  const draft = t.versions.find((v) => v.status === "DRAFT");
  const used = t.versions.reduce((s, v) => s + v._count.contracts, 0);
  return (
    <Card className={!t.isActive ? "opacity-60" : undefined}>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/admin/contract-templates/${t.id}`} className="font-medium hover:underline">
              {t.name}
            </Link>
            <span className="font-mono text-xs text-muted-foreground">{t.key}</span>
            {t.isDefault && (
              <Badge className="bg-tone-success-soft text-tone-success-fg">
                <Star className="mr-1 size-3" /> Default
              </Badge>
            )}
            {published ? <Badge variant="outline">v{published.version} published</Badge> : <Badge className="bg-tone-warning-soft text-tone-warning-fg">Nothing published</Badge>}
            {draft && <Badge className="bg-tone-info-soft text-tone-info-fg">v{draft.version} draft</Badge>}
            {!t.isActive && <Badge variant="outline">Inactive</Badge>}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {t.description || "No description"} · used by {used} contract{used === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && !t.isDefault && published && t.isActive && (
            <Button size="sm" variant="ghost" disabled={update.isPending} onClick={() => update.mutate({ isDefault: true })}>
              Set as default
            </Button>
          )}
          <Link href={`/admin/contract-templates/${t.id}`} className={buttonVariants({ size: "sm", variant: "outline" })}>
            Open
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function NewTemplateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const create = useCreateContractTemplate();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^[0-9]/, "t$&");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New contract template</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div>
            <Label className="text-xs">Name</Label>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!key || key === slug(name)) setKey(slug(e.target.value));
              }}
              placeholder="Commercial Roofing Agreement"
            />
          </div>
          <div>
            <Label className="text-xs">Key</Label>
            <Input value={key} onChange={(e) => setKey(slug(e.target.value))} className="font-mono" />
          </div>
          <div>
            <Label className="text-xs">Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <p className="text-xs text-muted-foreground">The template starts with an empty draft. Add articles, then publish it before generating contracts from it.</p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              variant="brand"
              disabled={!name.trim() || !key || create.isPending}
              onClick={() =>
                create.mutate(
                  { name: name.trim(), key, description: description.trim() || null },
                  {
                    onSuccess: () => {
                      onOpenChange(false);
                      setName("");
                      setKey("");
                      setDescription("");
                    },
                  },
                )
              }
            >
              Create
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
