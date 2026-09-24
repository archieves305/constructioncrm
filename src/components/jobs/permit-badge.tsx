import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toneClasses, type Tone } from "@/lib/ui/tones";

const TONE: Record<string, Tone> = {
  APPROVED: "success",
  ISSUED: "success",
  SUBMITTED: "info",
  PENDING: "info",
  CORRECTIONS: "warning",
  CORRECTIONS_NEEDED: "warning",
  REJECTED: "danger",
  EXPIRED: "danger",
};

function label(status: string): string {
  return status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " ");
}

export function PermitBadge({ status, className }: { status: string | null | undefined; className?: string }) {
  if (!status) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <Badge variant="outline" className={cn("border-0 text-[11px]", toneClasses(TONE[status] ?? "neutral").pill, className)}>
      {label(status)}
    </Badge>
  );
}
