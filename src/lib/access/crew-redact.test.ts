import { describe, expect, it } from "vitest";
import { forViewer, redactCustomerContact } from "./crew-redact";

const job = {
  id: "j1",
  title: "Drywall",
  createdAt: new Date("2026-11-09T12:00:00Z"),
  lead: { fullName: "A Customer", primaryPhone: "305-555-0100", secondaryPhone: "305-555-0101", email: "c@example.com", propertyAddress1: "1 Main St" },
  projectManager: { firstName: "P", lastName: "M", email: "pm@knu.example", phone: "305-555-0199" },
  tasks: [{ id: "t1", lead: { primaryPhone: "305-555-0100", email: "c@example.com" } }],
};

describe("crew redaction", () => {
  it("blanks every customer's phones and email, at any depth", () => {
    const r = redactCustomerContact(job);
    expect(r.lead).toEqual({ fullName: "A Customer", primaryPhone: null, secondaryPhone: null, email: null, propertyAddress1: "1 Main St" });
    expect(r.tasks[0].lead).toEqual({ primaryPhone: null, email: null });
  });

  it("keeps staff contact, dates and the rest of the record", () => {
    const r = redactCustomerContact(job);
    expect(r.projectManager).toEqual(job.projectManager);
    expect(r.createdAt).toBeInstanceOf(Date);
    expect(r.title).toBe("Drywall");
    expect(job.lead.primaryPhone).toBe("305-555-0100"); // the input is not changed
  });

  it("applies to crew leads only", () => {
    expect(forViewer("CREW_LEAD", job).lead.primaryPhone).toBeNull();
    expect(forViewer("ADMIN", job).lead.primaryPhone).toBe("305-555-0100");
    expect(forViewer("SALES_REP", job).lead.email).toBe("c@example.com");
  });
});
