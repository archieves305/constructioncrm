import { describe, expect, it } from "vitest";
import { DEFAULT_TEMPLATES, mergeTemplate, templateKeyFor } from "./templates";

const t = DEFAULT_TEMPLATES.find((x) => x.key === "post_close_1")!;
const full = { contactFirstName: "Dana", project: "Lakeside Plaza", scopes: "drywall and framing", amount: "$412,000", sentDate: "Nov 3, 2026", senderName: "Lisette Valladares", senderPhone: "(305) 555-0100" };

describe("mergeTemplate", () => {
  it("fills every field from the records", () => {
    const m = mergeTemplate(t, full);
    expect(m.missing).toEqual([]);
    expect(m.subject).toBe("Lakeside Plaza — KNU Construction drywall and framing proposal");
    expect(m.body).toContain("Hi Dana,");
    expect(m.body).toContain("for Lakeside Plaza on Nov 3, 2026 ($412,000).");
    expect(m.body).toContain("Lisette Valladares\nKNU Construction\n(305) 555-0100");
  });

  it("rewords a clause it has no value for, never inventing one", () => {
    const m = mergeTemplate(t, { ...full, contactFirstName: null, amount: null, senderPhone: null });
    expect(m.body).toContain("Hi there,");
    expect(m.body).toContain("for Lakeside Plaza on Nov 3, 2026.");
    expect(m.body).not.toContain("$");
    expect(m.body.trimEnd().endsWith("KNU Construction")).toBe(true);
    expect(m.missing).toEqual([]);
  });

  it("leaves an unknown field visible and reports it", () => {
    const m = mergeTemplate({ subject: "x", body: "Re {{project}} {{permitNo}}" }, full);
    expect(m.body).toBe("Re Lakeside Plaza {{permitNo}}");
    expect(m.missing).toEqual(["permitNo"]);
  });
});

describe("templateKeyFor", () => {
  it("first email, second, then check-ins; the award watch has its own", () => {
    expect(templateKeyFor("post:5", 0)).toBe("post_close_1");
    expect(templateKeyFor("post:20", 1)).toBe("post_close_2");
    expect(templateKeyFor("post:50", 2)).toBe("check_in");
    expect(templateKeyFor("award_watch:2026-12-01", 0)).toBe("award_watch");
  });
});
