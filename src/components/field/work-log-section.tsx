"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, CloudSun, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NarrativeDraft } from "@/hooks/use-log-narrative";

// Collapsed-by-exception narrative cards: empty topics are single tappable
// rows; anything with content stays expanded. Chips first, typing last.

type SectionDef = {
  key: keyof NarrativeDraft;
  label: string;
  placeholder: string;
  chips?: string[];
};

const SECTIONS: SectionDef[] = [
  {
    key: "workPerformed",
    label: "Work performed today",
    placeholder: "What got done today?",
    chips: ["Demo", "Framing", "Drywall", "Paint", "Flooring", "Roofing", "Punch list", "Cleanup"],
  },
  {
    key: "areasWorked",
    label: "Areas worked",
    placeholder: "Floors, units, rooms…",
  },
  {
    key: "materialsDelivered",
    label: "Materials delivered",
    placeholder: "One per line: material, qty, supplier",
  },
  {
    key: "equipmentUsed",
    label: "Equipment used",
    placeholder: "One per line",
    chips: ["Lift", "Scaffolding", "Compressor", "Generator", "Dumpster swap"],
  },
  {
    key: "subcontractorsOnsite",
    label: "Subcontractors onsite",
    placeholder: "Company + headcount, one per line",
  },
  {
    key: "inspectionsNotes",
    label: "Inspections",
    placeholder: "Inspections scheduled, passed, or failed today",
  },
  {
    key: "delays",
    label: "Delays",
    placeholder: "Cause and hours lost — leave empty for no delays",
    chips: ["Weather", "Material delay", "Inspection wait", "Owner decision", "Labor short"],
  },
  {
    key: "safetyIssues",
    label: "Safety",
    placeholder: "Incidents, near-misses, corrections — leave empty if none",
  },
  {
    key: "changeOrderItems",
    label: "Change-order items observed",
    placeholder: "Out-of-scope work spotted today",
  },
  {
    key: "ownerInstructions",
    label: "Owner / client instructions",
    placeholder: "Anything the owner asked for onsite",
  },
  {
    key: "officeFollowUps",
    label: "Office follow-ups needed",
    placeholder: "One per line — what the office needs to handle",
  },
  {
    key: "tomorrowPlan",
    label: "Plan for tomorrow",
    placeholder: "Work planned, crew expected",
  },
  {
    key: "notes",
    label: "General notes",
    placeholder: "Anything else worth recording",
  },
];

export function WorkLogSection({
  jobId,
  date,
  draft,
  set,
  editable,
}: {
  jobId: string;
  date: string;
  draft: NarrativeDraft;
  set: (patch: Partial<NarrativeDraft>) => void;
  editable: boolean;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());

  const weather = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}/daily-logs/${date}/weather`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Weather unavailable");
      return body as Partial<NarrativeDraft>;
    },
    onSuccess: (data) => {
      set(data);
      toast.success("Weather filled in");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const weatherText = [
    draft.weatherSummary,
    draft.weatherTempHighF != null && draft.weatherTempLowF != null
      ? `${draft.weatherTempLowF}–${draft.weatherTempHighF}°F`
      : null,
    draft.weatherWindMph != null ? `wind ${draft.weatherWindMph} mph` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-2">
      {/* Weather */}
      <Card>
        <CardContent className="flex items-center gap-3 py-3">
          <CloudSun className="h-5 w-5 shrink-0 text-blue-500" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">Weather</div>
            {weatherText ? (
              <div className="text-muted-foreground text-sm">{weatherText}</div>
            ) : (
              <input
                type="text"
                placeholder="e.g. Clear, 90°F"
                className="text-muted-foreground w-full bg-transparent outline-none"
                style={{ fontSize: 16 }}
                disabled={!editable}
                value={draft.weatherSummary ?? ""}
                onChange={(e) =>
                  set({ weatherSummary: e.target.value || null, weatherSource: "manual" })
                }
              />
            )}
          </div>
          {weatherText && editable && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                set({
                  weatherSummary: null,
                  weatherTempHighF: null,
                  weatherTempLowF: null,
                  weatherPrecipIn: null,
                  weatherWindMph: null,
                  weatherSource: null,
                })
              }
            >
              Clear
            </Button>
          )}
          {editable && (
            <Button
              variant="outline"
              size="sm"
              className="h-10"
              disabled={weather.isPending}
              onClick={() => weather.mutate()}
            >
              {weather.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Auto-fill"
              )}
            </Button>
          )}
        </CardContent>
      </Card>

      {SECTIONS.map((section) => {
        const value = draft[section.key];
        const text = typeof value === "string" ? value : "";
        const isOpen = open.has(section.key) || Boolean(text);
        return (
          <Card key={section.key}>
            <CardContent className="p-0">
              <button
                type="button"
                className="flex min-h-[52px] w-full items-center gap-2 px-4 py-2 text-left"
                onClick={() =>
                  setOpen((prev) => {
                    const next = new Set(prev);
                    if (next.has(section.key)) next.delete(section.key);
                    else next.add(section.key);
                    return next;
                  })
                }
              >
                {isOpen ? (
                  <ChevronDown className="text-muted-foreground h-4 w-4 shrink-0" />
                ) : (
                  <ChevronRight className="text-muted-foreground h-4 w-4 shrink-0" />
                )}
                <span className="flex-1 text-sm font-medium">{section.label}</span>
                {!isOpen && (
                  <span className="text-muted-foreground text-xs">
                    {section.key === "delays" || section.key === "safetyIssues"
                      ? "None"
                      : "Add"}
                  </span>
                )}
              </button>
              {isOpen && (
                <div className="space-y-2 px-4 pb-3">
                  {section.chips && editable && (
                    <div className="flex flex-wrap gap-1.5">
                      {section.chips.map((chip) => (
                        <Button
                          key={chip}
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-9"
                          onClick={() =>
                            set({
                              [section.key]: text ? `${text}\n${chip}` : chip,
                            } as Partial<NarrativeDraft>)
                          }
                        >
                          {chip}
                        </Button>
                      ))}
                    </div>
                  )}
                  <Textarea
                    rows={3}
                    placeholder={section.placeholder}
                    value={text}
                    disabled={!editable}
                    onChange={(e) =>
                      set({ [section.key]: e.target.value || null } as Partial<NarrativeDraft>)
                    }
                    className={cn("resize-y")}
                    style={{ fontSize: 16 }}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
