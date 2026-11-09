import { describe, expect, it } from "vitest";
import { readPermitCreate } from "./create-input";

const ok = (body: unknown) => {
  const r = readPermitCreate(body);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const err = (body: unknown) => {
  const r = readPermitCreate(body);
  return r.ok ? null : r.error;
};

describe("readPermitCreate", () => {
  it("accepts what the permit editor sends", () => {
    const v = ok({ municipality: " City of Miami ", permitType: "BUILDING", permitFee: "125.5", submittedDate: "2026-11-01", status: "APPLIED", notes: "" });
    expect(v.municipality).toBe("City of Miami");
    expect(v.permitFee).toBe("125.50");
    expect(v.submittedDate?.toISOString().slice(0, 10)).toBe("2026-11-01");
    expect(v.notes).toBeNull();
    expect(v.status).toBe("APPLIED");
  });

  it("defaults the status and leaves an unsent submitted date for the route", () => {
    const v = ok({ jurisdictionId: "j1" });
    expect(v.status).toBe("APPLIED");
    expect(v.submittedDate).toBeUndefined();
    expect(v.permitFee).toBeNull();
  });

  it("refuses bad values with the field named", () => {
    expect(err({ municipality: "X", permitFee: "abc" })).toBe("Permit fee must be an amount of zero or more");
    expect(err({ municipality: "X", permitFee: -1 })).toBe("Permit fee must be an amount of zero or more");
    expect(err({ municipality: "X", expirationDate: "tomorrow" })).toBe("Expiration date is not a date");
    expect(err({ municipality: "X", status: "X" })).toBe("Status is not a permit status");
    expect(err({ municipality: "X", notes: { a: 1 } })).toBe("Notes must be text");
    expect(err({ municipality: "X", permitNumber: "9".repeat(201) })).toBe("Permit number must be at most 200 characters");
    expect(err({})).toBe("Choose or type the jurisdiction");
    expect(err(null)).toBe("A JSON body is required");
  });
});
