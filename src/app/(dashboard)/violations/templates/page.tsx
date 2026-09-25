"use client";

import { TemplateLibrary } from "@/components/workflows/template-library";

export default function ViolationTemplatesPage() {
  return <TemplateLibrary kind="VIOLATION" title="Violation Workflow Templates" description="The phase-and-step plan a new case is generated from. Scope toggles (construction, hearing, fines, lien, emergency, appeal) are set at intake." emptyDescription="Run the workflow seed to load the code-violation template." />;
}
