import { format } from "date-fns";
import { ClipboardCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";

export type JobInspection = { id: string; type: string; result: string; scheduledDate: string | null; notes: string | null };

export function InspectionsList({ inspections }: { inspections: JobInspection[] }) {
  if (inspections.length === 0) return <EmptyState icon={ClipboardCheck} title="No inspections yet" description="Inspection results recorded on workflow steps show up here." />;
  return (
    <div className="space-y-2">
      {inspections.map((i) => (
        <Card key={i.id}>
          <CardContent className="flex items-center justify-between py-3 px-4">
            <div className="flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">{i.type}</span>
              <Badge variant={i.result === "PASSED" ? "default" : "outline"} className="text-[10px]">{i.result}</Badge>
            </div>
            {i.scheduledDate && <span className="text-xs text-muted-foreground">{format(new Date(i.scheduledDate), "MMM d, yyyy")}</span>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
