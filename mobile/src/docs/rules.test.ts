// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { docProblem, docType, safeName } from "./rules";

test("the type comes from the picker, else the extension, and only the CRM's types pass", () => {
  assert.equal(docType("Permit.pdf", "application/pdf"), "application/pdf");
  assert.equal(docType("Scope.DOCX", null), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(docType("notes.txt", "application/octet-stream"), "text/plain");
  assert.equal(docType("setup.exe", "application/x-msdownload"), null);
  assert.equal(docType("drawing.dwg", null), null);
});

test("refusals in words", () => {
  assert.match(docProblem("a.exe", 10, null) ?? "", /file type/);
  assert.match(docProblem("a.pdf", 0, "application/pdf") ?? "", /empty/);
  assert.match(docProblem("a.pdf", 26 * 1024 * 1024, "application/pdf") ?? "", /25 MB/);
  assert.equal(docProblem("a.pdf", 1000, "application/pdf"), null);
});

test("names are safe on every file system and keep the extension", () => {
  assert.equal(safeName('NOC: 123/456 "final".pdf'), "NOC- 123-456 -final-.pdf");
  assert.equal(safeName("   "), "Document");
});
