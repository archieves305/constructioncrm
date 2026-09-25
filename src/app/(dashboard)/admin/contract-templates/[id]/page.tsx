"use client";

import { useParams, useSearchParams } from "next/navigation";
import { ContractTemplateEditor } from "@/components/customer-contracts/admin/contract-template-editor";

export default function ContractTemplateEditorPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  return <ContractTemplateEditor templateId={id} versionId={searchParams.get("v")} />;
}
