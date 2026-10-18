"use client";

import { use } from "react";
import { TemplateEditor } from "@/components/permit-intel/forms/template-editor";

/** One permit form template: its fields, their mapping, publishing. */
export default function PermitFormPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <TemplateEditor id={id} />;
}
