import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dueOnFromCard, pageKindOf, parseBoard, parseCard, parseDueLine, parseProjectPage, readPage, splitAddress, splitPersonName } from "./parse";

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");
// 2026-11-19 10:00 in Miami.
const NOW = new Date("2026-11-19T15:00:00Z");
const BOARD_URL = "https://subcontractor.planhub.com/bid-management/bid-board";
const PROJECT_URL = "https://subcontractor.planhub.com/leads/details/609262/project-info?from=bid-board";

describe("pageKindOf", () => {
  it("knows the board and a project page", () => {
    expect(pageKindOf(BOARD_URL)).toEqual({ kind: "BOARD" });
    expect(pageKindOf(PROJECT_URL)).toEqual({ kind: "PROJECT", ref: "609262" });
  });
  it("refuses anything not on planhub.com over https", () => {
    expect(pageKindOf("https://planhub.com.evil.example/bid-management").kind).toBe("UNKNOWN");
    expect(pageKindOf("http://subcontractor.planhub.com/bid-management").kind).toBe("UNKNOWN");
    expect(pageKindOf("https://subcontractor.planhub.com/dashboard").kind).toBe("UNKNOWN");
    expect(pageKindOf("not a url").kind).toBe("UNKNOWN");
  });
});

describe("dueOnFromCard", () => {
  it("takes the year that puts the day nearest today", () => {
    expect(dueOnFromCard("DUE JAN 22", NOW)).toBe("2027-01-22");
    expect(dueOnFromCard("DUE NOV 18", NOW)).toBe("2026-11-18");
    expect(dueOnFromCard("DUE DEC 04", NOW)).toBe("2026-12-04");
    expect(dueOnFromCard("DUE MAR 3, 2027", NOW)).toBe("2027-03-03");
    expect(dueOnFromCard("Prepare Takeoff", NOW)).toBeNull();
  });
});

describe("parseBoard", () => {
  it("reads the saved board from its page text", () => {
    const cards = parseBoard({ url: BOARD_URL, text: fixture("board-2026-11-19.txt") }, NOW);
    expect(cards).toHaveLength(10);
    expect(cards[0]).toEqual({ name: "Loxhatachee River District IT Offices Remodel", stage: "SAVED", dueOn: "2027-01-22", dueText: "DUE JAN 22", bidValue: 0 });
    expect(cards.find((c) => c.name.startsWith("MIA Central"))?.dueOn).toBe("2026-11-30");
    expect(cards.every((c) => c.stage === "SAVED")).toBe(true);
  });
  it("reads per-card text with each card's column", () => {
    const cards = parseBoard(
      {
        url: BOARD_URL,
        text: "",
        cards: [
          { text: "PLANHUB\nSeventh on Haverhill\nBid Value: $12,500\nRC\ncalendar_month\nDUE DEC 04\nPrepare Takeoff", column: "Submitted" },
          { text: "PLANHUB\nPaulette Burdick Park\nBid Value: $0\nDUE DEC 02", column: "estimating" },
        ],
      },
      NOW,
    );
    expect(cards).toEqual([
      { name: "Seventh on Haverhill", stage: "SUBMITTED", dueOn: "2026-12-04", dueText: "DUE DEC 04", bidValue: 12500 },
      { name: "Paulette Burdick Park", stage: "ESTIMATING", dueOn: "2026-12-02", dueText: "DUE DEC 02", bidValue: 0 },
    ]);
  });
  it("splits columns by the lone stage words", () => {
    const text = "saved\nPLANHUB\nA Job\nBid Value: $0\nDUE DEC 01\nwon\nPLANHUB\nB Job\nBid Value: $5\nDUE DEC 02";
    expect(parseBoard({ url: BOARD_URL, text }, NOW).map((c) => [c.name, c.stage])).toEqual([["A Job", "SAVED"], ["B Job", "WON"]]);
  });
  it("skips a card with no name", () => {
    expect(parseCard("Bid Value: $0", "saved", NOW)).toBeNull();
  });
});

describe("parseProjectPage", () => {
  const p = parseProjectPage({ url: PROJECT_URL, text: fixture("project-609262.txt") }, "609262");
  it("reads the project", () => {
    expect(p.name).toBe("MIA Central Terminal Public Restrooms Modernization Group 2");
    expect(p.platformUrl).toBe("https://subcontractor.planhub.com/leads/details/609262/project-info");
    expect(p.address).toMatchObject({ address1: "4200 NW 21st St", city: "Miami", state: "FL", zipCode: "33142" });
    expect(p.trades).toEqual(["Plumbing Installation", "Plumbing Fixtures and Equipment", "Interior Demolition", "Interior Doors", "Firestopping", "Tile Flooring", "Drain Cleaning", "Plumbing Repair/Service"]);
    expect(p.moreTrades).toBe(55);
    expect(p.projectValue).toBe(2288675);
    expect(p.postedOn).toBe("2026-11-17");
    expect(p.status).toBe("Bidding");
    expect(p.projectType).toBe("Renovation/Remodel/Repair");
    expect(p.prevailingWage).toBe(true);
    expect(p.description).toMatch(/^Scope of Work shall include/);
  });
  it("reads the due date with its time in office time", () => {
    expect(p.bidDueAt).toBe("2026-11-30T19:00:00.000Z");
    expect(p.bidDueHasTime).toBe(true);
  });
  it("reads the GC and its contact", () => {
    expect(p.gc).toEqual({ name: "LEGO Construction Co.", website: "http://www.legocc.com/", addressText: "1011 Sunnybrrok Rd suite 905, Miami, FL, 33136", contactName: "Pat Example", contactEmail: "pat@example.com", contactPhone: "(305) 555-0100" });
  });
  it("is what readPage returns for a project address", () => {
    expect(readPage({ url: PROJECT_URL, text: fixture("project-609262.txt") }, NOW).kind).toBe("PROJECT");
  });
});

describe("helpers", () => {
  it("splits addresses with and without a comma after the street", () => {
    expect(splitAddress("1011 Sunnybrrok Rd suite 905, Miami, FL, 33136")).toMatchObject({ address1: "1011 Sunnybrrok Rd suite 905", city: "Miami", state: "FL", zipCode: "33136" });
    expect(splitAddress("7301 Old Cutler Rd Coral Gables, FL 33143")).toMatchObject({ address1: "7301 Old Cutler Rd", city: "Coral Gables", zipCode: "33143" });
    expect(splitAddress("Somewhere")).toMatchObject({ address1: null, city: null });
  });
  it("reads a due line without a time as noon", () => {
    expect(parseDueLine("DUE 12/04/2026")).toEqual({ at: "2026-12-04T17:00:00.000Z", hasTime: false });
  });
  it("splits a person's name", () => {
    expect(splitPersonName("Jithu Sabu Daniel")).toEqual({ firstName: "Jithu Sabu", lastName: "Daniel" });
    expect(splitPersonName("Cher")).toEqual({ firstName: "Cher", lastName: "-" });
  });
});
