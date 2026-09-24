import { Bot } from "lucide-react";

const LABELS: Record<string, string> = {
  estimate: "an estimate being sent",
  invoice: "an invoice being sent",
  "daily-log": "a returned daily log",
  "change-order": "a change order being sent",
};

/** "Created automatically from …" for tasks the system raised. */
export function AutoSourceChip({ sourceKey }: { sourceKey: string | null | undefined }) {
  if (!sourceKey) return null;
  const kind = sourceKey.split(":")[0];
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">
      <Bot className="size-3" />
      Created automatically from {LABELS[kind] ?? "a system event"}
    </span>
  );
}
