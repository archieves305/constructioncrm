"use client";

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { CheckCircle2, XCircle } from "lucide-react";

type Band = { min: number; max: number | null; points: number };
type Tier = { min: number; label: string };

type ScoringConfig = {
  roof: {
    maxPoints: number;
    ageBands: Band[];
    unknownAgeBuiltOver20Points: number;
    permitNoneBuilt15PlusBonus: number;
    permitWithin10YearsPenalty: number;
    permitOlderThan15YearsBonus: number;
  };
  financial: { maxPoints: number; equityBands: Band[] };
  conversion: {
    maxPoints: number;
    ownerOccupiedPoints: number;
    absenteePoints: number;
    unknownOccupancyPoints: number;
    ownershipBands: Band[];
  };
  personalization: {
    maxPoints: number;
    ownerNamePoints: number;
    roofTypePoints: number;
    sufficientDetailPoints: number;
  };
  tiers: Tier[];
  highEquityThreshold: number;
};

type Settings = {
  scoringConfig: ScoringConfig;
  minPriorityScore: number;
  showAbsenteeOwners: boolean;
  hideLowScoreProperties: boolean;
  cacheTtlDays: number;
  defaultOpeningScript: string;
  complianceDisclaimer: string;
  propertyApiConfigured: boolean;
};

const bandLabel = (b: Band) =>
  b.max == null ? `${b.min}+` : `${b.min}–${b.max}`;

function NumField({
  value,
  onChange,
  className = "w-20",
}: {
  value: number;
  onChange: (n: number) => void;
  className?: string;
}) {
  return (
    <Input
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className={`h-8 ${className}`}
    />
  );
}

