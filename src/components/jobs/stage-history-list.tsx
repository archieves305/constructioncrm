import { format } from "date-fns";
import { History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";

export type StageHistoryRow = {
  id: string;
  fromStage: { name: string } | null;
  toStage: { name: string };
  changedBy: { firstName: string; lastName: string };
  changedAt: string;
};

export function StageHistoryList({ history }: { history: StageHistoryRow[] }) {
  if (history.length === 0) return <EmptyState icon={History} title="No stage changes yet" />;
  return (
    <div className="space-y-2">
      {history.map((h) => (
        <Card key={h.id}>
          <CardContent className="flex items-center justify-between py-3 px-4 text-sm">
            <div className="flex items-center gap-2">
              {h.fromStage && (
                <>
                  <Badge variant="outline" className="text-xs">{h.fromStage.name}</Badge>
                  <span>&rarr;</span>
                </>
              )}
              <Badge variant="outline" className="text-xs">{h.toStage.name}</Badge>
            </div>
            <div className="text-xs text-muted-foreground text-right">
              <div>{format(new Date(h.changedAt), "MMM d, h:mm a")}</div>
              <div>
                {h.changedBy.firstName} {h.changedBy.lastName}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
