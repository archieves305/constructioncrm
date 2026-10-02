import { describe, expect, it } from "vitest";
import { canDeleteFile, fileReadWhere } from "./access";

const file = (over: Partial<{ category: string; uploadedByUserId: string }> = {}) =>
  ({ category: "OTHER", uploadedByUserId: "u-uploader", ...over }) as never;

describe("fileReadWhere", () => {
  it("does not narrow office, marketing or read-only roles", () => {
    for (const role of ["ADMIN", "MANAGER", "OFFICE_STAFF", "READ_ONLY", "MARKETING"]) {
      expect(fileReadWhere({ id: "u1", role: role as never })).toEqual({});
    }
  });

  it("narrows a sales rep and a crew lead to their own uploads, leads, tasks and cases", () => {
    for (const role of ["SALES_REP", "CREW_LEAD"]) {
      const where = fileReadWhere({ id: "u1", role: role as never });
      expect(where.OR).toHaveLength(4);
      expect(where.OR?.[0]).toEqual({ uploadedByUserId: "u1" });
    }
  });
});

describe("canDeleteFile", () => {
  it("lets office roles delete any ordinary file", () => {
    for (const role of ["ADMIN", "MANAGER", "OFFICE_STAFF"]) {
      expect(canDeleteFile({ id: "x", role: role as never }, file()).ok).toBe(true);
    }
  });

  it("lets anyone else delete only what they uploaded", () => {
    expect(canDeleteFile({ id: "u-uploader", role: "SALES_REP" }, file()).ok).toBe(true);
    expect(canDeleteFile({ id: "someone-else", role: "SALES_REP" }, file()).ok).toBe(false);
    expect(canDeleteFile({ id: "someone-else", role: "CREW_LEAD" }, file()).ok).toBe(false);
  });

  it("never lets read-only delete, even their own upload", () => {
    expect(canDeleteFile({ id: "u-uploader", role: "READ_ONLY" }, file()).ok).toBe(false);
  });

  it("refuses a customer contract document for everyone, admins included", () => {
    const verdict = canDeleteFile({ id: "x", role: "ADMIN" }, file({ category: "CUSTOMER_CONTRACT" }));
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toMatch(/Void the contract/);
  });
});
