"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { buildStageToneMap, type StageLike } from "@/lib/ui/stage-colors";

type Stage = StageLike & { id: string };

/**
 * Change a record's stage from a list row: a pill that opens into the stage
 * list, coloured by phase. Shared by the jobs and leads lists.
 */
export function StagePillSelect({
  value,
  stages,
  onChange,
  className,
  disabled,
}: {
  value: string;
  stages: Stage[];
  onChange: (stageId: string) => void;
  className?: string;
  disabled?: boolean;
}) {
  const tones = buildStageToneMap(stages);
  const current = tones.get(value);
  return (
    <Select value={value} onValueChange={(v: string | null) => v && v !== value && onChange(v)} disabled={disabled}>
      <SelectTrigger
        className={cn(
          "h-7 w-[180px] rounded-full border-0 pl-2.5 text-xs font-medium shadow-none",
          current?.pill ?? "bg-gray-100 text-gray-700",
          className,
        )}
      >
        <SelectValue>{(v: string) => stages.find((s) => s.id === v)?.name ?? "—"}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {stages.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            <span className="flex items-center gap-2">
              <span className={cn("size-2 rounded-full", tones.get(s.id)?.dot)} />
              {s.name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
