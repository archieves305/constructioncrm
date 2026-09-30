import { describe, expect, it } from "vitest";
import { planGenerations, seedNote, SeedVersionInUseError, type ExistingVersion } from "./seed";

const v = (version: number, status: ExistingVersion["status"], contentHash: string, extra: Partial<ExistingVersion> = {}): ExistingVersion => ({
  id: `id-${version}`,
  version,
  status,
  contentHash,
  changeNotes: null,
  pins: 0,
  ...extra,
});

const GENS = [
  { generation: 1, hash: "long" },
  { generation: 2, hash: "slim" },
];

describe("planGenerations", () => {
  it("an empty database gets both generations", () => {
    const plan = planGenerations("core", [], GENS);
    expect(plan.actions).toEqual([
      { generation: 1, kind: "create", version: 1 },
      { generation: 2, kind: "create", version: 2 },
    ]);
    expect(plan.supersede).toEqual([]);
  });

  it("prod's shape: v1 is recognised by its hash, the streamlined generation becomes v2 and replaces it", () => {
    const plan = planGenerations("core", [v(1, "PUBLISHED", "long", { changeNotes: "Seeded", pins: 8 })], GENS);
    expect(plan.actions).toEqual([
      { generation: 1, kind: "unchanged", version: 1, versionId: "id-1" },
      { generation: 2, kind: "create", version: 2 },
    ]);
    expect(plan.supersede).toEqual([{ id: "id-1", version: 1, seeded: true }]);
  });

  it("dev's roofing shape: editor versions take v2 and v3, so the streamlined one lands at v4 and the editor's is flagged", () => {
    const plan = planGenerations(
      "roofing",
      [v(1, "SUPERSEDED", "long", { changeNotes: "Seeded" }), v(2, "PUBLISHED", "edited", { pins: 1 }), v(3, "ARCHIVED", "edited-again")],
      GENS,
    );
    expect(plan.actions).toEqual([
      { generation: 1, kind: "unchanged", version: 1, versionId: "id-1" },
      { generation: 2, kind: "create", version: 4 },
    ]);
    expect(plan.supersede).toEqual([{ id: "id-2", version: 2, seeded: false }]);
  });

  it("a second run changes nothing — and never un-publishes an edit published since", () => {
    const seeded = [v(1, "SUPERSEDED", "long", { changeNotes: "Seeded" }), v(2, "PUBLISHED", "slim", { changeNotes: seedNote(2) })];
    expect(planGenerations("core", seeded, GENS)).toEqual({
      actions: [
        { generation: 1, kind: "unchanged", version: 1, versionId: "id-1" },
        { generation: 2, kind: "unchanged", version: 2, versionId: "id-2" },
      ],
      supersede: [],
      drafts: [],
    });
    const edited = [...seeded.slice(0, 1), v(2, "SUPERSEDED", "slim", { changeNotes: seedNote(2) }), v(3, "PUBLISHED", "admin-edit")];
    expect(planGenerations("core", edited, GENS).supersede).toEqual([]);
  });

  it("rebuilds a generation nobody pins, and refuses to touch one that is pinned", () => {
    const unpinned = [v(1, "SUPERSEDED", "long", { changeNotes: "Seeded" }), v(2, "PUBLISHED", "slim-draft", { changeNotes: seedNote(2) })];
    expect(planGenerations("core", unpinned, GENS).actions[1]).toEqual({ generation: 2, kind: "rebuild", version: 2, versionId: "id-2" });
    const pinned = [v(1, "SUPERSEDED", "long", { changeNotes: "Seeded" }), v(2, "PUBLISHED", "slim-draft", { changeNotes: seedNote(2), pins: 3 })];
    expect(() => planGenerations("core", pinned, GENS)).toThrow(SeedVersionInUseError);
    // The original generation drifting is the same error it always was.
    expect(() => planGenerations("core", [v(1, "PUBLISHED", "drifted", { changeNotes: "Seeded", pins: 8 })], GENS)).toThrow(/v1 is in use by 8 jobs/);
  });

  it("reports open drafts, never matches one, and numbers past it", () => {
    const plan = planGenerations("core", [v(1, "PUBLISHED", "long", { changeNotes: "Seeded" }), v(2, "DRAFT", "")], GENS);
    expect(plan.drafts).toEqual([2]);
    expect(plan.actions[1]).toEqual({ generation: 2, kind: "create", version: 3 });
  });
});
