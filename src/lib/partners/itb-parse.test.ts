import { describe, expect, it } from "vitest";
import { findExistingBid, htmlToText, matchAccount, normalizeName, parseAddress, parseItbDate, parseItbEmail, senderAllowed, suggestTrades, unwrapForward } from "./itb-parse";

const received = new Date("2026-10-13T14:00:00.000Z"); // 10:00 ET

describe("parseItbDate", () => {
  it("reads a long date with a named zone", () => {
    const d = parseItbDate("Tuesday, October 28, 2026 at 2:00 PM EDT", received);
    expect(d).toMatchObject({ at: "2026-10-28T18:00:00.000Z", dateOnly: false });
  });
  it("reads numeric dates in office time", () => {
    expect(parseItbDate("10/28/2026 2pm", received)?.at).toBe("2026-10-28T18:00:00.000Z");
    expect(parseItbDate("11/3/26 @ 10:30 AM", received)?.at).toBe("2026-11-03T15:30:00.000Z"); // EST after the change
    expect(parseItbDate("2026-10-28 14:00", received)?.at).toBe("2026-10-28T18:00:00.000Z");
  });
  it("takes the next occurrence when no year is given", () => {
    expect(parseItbDate("Oct 28th 2:00 PM", received)?.at).toBe("2026-10-28T18:00:00.000Z");
    expect(parseItbDate("Jan 9 noon", received)?.at).toBe("2027-01-09T17:00:00.000Z");
  });
  it("assumes 5 PM office time without a time, flagged", () => {
    expect(parseItbDate("October 30, 2026", received)).toMatchObject({ at: "2026-10-30T21:00:00.000Z", dateOnly: true });
  });
  it("refuses what is not a date", () => {
    expect(parseItbDate("TBD", received)).toBeNull();
    expect(parseItbDate("2/31/2026", received)).toBeNull();
    expect(parseItbDate(null, received)).toBeNull();
  });
});

describe("parseAddress", () => {
  it("splits a full address", () => {
    expect(parseAddress("1201 W Sugarland Hwy, Clewiston, FL 33440")).toMatchObject({ address1: "1201 W Sugarland Hwy", city: "Clewiston", state: "FL", zipCode: "33440" });
  });
  it("keeps what a city-only location gives", () => {
    expect(parseAddress("Fort Lauderdale, FL")).toMatchObject({ address1: null, city: "Fort Lauderdale", state: "FL", zipCode: null });
  });
});

describe("unwrapForward", () => {
  it("finds an Outlook header block", () => {
    const u = unwrapForward("FYI\n\nFrom: Jane Smith <jsmith@kaufmanlynn.com>\nSent: Monday, October 12, 2026 9:14 AM\nTo: Bids <bids@knuconstruction.com>\nSubject: Invitation to Bid - Pompano Senior Living\n\nPlease see below.");
    expect(u).toMatchObject({ forwarded: true, from: "Jane Smith <jsmith@kaufmanlynn.com>", subject: "Invitation to Bid - Pompano Senior Living", body: "Please see below." });
  });
  it("leaves a message that was not forwarded alone", () => {
    expect(unwrapForward("Hello there").forwarded).toBe(false);
  });
});

describe("htmlToText", () => {
  it("keeps lines and cells", () => {
    expect(htmlToText("<p>Bid Due:&nbsp;<b>Oct 28</b></p><table><tr><td>Location</td><td>Miami, FL</td></tr></table>")).toBe("Bid Due: Oct 28\nLocation\tMiami, FL");
  });
});

const BC_HTML = `<html><body>
<p>Kaufman Lynn Construction has invited you to bid on Pompano Beach Senior Living.</p>
<table>
<tr><td>Bid Due Date</td><td>Tuesday, October 28, 2026 at 2:00 PM EDT</td></tr>
<tr><td>Location</td><td>1600 N Federal Hwy, Pompano Beach, FL 33062</td></tr>
<tr><td>Bid Package</td><td>09 21 16 Gypsum Board Assemblies / Drywall</td></tr>
<tr><td>Pre-Bid Meeting</td><td>October 20, 2026 10:00 AM</td></tr>
</table>
<p><a href="https://app.buildingconnected.com/opportunities/65f1c2a9b3e4d5f6a7b8c9d0/info">View Opportunity</a></p>
<p>Questions? Contact Jane Smith, jsmith@kaufmanlynn.com, 954-555-0142</p>
<p><a href="https://app.buildingconnected.com/settings/unsubscribe">Unsubscribe</a></p>
</body></html>`;

