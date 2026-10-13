"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { FileText, FolderLock, Lock, Paperclip } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { ListSkeleton } from "@/components/shared/list-skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { REQUIREMENT_STATE_LABEL } from "@/lib/partners/qualification-state";
import { CONFIDENTIALITY_LABEL } from "@/lib/partners/vault-access";
import { VaultPreviewDialog } from "./vault-preview-dialog";
import { useQualifications, useVault, type DocumentView } from "./use-partners";

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : null);

/** The vault documents this account's qualifications reference, with the vault's current version beside each. */
export function OrgDocumentsTab({ organizationId, organizationName }: { organizationId: string; organizationName: string }) {
  const quals = useQualifications(organizationId);
  const vault = useVault();
  const [preview, setPreview] = useState<DocumentView | null>(null);
  const rows = useMemo(() => {
    const byDoc = new Map<string, { doc: DocumentView; where: string[]; states: string[] }>();
    for (const q of quals.data?.qualifications ?? []) {
      for (const r of q.requirements) {
        if (!r.companyDocument) continue;
        const doc = vault.data?.types.flatMap((t) => t.versions).find((d) => d.id === r.companyDocument!.id);
        if (!doc) continue;
        const entry = byDoc.get(doc.id) ?? { doc, where: [], states: [] };
        entry.where.push(q.platform || "Prequalification");
        entry.states.push(REQUIREMENT_STATE_LABEL[r.state]);
        byDoc.set(doc.id, entry);
      }
    }
    return [...byDoc.values()];
  }, [quals.data, vault.data]);

  if (quals.isLoading || vault.isLoading) return <ListSkeleton rows={4} />;
  if (rows.length === 0) {
    return <EmptyState icon={FolderLock} title="No documents sent yet" description={`Documents appear here once they are attached to ${organizationName}'s qualification checklist. The vault holds the masters.`} action={<Button variant="outline" nativeButton={false} render={<Link href="/partners/vault" />}>Open the vault</Button>} />;
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Documents sent to {organizationName}</CardTitle>
        <p className="text-sm text-muted-foreground">Each is a version from the vault; a newer version in the vault is flagged on the Qualification tab.</p>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y border-t">
          {rows.map(({ doc, where, states }) => (
            <li key={doc.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
              <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {doc.locked ? <span className="inline-flex items-center gap-1 font-medium"><Lock className="size-3.5" /> {doc.title}</span> : <button type="button" className="font-medium hover:underline" onClick={() => setPreview(doc)}>{doc.title}</button>}
                  <span className="font-mono text-[11px] text-muted-foreground">v{doc.version}</span>
                  <span className="text-xs text-muted-foreground">{CONFIDENTIALITY_LABEL[doc.confidentiality]}</span>
                  {!doc.current && <span className="text-xs font-medium text-tone-warning-fg">superseded in the vault</span>}
                </div>
                <div className="text-xs text-muted-foreground">
                  {doc.documentType.name} · {where.join(", ")} · {states.join(", ")}{doc.expiresAt ? ` · expires ${day(doc.expiresAt)}` : ""}
                </div>
                {!doc.locked && (
                  <a href={`/api/company-documents/${doc.id}/file?download=1`} className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline"><Paperclip className="size-3" /> {doc.fileName}</a>
                )}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
      <VaultPreviewDialog doc={preview} onClose={() => setPreview(null)} />
    </Card>
  );
}
