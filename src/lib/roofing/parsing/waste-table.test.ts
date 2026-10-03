import { describe, expect, it } from "vitest";
import { recommendedWasteFromItems, type PositionedText } from "./waste-table";

/** A waste row laid out as Roofr prints it: a label, then options 60 units apart, each about 20 wide. */
function page(options: string[], recommendedIndex: number | null, extra: PositionedText[] = []): PositionedText[] {
  const rowY = 300;
  const items: PositionedText[] = [{ str: "Waste %", x: 40, y: rowY, width: 44 }];
  options.forEach((o, i) => items.push({ str: o, x: 130 + i * 60, y: rowY, width: 20 }));
  if (recommendedIndex !== null) items.push({ str: "Recommended", x: 130 + recommendedIndex * 60 + 10 - 32, y: rowY + 14, width: 64 });
  return [...items, ...extra];
}

describe("recommendedWasteFromItems", () => {
  it("reads the option the word Recommended sits above", () => {
    expect(recommendedWasteFromItems(page(["0%", "6%", "10%", "12%", "15%", "17%", "20%"], 1))).toEqual({
      recommendedPct: 0.06,
      options: [0, 0.06, 0.1, 0.12, 0.15, 0.17, 0.2],
    });
  });

  it("is not a fixed column: the last on a small or complex roof, the first on an all-flat one, the fourth elsewhere", () => {
    expect(recommendedWasteFromItems(page(["10%", "12%", "15%", "17%", "20%", "22%", "35%"], 6))?.recommendedPct).toBe(0.35);
    expect(recommendedWasteFromItems(page(["0%", "10%", "12%", "15%", "17%", "20%", "22%"], 0))?.recommendedPct).toBe(0);
    expect(recommendedWasteFromItems(page(["0%", "10%", "12%", "14%", "15%", "17%", "20%"], 3))?.recommendedPct).toBe(0.14);
  });

  it("tells apart two reports with the same options and a different recommendation", () => {
    const options = ["0%", "10%", "12%", "15%", "17%", "20%", "22%"];
    expect(recommendedWasteFromItems(page(options, 1))?.recommendedPct).toBe(0.1);
    expect(recommendedWasteFromItems(page(options, 0))?.recommendedPct).toBe(0);
  });

  it("ignores other percentages on the page and the material table's Waste (10%) headers", () => {
    const noise: PositionedText[] = [
      { str: "Waste (10%)", x: 300, y: 120, width: 60 },
      { str: "15%", x: 400, y: 500, width: 20 },
      { str: "Recommended waste is based on an asphalt shingle roof", x: 40, y: 250, width: 400 },
    ];
    expect(recommendedWasteFromItems(page(["0%", "8%", "10%", "12%"], 1, noise))?.recommendedPct).toBe(0.08);
  });

  it("says nothing when there is no table, no marker, or the marker is over no column", () => {
    expect(recommendedWasteFromItems([{ str: "Total roof area 2,925 sqft", x: 40, y: 600, width: 200 }])).toBeNull();
    expect(recommendedWasteFromItems(page(["0%", "6%", "10%"], null))).toBeNull();
    const adrift = page(["0%", "6%", "10%"], null, [{ str: "Recommended", x: 520, y: 314, width: 64 }]);
    expect(recommendedWasteFromItems(adrift)).toBeNull();
  });
});
