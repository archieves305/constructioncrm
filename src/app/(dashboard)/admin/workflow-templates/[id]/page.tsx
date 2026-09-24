"use client";

import { useParams, useSearchParams } from "next/navigation";
import { TemplateEditor } from "@/components/workflows/template-editor";

export default function WorkflowTemplateEditorPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  return <TemplateEditor templateId={id} versionId={searchParams.get("v")} />;
}
