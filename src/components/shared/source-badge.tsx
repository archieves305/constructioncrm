import { Badge } from "@/components/ui/badge";

export function SourceBadge({ source }: { source: string }) {
  return (
    <Badge variant="secondary" className="font-normal">
      {source}
    </Badge>
  );
}
