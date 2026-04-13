import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const stageColors: Record<string, string> = {
  "New Lead": "bg-blue-100 text-blue-800",
  "Contact Attempted": "bg-yellow-100 text-yellow-800",
  "Contacted": "bg-indigo-100 text-indigo-800",
  "Appointment Scheduled": "bg-purple-100 text-purple-800",
  "Inspection Completed": "bg-teal-100 text-teal-800",
  "Estimate Sent": "bg-orange-100 text-orange-800",
  "Follow-Up Needed": "bg-amber-100 text-amber-800",
  "Negotiation": "bg-cyan-100 text-cyan-800",
  "Won": "bg-green-100 text-green-800",
  "Lost": "bg-red-100 text-red-800",
  "On Hold": "bg-gray-100 text-gray-800",
};

export function StageBadge({ stage }: { stage: string }) {
  return (
    <Badge
      variant="outline"
      className={cn("border-0 font-medium", stageColors[stage] || "bg-gray-100 text-gray-800")}
    >
      {stage}
    </Badge>
  );
}
