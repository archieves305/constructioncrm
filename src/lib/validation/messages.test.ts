import { describe, expect, it } from "vitest";
import { fieldLabel, fieldMessage, firstFieldMessage, firstIssueMessage, plainZodMessage } from "./messages";

describe("validation messages", () => {
  it("labels a field path", () => {
    expect(fieldLabel("customerPrice")).toBe("Customer price");
    expect(fieldLabel("lines.0.unitPrice")).toBe("Unit price");
    expect(fieldLabel("assignedUserId")).toBe("Assigned user");
    expect(fieldLabel("_root")).toBe("");
  });

  it("rewrites zod's default wording", () => {
    expect(plainZodMessage("Too small: expected number to be >=0")).toBe("must be 0 or more");
    expect(plainZodMessage("Too small: expected number to be >0")).toBe("must be greater than 0");
    expect(plainZodMessage("Too small: expected string to have >=1 characters")).toBe("is required");
    expect(plainZodMessage("Invalid input: expected number, received undefined")).toBe("is required");
    expect(plainZodMessage("Enter a city")).toBeNull();
  });

  it("builds one sentence per field", () => {
    expect(fieldMessage("amount", "Too small: expected number to be >=0")).toBe("Amount must be 0 or more");
    expect(fieldMessage("city", "Enter a city")).toBe("City: Enter a city");
    expect(fieldMessage("customerPrice", "Customer price must be greater than zero")).toBe("Customer price must be greater than zero");
    expect(fieldMessage("_root", "Pick at least one task")).toBe("Pick at least one task");
  });

  it("takes the first field of a validateBody answer", () => {
    expect(firstFieldMessage({ reason: ["Too small: expected string to have >=1 characters"] })).toBe("Reason is required");
    expect(firstFieldMessage(undefined)).toBeNull();
    expect(firstIssueMessage([{ path: ["amount"], message: "Too small: expected number to be >=0" }])).toBe("Amount must be 0 or more");
  });
});