// Edits only the `points` of each band (the band ranges are shown for context).
function BandPoints({
  bands,
  onChange,
}: {
  bands: Band[];
  onChange: (next: Band[]) => void;
}) {
  return (
    <div className="space-y-1.5">
      {bands.map((b, i) => (
        <div key={i} className="flex items-center gap-2 text-sm">
          <span className="w-28 text-muted-foreground">{bandLabel(b)}</span>
          <NumField
            value={b.points}
            onChange={(n) => {
              const next = bands.map((x, j) => (j === i ? { ...x, points: n } : x));
              onChange(next);
            }}
          />
          <span className="text-xs text-muted-foreground">pts</span>
        </div>
      ))}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

export default function CanvassingSettingsPage() {
  const [draft, setDraft] = useState<Settings | null>(null);
  const [loaded, setLoaded] = useState<Settings | undefined>(undefined);

  const { data } = useQuery<Settings>({
    queryKey: ["canvassing-settings"],
    queryFn: async () => {
      const res = await fetch("/api/admin/canvassing-settings");
      if (!res.ok) throw new Error("Failed to load settings");
      return res.json();
    },
  });

  // Seed the editable draft from the loaded settings (React's "adjust state when
  // data changes" during-render pattern — the guard prevents a render loop).
  if (data && data !== loaded) {
    setLoaded(data);
    setDraft(data);
  }

  // Immutable nested update via clone-and-mutate.
  const patchConfig = (fn: (c: ScoringConfig) => void) =>
    setDraft((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      fn(next.scoringConfig);
      return next;
    });

  const patch = (p: Partial<Settings>) =>
    setDraft((prev) => (prev ? { ...prev, ...p } : prev));

  const save = useMutation({
    mutationFn: async () => {
      if (!draft) return;
      // Send only the editable fields (propertyApiConfigured is read-only status).
      const body = {
        scoringConfig: draft.scoringConfig,
        minPriorityScore: draft.minPriorityScore,
        showAbsenteeOwners: draft.showAbsenteeOwners,
        hideLowScoreProperties: draft.hideLowScoreProperties,
        cacheTtlDays: draft.cacheTtlDays,
        defaultOpeningScript: draft.defaultOpeningScript,
        complianceDisclaimer: draft.complianceDisclaimer,
      };
      const res = await fetch("/api/admin/canvassing-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Save failed");
      return res.json();
    },
    onSuccess: () => toast.success("Lead scoring settings saved"),
    onError: () => toast.error("Failed to save — check the values"),
  });

  if (!draft) {
    return <p className="py-10 text-center text-muted-foreground">Loading…</p>;
  }
  const c = draft.scoringConfig;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Canvassing Lead Scoring"
        description="Tune the Knock Score model, visibility, and canvasser scripts"
        actions={
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save changes"}
          </Button>
        }
      />

      {/* Property API status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Property data (RealAPI)</CardTitle>
        </CardHeader>
        <CardContent>
          {draft.propertyApiConfigured ? (
            <Badge className="gap-1 bg-green-100 text-green-800 hover:bg-green-100">
              <CheckCircle2 className="h-3.5 w-3.5" /> Configured
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1 text-amber-700">
              <XCircle className="h-3.5 w-3.5" /> Not configured
            </Badge>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            The property API key is managed in the server environment and is never
            exposed here. Contact an administrator to set or rotate it.
          </p>
        </CardContent>
      </Card>

      {/* Visibility */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Visibility & caching</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Row label="Minimum score to flag as priority">
            <NumField
              value={draft.minPriorityScore}
              onChange={(n) => patch({ minPriorityScore: n })}
            />
          </Row>
          <Row label="Refresh property data after (days)">
            <NumField
              value={draft.cacheTtlDays}
              onChange={(n) => patch({ cacheTtlDays: n })}
            />
          </Row>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={draft.showAbsenteeOwners}
              onCheckedChange={(v) => patch({ showAbsenteeOwners: v === true })}
            />
            Show absentee owners in results
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={draft.hideLowScoreProperties}
              onCheckedChange={(v) => patch({ hideLowScoreProperties: v === true })}
            />
            Hide properties below the minimum priority score
          </label>
        </CardContent>
      </Card>

      {/* Roof */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            A. Roof opportunity ({c.roof.maxPoints} pts)
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          <div>
            <Label className="mb-2 block text-xs uppercase text-muted-foreground">
              Roof age bands (years → points)
            </Label>
            <BandPoints
              bands={c.roof.ageBands}
              onChange={(next) => patchConfig((cfg) => void (cfg.roof.ageBands = next))}
            />
          </div>
          <div className="space-y-2">
            <Row label="Unknown age, built 20+ yrs ago">
              <NumField
                value={c.roof.unknownAgeBuiltOver20Points}
                onChange={(n) => patchConfig((cfg) => void (cfg.roof.unknownAgeBuiltOver20Points = n))}
              />
            </Row>
            <Row label="No permit + built 15+ yrs (bonus)">
              <NumField
                value={c.roof.permitNoneBuilt15PlusBonus}
                onChange={(n) => patchConfig((cfg) => void (cfg.roof.permitNoneBuilt15PlusBonus = n))}
              />
            </Row>
            <Row label="Permit within 10 yrs (penalty)">
              <NumField
                value={c.roof.permitWithin10YearsPenalty}
                onChange={(n) => patchConfig((cfg) => void (cfg.roof.permitWithin10YearsPenalty = n))}
              />
            </Row>
            <Row label="Permit older than 15 yrs (bonus)">
              <NumField
                value={c.roof.permitOlderThan15YearsBonus}
                onChange={(n) => patchConfig((cfg) => void (cfg.roof.permitOlderThan15YearsBonus = n))}
              />
            </Row>
            <Row label="Section max">
              <NumField
                value={c.roof.maxPoints}
                onChange={(n) => patchConfig((cfg) => void (cfg.roof.maxPoints = n))}
              />
            </Row>
          </div>
        </CardContent>
      </Card>

      {/* Financial */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            B. Financial / ability to buy ({c.financial.maxPoints} pts)
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          <div>
            <Label className="mb-2 block text-xs uppercase text-muted-foreground">
              Equity % bands → points
            </Label>
            <BandPoints
              bands={c.financial.equityBands}
              onChange={(next) => patchConfig((cfg) => void (cfg.financial.equityBands = next))}
            />
          </div>
          <div className="space-y-2">
            <Row label="Section max">
              <NumField
                value={c.financial.maxPoints}
                onChange={(n) => patchConfig((cfg) => void (cfg.financial.maxPoints = n))}
              />
            </Row>
            <Row label="High-equity threshold (financing angle)">
              <NumField
                value={c.highEquityThreshold}
                onChange={(n) => patchConfig((cfg) => void (cfg.highEquityThreshold = n))}
              />
            </Row>
          </div>
        </CardContent>
      </Card>

      {/* Conversion */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            C. Conversion ({c.conversion.maxPoints} pts)
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <Row label="Owner occupied">
              <NumField
                value={c.conversion.ownerOccupiedPoints}
                onChange={(n) => patchConfig((cfg) => void (cfg.conversion.ownerOccupiedPoints = n))}
              />
            </Row>
            <Row label="Absentee owner">
              <NumField
                value={c.conversion.absenteePoints}
                onChange={(n) => patchConfig((cfg) => void (cfg.conversion.absenteePoints = n))}
              />
            </Row>
            <Row label="Occupancy unknown">
              <NumField
                value={c.conversion.unknownOccupancyPoints}
                onChange={(n) => patchConfig((cfg) => void (cfg.conversion.unknownOccupancyPoints = n))}
              />
            </Row>
            <Row label="Section max">
              <NumField
                value={c.conversion.maxPoints}
                onChange={(n) => patchConfig((cfg) => void (cfg.conversion.maxPoints = n))}
              />
            </Row>
          </div>
          <div>
            <Label className="mb-2 block text-xs uppercase text-muted-foreground">
              Years owned → points
            </Label>
            <BandPoints
              bands={c.conversion.ownershipBands}
              onChange={(next) => patchConfig((cfg) => void (cfg.conversion.ownershipBands = next))}
            />
          </div>
        </CardContent>
      </Card>

      {/* Personalization */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            D. Personalization ({c.personalization.maxPoints} pts)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 md:max-w-md">
          <Row label="Owner name available">
            <NumField
              value={c.personalization.ownerNamePoints}
              onChange={(n) => patchConfig((cfg) => void (cfg.personalization.ownerNamePoints = n))}
            />
          </Row>
          <Row label="Roof type available">
            <NumField
              value={c.personalization.roofTypePoints}
              onChange={(n) => patchConfig((cfg) => void (cfg.personalization.roofTypePoints = n))}
            />
          </Row>
          <Row label="Sufficient detail for a custom pitch">
            <NumField
              value={c.personalization.sufficientDetailPoints}
              onChange={(n) => patchConfig((cfg) => void (cfg.personalization.sufficientDetailPoints = n))}
            />
          </Row>
          <Row label="Section max">
            <NumField
              value={c.personalization.maxPoints}
              onChange={(n) => patchConfig((cfg) => void (cfg.personalization.maxPoints = n))}
            />
          </Row>
        </CardContent>
      </Card>

      {/* Tiers */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tiers (score ≥ → label)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {c.tiers.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <NumField
                value={t.min}
                onChange={(n) =>
                  patchConfig((cfg) => void (cfg.tiers[i].min = n))
                }
                className="w-20"
              />
              <Input
                value={t.label}
                onChange={(e) =>
                  patchConfig((cfg) => void (cfg.tiers[i].label = e.target.value))
                }
                className="h-8 max-w-xs"
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Scripts */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scripts & compliance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="script">Default opening script</Label>
            <Textarea
              id="script"
              rows={4}
              value={draft.defaultOpeningScript}
              onChange={(e) => patch({ defaultOpeningScript: e.target.value })}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Use [Owner Name] and [Canvasser Name] as placeholders.
            </p>
          </div>
          <Separator />
          <div>
            <Label htmlFor="disclaimer">Compliance disclaimer</Label>
            <Textarea
              id="disclaimer"
              rows={4}
              value={draft.complianceDisclaimer}
              onChange={(e) => patch({ complianceDisclaimer: e.target.value })}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
