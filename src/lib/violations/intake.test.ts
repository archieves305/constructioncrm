import { describe, expect, it } from "vitest";
import { toggleDefaultsFromIntake } from "./intake";

const cat = (key: string, construction: boolean, permit: "REQUIRED" | "NOT_REQUIRED" | "UNDETERMINED") => ({ key, defaultConstructionRequired: construction, defaultPermitRequirement: permit });

describe("toggleDefaultsFromIntake", () => {
  it("work without a permit suggests a permit and construction; debris alone suggests neither", () => {
    const wwp = toggleDefaultsFromIntake({ categories: [cat("work_without_permit", true, "REQUIRED")], hearingDate: null, dailyFine: null, lienRecorded: false, emergency: false });
    expect(wwp.permitSuggestion).toBe("REQUIRED");
    expect(wwp.scopeToggles).toEqual({ construction_required: true, hearing_required: false, fines_accruing: false, lien_recorded: false, emergency: false, appeal: false });
    const debris = toggleDefaultsFromIntake({ categories: [cat("trash_debris", false, "NOT_REQUIRED")], hearingDate: null, dailyFine: null, lienRecorded: false, emergency: false });
    expect(debris.permitSuggestion).toBe("NOT_REQUIRED");
    expect(debris.constructionRequired).toBe(false);
  });

  it("a hearing date, a daily fine, a lien and an emergency turn their toggles on; mixed categories stay undetermined", () => {
    const d = toggleDefaultsFromIntake({ categories: [cat("zoning", false, "UNDETERMINED"), cat("signage", false, "UNDETERMINED")], hearingDate: new Date(), dailyFine: 250, lienRecorded: true, emergency: true, appeal: true });
    expect(d.permitSuggestion).toBe("UNDETERMINED");
    expect(d.scopeToggles).toEqual({ construction_required: false, hearing_required: true, fines_accruing: true, lien_recorded: true, emergency: true, appeal: true });
    // An explicit answer beats the category default.
    expect(toggleDefaultsFromIntake({ categories: [cat("roofing", true, "REQUIRED")], hearingDate: null, dailyFine: null, lienRecorded: false, emergency: false, constructionRequired: false }).constructionRequired).toBe(false);
  });
});
