import { describe, it, expect } from "vitest";
import {
  calculateGenericEstimate,
  lineTotalOf,
  type GenericEstimateInput,
} from "./generic-calc";

const base = {
  marginPercent: 0,
  discountEnabled: false,
  discountPercent: 0,
  salesTaxPercent: 0,
} satisfies Omit<GenericEstimateInput, "sections">;

function oneSection(
  items: GenericEstimateInput["sections"][number]["items"],
  overrides: Partial<GenericEstimateInput> = {},
): GenericEstimateInput {
  return { ...base, sections: [{ title: "S", items }], ...overrides };
}

describe("calculateGenericEstimate", () => {
  it("line total = quantity × unit price", () => {
    expect(
      lineTotalOf({
        description: "x",
        unitType: "SHEET",
        quantity: 12,
        unitPrice: 15.5,
      }),
    ).toBe(186);
  });

  it("optional items contribute $0", () => {
    const r = calculateGenericEstimate(
      oneSection([
        { description: "a", unitType: "EACH", quantity: 2, unitPrice: 100 },
        {
          description: "note",
          unitType: "LUMP_SUM",
          quantity: 99,
          unitPrice: 99,
          isOptional: true,
        },
      ]),
    );
    expect(r.sections[0].sectionSubtotal).toBe(200);
    expect(r.subtotalCost).toBe(200);
  });

  it("section subtotal and estimate subtotal sum correctly", () => {
    const r = calculateGenericEstimate({
      ...base,
      sections: [
        {
          title: "A",
          items: [
            { description: "a", unitType: "SQ_FT", quantity: 100, unitPrice: 2 },
            { description: "b", unitType: "SQ_FT", quantity: 50, unitPrice: 4 },
          ],
        },
        {
          title: "B",
          items: [
            {
              description: "c",
              unitType: "LABOR_HOUR",
              quantity: 10,
              unitPrice: 75,
            },
          ],
        },
      ],
    });
    expect(r.sections[0].sectionSubtotal).toBe(400);
    expect(r.sections[1].sectionSubtotal).toBe(750);
    expect(r.subtotalCost).toBe(1150);
  });

  it("0% margin → price equals cost", () => {
    const r = calculateGenericEstimate(
      oneSection([
        { description: "a", unitType: "EACH", quantity: 1, unitPrice: 5000 },
      ]),
    );
    expect(r.subtotalCost).toBe(5000);
    expect(r.priceWithMargin).toBe(5000);
    expect(r.totalPrice).toBe(5000);
  });

  it("20% true margin on $10,000 cost → $12,500", () => {
    const r = calculateGenericEstimate(
      oneSection(
        [{ description: "a", unitType: "EACH", quantity: 1, unitPrice: 10000 }],
        { marginPercent: 20 },
      ),
    );
    expect(r.priceWithMargin).toBe(12500);
    expect(r.marginAmount).toBe(2500);
  });

  it("discount applies after margin", () => {
    const r = calculateGenericEstimate(
      oneSection(
        [{ description: "a", unitType: "EACH", quantity: 1, unitPrice: 10000 }],
        { marginPercent: 20, discountEnabled: true, discountPercent: 10 },
      ),
    );
    expect(r.priceWithMargin).toBe(12500);
    expect(r.discountAmount).toBe(1250);
    expect(r.priceAfterDiscount).toBe(11250);
  });

  it("discount ignored when discountEnabled is false", () => {
    const r = calculateGenericEstimate(
      oneSection(
        [{ description: "a", unitType: "EACH", quantity: 1, unitPrice: 10000 }],
        { marginPercent: 20, discountEnabled: false, discountPercent: 10 },
      ),
    );
    expect(r.discountAmount).toBe(0);
    expect(r.priceAfterDiscount).toBe(12500);
  });

  it("sales tax applies after discount", () => {
    const r = calculateGenericEstimate(
      oneSection(
        [{ description: "a", unitType: "EACH", quantity: 1, unitPrice: 10000 }],
        {
          marginPercent: 20,
          discountEnabled: true,
          discountPercent: 10,
          salesTaxPercent: 7,
        },
      ),
    );
    expect(r.priceAfterDiscount).toBe(11250);
    expect(r.salesTaxAmount).toBe(787.5);
    expect(r.totalPrice).toBe(12037.5);
  });

  it("margin clamps below 100% (never divides by zero)", () => {
    const r = calculateGenericEstimate(
      oneSection(
        [{ description: "a", unitType: "EACH", quantity: 1, unitPrice: 100 }],
        { marginPercent: 150 },
      ),
    );
    expect(Number.isFinite(r.totalPrice)).toBe(true);
    expect(r.marginPercent).toBe(99.999);
  });

  it("empty / all-optional sections → totals are 0", () => {
    const empty = calculateGenericEstimate({ ...base, sections: [{ title: "S", items: [] }] });
    expect(empty.subtotalCost).toBe(0);
    expect(empty.totalPrice).toBe(0);

    const allOptional = calculateGenericEstimate(
      oneSection(
        [
          {
            description: "n",
            unitType: "LUMP_SUM",
            quantity: 1,
            unitPrice: 999,
            isOptional: true,
          },
        ],
        { marginPercent: 25 },
      ),
    );
    expect(allOptional.subtotalCost).toBe(0);
    expect(allOptional.priceWithMargin).toBe(0);
    expect(allOptional.totalPrice).toBe(0);
  });
});
