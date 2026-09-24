import { describe, expect, it } from "vitest";
import { canRemoveChangeOrderSovLine, changeOrderSovDescription, changeOrderSovLine } from "./sov";

describe("changeOrderSovLine", () => {
  it("continues item numbers and sort order after the existing schedule", () => {
    const line = changeOrderSovLine(
      { number: 2, title: "Add fire-rated corridor ceiling", customerPrice: "12500.5" },
      [
        { itemNo: 1, sortOrder: 0 },
        { itemNo: 3, sortOrder: 4 },
      ],
    );
    expect(line).toEqual({ itemNo: 4, sortOrder: 5, description: "CO-2: Add fire-rated corridor ceiling", scheduledValue: 12500.5 });
  });

  it("works on an empty schedule and rounds to cents", () => {
    expect(changeOrderSovLine({ number: 1, title: null, customerPrice: 1000.005 }, [])).toEqual({
      itemNo: 1,
      sortOrder: 0,
      description: "Change order CO-1",
      scheduledValue: 1000.01,
    });
  });

  it("refuses a change order with no positive price", () => {
    expect(() => changeOrderSovLine({ number: 3, title: "x", customerPrice: 0 }, [])).toThrow(/CO-3/);
    expect(() => changeOrderSovLine({ number: 3, title: "x", customerPrice: "abc" }, [])).toThrow();
  });
});

describe("changeOrderSovDescription", () => {
  it("uses the title when there is one", () => {
    expect(changeOrderSovDescription({ number: 7, title: "  Extra soffit  " })).toBe("CO-7: Extra soffit");
    expect(changeOrderSovDescription({ number: 7, title: "   " })).toBe("Change order CO-7");
  });
});

describe("canRemoveChangeOrderSovLine", () => {
  it("only while nothing has been billed on it", () => {
    expect(canRemoveChangeOrderSovLine(0)).toBe(true);
    expect(canRemoveChangeOrderSovLine(1)).toBe(false);
  });
});
