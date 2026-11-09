import { StatusBadge } from "@/components/shared/status-badge";

/** A job's permit status on lists and boards — the shared status registry's wording and tone. */
export function PermitBadge({ status, className }: { status: string | null | undefined; className?: string }) {
  return <StatusBadge kind="permit" value={status} className={className} />;
}
