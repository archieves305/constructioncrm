import { describe, expect, it } from "vitest";
import { categoryCounts, categoryLabel, cleanFileName, filterFiles, groupByCategory, previewKind } from "./scope";

const files = [
  { fileName: "Permit card.pdf", category: "PERMIT", missing: false },
  { fileName: "roof-before.jpg", category: "PHOTOS", missing: true },
  { fileName: "Estimate v2.pdf", category: "ESTIMATE", missing: true },
  { fileName: "notes.txt", category: "OTHER", missing: false },
  { fileName: "Signed agreement.pdf", category: "SIGNED_DOC", missing: false },
];

describe("groupByCategory", () => {
  it("groups in a fixed order — the agreement first, loose files last — and skips empty groups", () => {
    expect(groupByCategory(files).map((g) => g.label)).toEqual(["Signed documents", "Estimates", "Permits", "Photos", "Other"]);
  });
  it("keeps a category it does not know, at the end", () => {
    expect(groupByCategory([...files, { fileName: "x", category: "NEW_KIND" }]).at(-1)).toMatchObject({ category: "NEW_KIND", label: "new kind" });
  });
  it("counts per category for the chips", () => {
    expect(categoryCounts(files).find((c) => c.category === "PERMIT")?.count).toBe(1);
  });
});

describe("filterFiles", () => {
  it("filters by category, by name and by missing, together", () => {
    expect(filterFiles(files, { category: "PHOTOS" })).toHaveLength(1);
    expect(filterFiles(files, { q: "ESTIMATE" }).map((f) => f.fileName)).toEqual(["Estimate v2.pdf"]);
    expect(filterFiles(files, { missingOnly: true })).toHaveLength(2);
    expect(filterFiles(files, { missingOnly: true, category: "ESTIMATE", q: "v2" })).toHaveLength(1);
    expect(filterFiles(files, {})).toHaveLength(5);
  });
});

describe("previewKind", () => {
  it("shows PDFs and browser-drawable images in place, everything else as a download", () => {
    expect(previewKind("application/pdf")).toBe("pdf");
    expect(previewKind("image/jpeg")).toBe("image");
    expect(previewKind("image/heic")).toBe("other");
    expect(previewKind("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe("other");
    expect(previewKind(null)).toBe("other");
  });
});

describe("names and labels", () => {
  it("labels every category in words", () => {
    expect(categoryLabel("INTERIOR_RENOVATION_LABOR_CONTRACT")).toBe("Interior renovation labor contracts");
    expect(categoryLabel("RECEIPT")).toBe("Receipts");
  });
  it("keeps the extension when a rename drops it, and refuses an empty name", () => {
    expect(cleanFileName("  Final permit card ", "scan0003.pdf")).toBe("Final permit card.pdf");
    expect(cleanFileName("Final permit card.PDF", "scan0003.pdf")).toBe("Final permit card.PDF");
    expect(cleanFileName("a/b\\c", "x.jpg")).toBe("abc.jpg");
    expect(cleanFileName("   ", "x.jpg")).toBeNull();
  });
});