describe("parseItbEmail", () => {
  it("reads a BuildingConnected invitation sent straight to the intake", () => {
    const p = parseItbEmail({ from: "no-reply@buildingconnected.com", fromName: "Kaufman Lynn Construction via BuildingConnected", subject: "Invitation to Bid: Pompano Beach Senior Living", html: BC_HTML, receivedAt: received }, { ownDomains: ["knuconstruction.com"] });
    expect(p.platform).toBe("BUILDINGCONNECTED");
    expect(p.platformRef).toBe("65f1c2a9b3e4d5f6a7b8c9d0");
    expect(p.platformUrl).toContain("/opportunities/65f1c2a9b3e4d5f6a7b8c9d0");
    expect(p.projectName).toBe("Pompano Beach Senior Living");
    expect(p.gcName).toBe("Kaufman Lynn Construction");
    expect(p.bidDue?.at).toBe("2026-10-28T18:00:00.000Z");
    expect(p.preBidMeeting?.at).toBe("2026-10-20T14:00:00.000Z");
    expect(p.address).toMatchObject({ city: "Pompano Beach", zipCode: "33062" });
    expect(p.scope).toContain("Drywall");
    expect(p.contactEmail).toBe("jsmith@kaufmanlynn.com");
    expect(p.contactPhone).toBe("(954) 555-0142");
    expect(p.kind).toBe("INVITATION");
  });

  it("unwraps a forward from a KNU person and reads the GC's own email", () => {
    const text = [
      "Can we bid this?",
      "",
      "-----Original Message-----",
      "From: Mike Torres <mtorres@miller-construction.com>",
      "Sent: Monday, October 12, 2026 4:02 PM",
      "To: Richard <richard@knuconstruction.com>",
      "Subject: RFP: Coral Springs Medical Office - Interiors",
      "",
      "Richard,",
      "Project Name: Coral Springs Medical Office",
      "Bids Due: 10/30/2026 3:00 PM",
      "Site Walk: 10/21 9am",
      "Project Address: 3000 Coral Hills Dr, Coral Springs, FL 33065",
      "Scope: Framing, drywall and acoustical ceilings",
      "Plans: https://www.dropbox.com/sh/abc123/plans",
      "Mike Torres | Senior Estimator | 561-555-0199",
    ].join("\n");
    const p = parseItbEmail({ from: "richard@knuconstruction.com", subject: "FW: RFP: Coral Springs Medical Office - Interiors", text, receivedAt: received }, { ownDomains: ["knuconstruction.com"] });
    expect(p.platform).toBe("EMAIL");
    expect(p.originalFrom).toEqual({ name: "Mike Torres", email: "mtorres@miller-construction.com" });
    expect(p.originalSubject).toBe("RFP: Coral Springs Medical Office - Interiors");
    expect(p.projectName).toBe("Coral Springs Medical Office");
    expect(p.bidDue?.at).toBe("2026-10-30T19:00:00.000Z");
    expect(p.siteWalk?.at).toBe("2026-10-21T13:00:00.000Z");
    expect(p.address).toMatchObject({ address1: "3000 Coral Hills Dr", city: "Coral Springs", state: "FL", zipCode: "33065" });
    expect(p.contactEmail).toBe("mtorres@miller-construction.com");
    expect(p.contactName).toBe("Mike Torres");
    expect(p.found).toEqual(expect.arrayContaining(["project", "due date", "site walk", "site", "scope", "contact"]));
  });

  it("falls back to the subject for the project and marks an addendum", () => {
    const p = parseItbEmail({ from: "notifications@procore.com", subject: "Addendum #2 - Hialeah Gardens Townhomes", text: "Addendum 2 has been issued.\nhttps://app.procore.com/123/project/bidding/bid_packages/998877/bids", receivedAt: received });
    expect(p.platform).toBe("PROCORE");
    expect(p.platformRef).toBe("998877");
    expect(p.kind).toBe("ADDENDUM");
    expect(p.projectName).toBe("Hialeah Gardens Townhomes");
    expect(p.contactEmail).toBeNull();
  });

  it("never invents a field it did not find", () => {
    const p = parseItbEmail({ from: "someone@example.com", subject: "hello", text: "Nothing here.", receivedAt: received });
    expect(p).toMatchObject({ bidDue: null, address: null, gcName: null, platformUrl: null, scope: null });
  });
});

