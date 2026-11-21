import { describe, expect, it } from "vitest";
import { crewPaymentCandidates, linkProblem, openRequestFor, quickBooksState, soleCandidate, type CrewPaymentRow } from "./allocator-link";

const d = (s: string) => new Date(`${s}T12:00:00Z`);
const pay = (o: Partial<CrewPaymentRow> = {}): CrewPaymentRow => ({
  id: "p1", jobId: "j1", amount: 4000, paidDate: d("2026-11-18"), paidFromKey: "bank:boa", names: ["BNW Construction"], linked: false, covered: false, ...o,
});
const line = { amount: 4000, date: d("2026-11-19"), payee: "ZELLE TO BNW CONSTRUCTION LLC", accountKey: "bank:boa" };

describe("crewPaymentCandidates", () => {
  it("finds the payment by exact amount within three days", () => {
    expect(crewPaymentCandidates(line, [pay()]).map((c) => c.id)).toEqual(["p1"]);
  });
  it("finds a close amount only when the payee names the crew", () => {
    expect(crewPaymentCandidates({ ...line, amount: 4012 }, [pay()]).map((c) => c.id)).toEqual(["p1"]);
    expect(crewPaymentCandidates({ ...line, amount: 4012, payee: "ZELLE TO SOMEONE ELSE" }, [pay()])).toEqual([]);
  });
  it("skips linked, covered, out-of-window and other-account payments", () => {
    expect(crewPaymentCandidates(line, [pay({ linked: true }), pay({ id: "p2", covered: true }), pay({ id: "p3", paidDate: d("2026-11-10") }), pay({ id: "p4", paidFromKey: "card:amex:knu" })])).toEqual([]);
  });
  it("a payment with no account recorded can still match", () => {
    expect(crewPaymentCandidates(line, [pay({ paidFromKey: null })]).length).toBe(1);
  });
  it("ranks the exact, same-account payment first", () => {
    const c = crewPaymentCandidates(line, [pay({ id: "near", paidFromKey: null, paidDate: d("2026-11-19") }), pay({ id: "best" })]);
    expect(c[0].id).toBe("best");
  });
});

describe("soleCandidate", () => {
  it("pre-fills a single candidate", () => {
    expect(soleCandidate(crewPaymentCandidates(line, [pay()]))?.id).toBe("p1");
  });
  it("pre-fills the one exact same-account candidate among several", () => {
    expect(soleCandidate(crewPaymentCandidates(line, [pay(), pay({ id: "p2", paidFromKey: null })]))?.id).toBe("p1");
  });
  it("leaves two equal candidates to a person", () => {
    expect(soleCandidate(crewPaymentCandidates(line, [pay(), pay({ id: "p2" })]))).toBeNull();
  });
});

describe("openRequestFor", () => {
  it("settles the one open request close in amount", () => {
    expect(openRequestFor(4000, [{ id: "r1", amount: 4000, status: "REQUESTED" }, { id: "r2", amount: 900, status: "REQUESTED" }])).toBe("r1");
  });
  it("ignores paid requests and refuses to guess between two", () => {
    expect(openRequestFor(4000, [{ id: "r1", amount: 4000, status: "PAID" }])).toBeNull();
    expect(openRequestFor(4000, [{ id: "r1", amount: 3990, status: "REQUESTED" }, { id: "r2", amount: 4010, status: "REQUESTED" }])).toBeNull();
  });
});

describe("linkProblem", () => {
  const input = { jobId: "j1", externalId: "bank:1", amount: 4000 };
  it("accepts a free payment on the job, and the same line again", () => {
    expect(linkProblem({ jobId: "j1", allocatorExternalId: null, covered: false }, input)).toBeNull();
    expect(linkProblem({ jobId: "j1", allocatorExternalId: "bank:1", covered: false }, input)).toBeNull();
  });
  it("refuses another job, another line, a covered payment and money in", () => {
    expect(linkProblem({ jobId: "j2", allocatorExternalId: null, covered: false }, input)?.status).toBe(409);
    expect(linkProblem({ jobId: "j1", allocatorExternalId: "bank:2", covered: false }, input)?.status).toBe(409);
    expect(linkProblem({ jobId: "j1", allocatorExternalId: null, covered: true }, input)?.status).toBe(409);
    expect(linkProblem({ jobId: "j1", allocatorExternalId: null, covered: false }, { ...input, amount: -5 })?.status).toBe(400);
    expect(linkProblem(null, input)?.status).toBe(404);
  });
});

describe("quickBooksState", () => {
  it("says linked, with a differing line amount flagged", () => {
    expect(quickBooksState({ paidFromKey: "bank:boa", allocatorExternalId: "bank:1", allocatorLineDate: d("2026-11-20"), allocatorLineAmount: 4012, amount: 4000 })).toEqual({ kind: "linked", text: "In QuickBooks · line 2026-11-20", differs: true });
  });
  it("says waiting when an account was picked and nothing is linked", () => {
    expect(quickBooksState({ paidFromKey: "bank:boa", allocatorExternalId: null, allocatorLineDate: null, allocatorLineAmount: null, amount: 1 }).kind).toBe("waiting");
    expect(quickBooksState({ paidFromKey: null, allocatorExternalId: null, allocatorLineDate: null, allocatorLineAmount: null, amount: 1 }).kind).toBe("none");
  });
});
