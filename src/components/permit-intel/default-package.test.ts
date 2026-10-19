import { describe, expect, it } from "vitest";
import { defaultPackage } from "./permit-cycles";

describe("the default package", () => {
  const f = (id: string, permitDocType: string | null, fileName: string, o: { permitLock?: string | null; createdAt?: string } = {}) => ({ id, permitDocType, fileName, permitLock: o.permitLock ?? null, createdAt: o.createdAt ?? "2026-10-18T12:00:00Z" });
  it("sends a filled form's flattened copy, not its editable one", () => {
    expect(defaultPackage([f("a", "completed_application", "Universal - 125 Main (editable).pdf"), f("b", "completed_application", "Universal - 125 Main.pdf"), f("c", "notice_of_commencement", "noc.pdf")])).toEqual(["b", "c"]);
  });
  it("leaves out what came back from the department", () => {
    expect(defaultPackage([f("a", "correction_notice", "letter.pdf"), f("b", "approved_permit", "permit.pdf")])).toEqual([]);
  });
});