const accounts = [
  { id: "kl", name: "Kaufman Lynn Construction, Inc.", website: "https://www.kaufmanlynn.com", email: null, contacts: [{ id: "c-jane", email: "jsmith@kaufmanlynn.com" }] },
  { id: "mi", name: "Miller Construction Company", website: "miller-construction.com", email: "info@miller-construction.com", contacts: [] },
  { id: "tu", name: "Turner Construction", website: null, email: null, contacts: [{ id: "c-g", email: "pat@gmail.com" }] },
];

describe("matchAccount", () => {
  it("prefers a contact's own address", () => {
    expect(matchAccount({ originalFrom: { name: null, email: "jsmith@kaufmanlynn.com" }, contactEmail: null, gcName: null }, accounts)).toEqual({ organizationId: "kl", contactId: "c-jane", how: "contact email" });
  });
  it("matches the company domain but never a mailbox provider's", () => {
    expect(matchAccount({ originalFrom: { name: null, email: "new.person@miller-construction.com" }, contactEmail: null, gcName: null }, accounts)?.organizationId).toBe("mi");
    expect(matchAccount({ originalFrom: { name: null, email: "other@gmail.com" }, contactEmail: null, gcName: null }, accounts)).toBeNull();
  });
  it("falls back to the GC's name", () => {
    expect(matchAccount({ originalFrom: { name: null, email: "no-reply@buildingconnected.com" }, contactEmail: null, gcName: "Kaufman Lynn Construction" }, accounts)).toMatchObject({ organizationId: "kl", how: "name" });
    expect(matchAccount({ originalFrom: { name: null, email: null }, contactEmail: null, gcName: "Construction" }, accounts)).toBeNull();
  });
  it("normalizes company suffixes", () => {
    expect(normalizeName("Kaufman Lynn Construction, Inc.")).toBe("kaufman lynn construction");
  });
});

describe("findExistingBid", () => {
  const bids = [
    { id: "b1", number: "BID-00001", organizationId: "kl", projectName: "Pompano Beach Senior Living — drywall", platformRef: null, status: "ESTIMATING" },
    { id: "b2", number: "BID-00002", organizationId: "mi", projectName: "Other", platformRef: "998877", status: "INVITED" },
  ];
  it("matches the platform id first", () => {
    expect(findExistingBid({ platformRef: "998877", projectName: "x" }, null, bids)?.id).toBe("b2");
  });
  it("matches the same account's project by name", () => {
    expect(findExistingBid({ platformRef: null, projectName: "Pompano Beach Senior Living" }, "kl", bids)?.id).toBe("b1");
    expect(findExistingBid({ platformRef: null, projectName: "Pompano Beach Senior Living" }, "mi", bids)).toBeNull();
  });
});

describe("suggestTrades and senderAllowed", () => {
  it("names trades the text mentions", () => {
    expect(suggestTrades("Framing, drywall and acoustical ceilings", [{ id: "d", name: "Drywall" }, { id: "r", name: "Roofing" }, { id: "c", name: "Ceiling" }])).toEqual(["d", "c"]);
  });
  it("lets in KNU people, known contacts and the platforms only", () => {
    const known = { userEmails: new Set(["richard@knuconstruction.com"]), contactEmails: new Set(["jsmith@kaufmanlynn.com"]) };
    expect(senderAllowed("Richard <Richard@knuconstruction.com>", known)).toBe(true);
    expect(senderAllowed("jsmith@kaufmanlynn.com", known)).toBe(true);
    expect(senderAllowed("no-reply@mail.buildingconnected.com", known)).toBe(true);
    expect(senderAllowed("spam@example.com", known)).toBe(false);
  });
});

describe("the subject-line fallback", () => {
  it("fills the project but does not count it as read", () => {
    const p = parseItbEmail({ from: "a@b.com", subject: "Monthly newsletter", text: "Nothing to bid.", receivedAt: received });
    expect(p.projectName).toBe("Monthly newsletter");
    expect(p.found).not.toContain("project");
  });
});
