"use client";

import { TemplateLibrary } from "@/components/workflows/template-library";

/** Every template — Core, the trades and the violation template — with its outline. */
export default function WorkflowTemplatesPage() {
  return <TemplateLibrary title="Workflow Templates" description="Reusable phase-and-step plans. Applying one to a job or a code-violation case generates its tasks." emptyDescription="Run the workflow seed to load Core Construction, the three trade templates and the code-violation template." />;
}
