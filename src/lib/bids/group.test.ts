import { describe, expect, it } from "vitest";
import { groupByJob } from "./group";

const P1 = { id: "p1", number: "BP-00001", name: "Burlington" };
const P2 = { id: "p2", number: "BP-00002", name: "MIA Restrooms" };
const row = (id: string, project: typeof P1 | null, next: string | null = null, due: string | null = null) => ({ id, projectName: project?.name ?? `Lone ${id}`, bidProject: project, nextActionAt: next, bidDueAt: due });

describe("groupByJob", () => {
  it("puts each job's GCs under it, in the queue's order", () => {
    const g = groupByJob([row("a", P1), row("b", P2), row("c", P1), row("d", null)]);
    expect(g.map((x) => [x.name, x.rows.map((r) => r.id)])).toEqual([
      ["Burlington", ["a", "c"]],
      ["MIA Restrooms", ["b"]],
      ["Lone d", ["d"]],
    ]);
  });
  it("keeps the soonest next step and due date of the job's GCs", () => {
    const [g] = groupByJob([
      row("a", P1, "2026-11-21T14:00:00Z", "2026-11-20T19:00:00Z"),
      row("b", P1, "2026-11-20T14:00:00Z", null),
      row("c", P1, null, "2026-11-19T19:00:00Z"),
    ]);
    expect(g.nextAt).toBe("2026-11-20T14:00:00Z");
    expect(g.dueAt).toBe("2026-11-19T19:00:00Z");
  });
  it("keeps two bids on no project apart", () => {
    expect(groupByJob([row("a", null), row("b", null)])).toHaveLength(2);
  });
});
