import { Bot, Route } from "lucide-react";

const LABELS: Record<string, string> = {
  estimate: "an estimate being sent",
  invoice: "an invoice being sent",
  "daily-log": "a returned daily log",
  "change-order": "a change order being sent",
};

const WORKFLOW_MODULE_LABEL: Record<string, string> = {
  core: "Core Construction",
  roofing: "Roofing",
  interior_renovation: "Interior Renovation",
  doors_windows: "Doors & Windows",
};

/** "Created automatically from …" for tasks the system raised. */
export function AutoSourceChip({ sourceKey }: { sourceKey: string | null | undefined }) {
  if (!sourceKey) return null;
  const kind = sourceKey.split(":")[0];
  if (kind === "wf") {
    // wf:<instanceId>:<module>:<task>
    const moduleKey = sourceKey.split(":")[2] ?? "";
    const label = WORKFLOW_MODULE_LABEL[moduleKey] ?? moduleKey.replace(/_/g, " ");
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-brand/10 px-1.5 py-0.5 text-[11px] text-brand-fg">
        <Route className="size-3" />
        Created by the {label} workflow
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">
      <Bot className="size-3" />
      Created automatically from {LABELS[kind] ?? "a system event"}
    </span>
  );
}
