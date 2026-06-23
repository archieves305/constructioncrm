"use client";

import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Copy, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import type { EstimateUnitType } from "@/generated/prisma/enums";
import { UNIT_LABELS, lineTotalOf } from "@/lib/estimates/generic-calc";
import {
  type FormItem,
  num,
  money,
} from "@/components/estimates/generic-estimate-types";

const UNIT_OPTIONS = Object.entries(UNIT_LABELS) as [EstimateUnitType, string][];

export function GenericLineItemRow({
  item,
  onChange,
  onDelete,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: {
  item: FormItem;
  onChange: (next: FormItem) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const lineTotal = lineTotalOf({
    description: item.description,
    unitType: item.unitType,
    quantity: num(item.quantity),
    unitPrice: num(item.unitPrice),
    isOptional: item.isOptional,
  });

  return (
    <div className="rounded-md border p-2 space-y-2">
      <div className="grid grid-cols-12 gap-2 items-center">
        <div className="col-span-12 sm:col-span-5">
          <Input
            placeholder="Description"
            value={item.description}
            onChange={(e) => onChange({ ...item, description: e.target.value })}
          />
        </div>
        <div className="col-span-4 sm:col-span-2">
          <Select
            value={item.unitType}
            onValueChange={(v) =>
              onChange({ ...item, unitType: v as EstimateUnitType })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {UNIT_OPTIONS.map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-4 sm:col-span-2">
          <Input
            type="number"
            inputMode="decimal"
            placeholder="Qty"
            value={item.quantity}
            disabled={item.isOptional}
            onChange={(e) => onChange({ ...item, quantity: e.target.value })}
          />
        </div>
        <div className="col-span-4 sm:col-span-3">
          <Input
            type="number"
            inputMode="decimal"
            placeholder="Unit price"
            value={item.unitPrice}
            disabled={item.isOptional}
            onChange={(e) => onChange({ ...item, unitPrice: e.target.value })}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Checkbox
            checked={item.isOptional}
            onCheckedChange={(c) =>
              onChange({ ...item, isOptional: c === true })
            }
          />
          Optional / informational (excluded from total)
        </label>
        <div className="text-sm font-medium">
          {item.isOptional ? "—" : money(lineTotal)}
        </div>
      </div>

      <Input
        placeholder="Notes (optional)"
        value={item.notes}
        onChange={(e) => onChange({ ...item, notes: e.target.value })}
        className="text-xs"
      />

      <div className="flex items-center gap-1">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={onMoveUp}
          disabled={isFirst}
          title="Move up"
        >
          <ChevronUp className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={onMoveDown}
          disabled={isLast}
          title="Move down"
        >
          <ChevronDown className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={onDuplicate}
          title="Duplicate line"
        >
          <Copy className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-destructive"
          onClick={onDelete}
          title="Delete line"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
