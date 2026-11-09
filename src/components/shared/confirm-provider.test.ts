import { describe, expect, it } from "vitest";
import { optionsFromSentence } from "./confirm-provider";

describe("optionsFromSentence", () => {
  it("splits the question from the explanation and names the button by its verb", () => {
    expect(optionsFromSentence("Delete estimate E-12? Generated PDFs will remain in Files.")).toEqual({
      title: "Delete estimate E-12?",
      description: "Generated PDFs will remain in Files.",
      confirmLabel: "Delete",
      tone: "danger",
    });
  });
  it("a plain question keeps a neutral Confirm", () => {
    expect(optionsFromSentence("Is this right?")).toEqual({ title: "Is this right?", description: undefined, confirmLabel: "Confirm", tone: "info" });
  });
  it("approve and release are named but not red", () => {
    expect(optionsFromSentence("Approve this day — 3 workers, 24h total?")).toMatchObject({ confirmLabel: "Approve", tone: "info" });
    expect(optionsFromSentence("Release $500 retainage to Ace? It becomes payable now.")).toMatchObject({ confirmLabel: "Release", tone: "info" });
  });
});
