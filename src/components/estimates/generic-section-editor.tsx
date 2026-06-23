"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Copy, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import { GenericLineItemRow } from "@/components/estimates/generic-line-item-row";
import {
  type FormSection,
  type FormItem,
  uid,
  emptyItem,
  num,
  money,
} from "@/components/estimates/generic-estimate-types";
import { lineTotalOf } from "@/lib/estimates/generic-calc";

function sectionSubtotal(section: FormSection): number {
  return section.items.reduce(
    (sum, i) =>
      sum +
      lineTotalOf({
        description: i.description,
        unitType: i.unitType,
        quantity: num(i.quantity),
        unitPrice: num(i.unitPrice),
        isOptional: i.isOptional,
      }),
    0,
  );
}

export function GenericSectionEditor({
  sections,
  onChange,
}: {
  sections: FormSection[];
  onChange: (next: FormSection[]) => void;
}) {
  function updateSection(idx: number, next: FormSection) {
    onChange(sections.map((s, i) => (i === idx ? next : s)));
  }

  function moveSection(idx: number, dir: -1 | 1) {
    const j = idx + dir;
    if (j < 0 || j >= sections.length) return;
    const copy = [...sections];
    [copy[idx], copy[j]] = [copy[j], copy[idx]];
    onChange(copy);
  }

  function deleteSection(idx: number) {
    onChange(sections.filter((_, i) => i !== idx));
  }

  function duplicateSection(idx: number) {
    const src = sections[idx];
    const clone: FormSection = {
      uid: uid(),
      title: `${src.title} (copy)`,
      items: src.items.map((it) => ({ ...it, uid: uid() })),
    };
    const copy = [...sections];
    copy.splice(idx + 1, 0, clone);
    onChange(copy);
  }

  function addSection() {
    onChange([
      ...sections,
      { uid: uid(), title: "New section", items: [emptyItem()] },
    ]);
  }

  function updateItems(sIdx: number, items: FormItem[]) {
    updateSection(sIdx, { ...sections[sIdx], items });
  }

  return (
    <div className="space-y-3">
      {sections.map((section, sIdx) => (
        <Card key={section.uid}>
          <CardContent className="space-y-3 py-3 px-3">
            <div className="flex items-center gap-2">
              <Input
                value={section.title}
                onChange={(e) =>
                  updateSection(sIdx, { ...section, title: e.target.value })
                }
                className="font-medium"
                placeholder="Section title"
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={() => moveSection(sIdx, -1)}
                disabled={sIdx === 0}
                title="Move section up"
              >
                <ChevronUp className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={() => moveSection(sIdx, 1)}
                disabled={sIdx === sections.length - 1}
                title="Move section down"
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={() => duplicateSection(sIdx)}
                title="Duplicate section (e.g. per room)"
              >
                <Copy className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-destructive"
                onClick={() => deleteSection(sIdx)}
                disabled={sections.length === 1}
                title="Delete section"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-2">
              {section.items.map((item, iIdx) => (
                <GenericLineItemRow
                  key={item.uid}
                  item={item}
                  isFirst={iIdx === 0}
                  isLast={iIdx === section.items.length - 1}
                  onChange={(next) =>
                    updateItems(
                      sIdx,
                      section.items.map((it, i) => (i === iIdx ? next : it)),
                    )
                  }
                  onDelete={() =>
                    updateItems(
                      sIdx,
                      section.items.filter((_, i) => i !== iIdx),
                    )
                  }
                  onDuplicate={() => {
                    const copy = [...section.items];
                    copy.splice(iIdx + 1, 0, { ...item, uid: uid() });
                    updateItems(sIdx, copy);
                  }}
                  onMoveUp={() => {
                    if (iIdx === 0) return;
                    const copy = [...section.items];
                    [copy[iIdx - 1], copy[iIdx]] = [copy[iIdx], copy[iIdx - 1]];
                    updateItems(sIdx, copy);
                  }}
                  onMoveDown={() => {
                    if (iIdx === section.items.length - 1) return;
                    const copy = [...section.items];
                    [copy[iIdx + 1], copy[iIdx]] = [copy[iIdx], copy[iIdx + 1]];
                    updateItems(sIdx, copy);
                  }}
                />
              ))}
            </div>

            <div className="flex items-center justify-between">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  updateItems(sIdx, [...section.items, emptyItem()])
                }
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                Add line item
              </Button>
              <span className="text-sm text-muted-foreground">
                Subtotal:{" "}
                <span className="font-medium text-foreground">
                  {money(sectionSubtotal(section))}
                </span>
              </span>
            </div>
          </CardContent>
        </Card>
      ))}

      <Button type="button" variant="secondary" onClick={addSection}>
        <Plus className="mr-1 h-4 w-4" />
        Add section
      </Button>
    </div>
  );
}
