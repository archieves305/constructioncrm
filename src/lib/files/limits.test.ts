import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES, formatFileSize, uploadProblem } from "./limits";

describe("uploadProblem", () => {
  it("accepts a photo and a PDF", () => {
    expect(uploadProblem({ name: "roof.jpg", size: 2_000_000, type: "image/jpeg" })).toBeNull();
    expect(uploadProblem({ name: "permit.pdf", size: 40_000, type: "application/pdf" })).toBeNull();
  });

  it("accepts a file exactly at the limit and refuses one byte over", () => {
    expect(uploadProblem({ name: "a.pdf", size: MAX_UPLOAD_BYTES, type: "application/pdf" })).toBeNull();
    expect(uploadProblem({ name: "a.pdf", size: MAX_UPLOAD_BYTES + 1, type: "application/pdf" })).toMatch(/25 MB/);
  });

  it("refuses an empty file", () => {
    expect(uploadProblem({ name: "blank.txt", size: 0, type: "text/plain" })).toMatch(/empty/);
  });

  it("refuses a type the server would refuse, including an unknown one", () => {
    expect(uploadProblem({ name: "site.zip", size: 10, type: "application/zip" })).toMatch(/file type/);
    expect(uploadProblem({ name: "mystery", size: 10, type: "" })).toMatch(/file type/);
  });
});

describe("formatFileSize", () => {
  it("picks a readable unit", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(40_000)).toBe("39 KB");
    expect(formatFileSize(2_500_000)).toBe("2.4 MB");
  });
});
