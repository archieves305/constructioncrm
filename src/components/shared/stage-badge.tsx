import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { stageTone, type StageLike } from "@/lib/ui/stage-colors";

/**
 * A stage as a tinted pill, coloured by where it sits in the pipeline.
 * Pass the full stage list so the phase can be worked out; without it the
 * pill is neutral rather than wrong.
 */
export function StageBadge({
  stage,
  stages,
  className,
}: {
  stage: StageLike | string;
  stages?: StageLike[];
  className?: string;
}) {
  const tone = stageTone(stage, stages);
  const name = typeof stage === "string" ? stage : stage.name;
  return (
    <Badge variant="outline" className={cn("border-0 font-medium", tone.pill, className)}>
      {name}
    </Badge>
  );
}
