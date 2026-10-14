"use client";

import { Badge } from "@/components/ui/badge";
import type { OrgBadge } from "@/lib/partners/derive";
import { stageDef } from "@/lib/partners/stages";
import { buildStageToneMap } from "@/lib/ui/stage-colors";
import { toneClasses } from "@/lib/ui/tones";
import { cn } from "@/lib/utils";
import { stagesAsStageLike } from "@/lib/partners/stages";
import { HEALTH_BAND_LABEL, HEALTH_BAND_TONE, type HealthBand, type PartnerStage } from "./use-partners";

const STAGE_LIKE = stagesAsStageLike();
const TONES = buildStageToneMap(STAGE_LIKE);

/** The relationship stage as a tinted pill, coloured by phase like the lead and job stages. */
export function PartnerStageBadge({ stage, className }: { stage: PartnerStage; className?: string }) {
  const tone = TONES.get(stage);
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", tone?.pill ?? "bg-gray-100 text-gray-700", className)}>{stageDef(stage).name}</span>;
}

/** The derived facts about an account (quiet, prequalified, bidding…), most urgent first. */
export function OrgBadges({ badges, max = 3, className }: { badges: OrgBadge[]; max?: number; className?: string }) {
  if (badges.length === 0) return null;
  const shown = badges.slice(0, max);
  return (
    <span className={cn("flex flex-wrap items-center gap-1", className)}>
      {shown.map((b) => (
        <Badge key={b.key} variant="outline" className={cn("border-0 text-[11px]", toneClasses(b.tone).pill)}>
          {b.label}
        </Badge>
      ))}
      {badges.length > shown.length && <span className="text-[11px] text-muted-foreground">+{badges.length - shown.length}</span>}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: "A" | "B" | "C" | null }) {
  if (!priority) return null;
  const cls = priority === "A" ? toneClasses("danger").pill : priority === "B" ? toneClasses("warning").pill : toneClasses("neutral").pill;
  return <span className={cn("inline-flex size-5 items-center justify-center rounded-full text-[11px] font-semibold", cls)} title={`Priority ${priority}`}>{priority}</span>;
}

/** Health as a pill: the score and its band, with the top strength and weakness on hover. */
export function HealthPill({ health, className }: { health: { score: number; band: HealthBand; strength?: string | null; weakness?: string | null } | null | undefined; className?: string }) {
  if (!health) return <span className="text-xs text-muted-foreground">—</span>;
  const title = [health.strength && `+ ${health.strength}`, health.weakness && `− ${health.weakness}`].filter(Boolean).join("\n") || undefined;
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums", toneClasses(HEALTH_BAND_TONE[health.band]).pill, className)}>
      {health.score}
      <span className="font-normal">· {HEALTH_BAND_LABEL[health.band]}</span>
    </span>
  );
}
