import { describe, expect, it } from "vitest";
import { JOB_SORT_DEFAULT, JOB_SORT_KEYS, nextSort, parseSort, sortParams } from "./sort";
import { jobOrderBy, leadOrderBy, taskOrderBy } from "./sort-order";

const sp = (q: string) => new URLSearchParams(q);

describe("parseSort", () => {
  it("reads an allowed key and direction", () => {
    expect(parseSort(sp("sort=contract&dir=asc"), JOB_SORT_KEYS, JOB_SORT_DEFAULT)).toEqual({ key: "contract", dir: "asc" });
  });
  it("refuses a key that is not on the list's allow-list (a column name never reaches Prisma)", () => {
    expect(parseSort(sp("sort=passwordHash&dir=asc"), JOB_SORT_KEYS, JOB_SORT_DEFAULT)).toEqual(JOB_SORT_DEFAULT);
    expect(parseSort(sp("sort=lead.email"), JOB_SORT_KEYS, JOB_SORT_DEFAULT)).toEqual(JOB_SORT_DEFAULT);
  });
  it("a bad direction falls back to ascending", () => {
    expect(parseSort(sp("sort=balance&dir=sideways"), JOB_SORT_KEYS, JOB_SORT_DEFAULT)).toEqual({ key: "balance", dir: "asc" });
  });
  it("nothing in the URL is the default", () => {
    expect(parseSort(sp(""), JOB_SORT_KEYS, JOB_SORT_DEFAULT)).toEqual(JOB_SORT_DEFAULT);
  });
});

describe("nextSort / sortParams", () => {
  it("the same header flips, another starts at its first direction", () => {
    expect(nextSort({ key: "contract", dir: "asc" }, "contract")).toEqual({ key: "contract", dir: "desc" });
    expect(nextSort({ key: "contract", dir: "desc" }, "balance", "desc")).toEqual({ key: "balance", dir: "desc" });
  });
  it("the default sort leaves the URL clean", () => {
    expect(sortParams(JOB_SORT_DEFAULT, JOB_SORT_DEFAULT)).toEqual({ sort: null, dir: null });
    expect(sortParams({ key: "rep", dir: "asc" }, JOB_SORT_DEFAULT)).toEqual({ sort: "rep", dir: "asc" });
  });
});

describe("order maps", () => {
  it("every job key orders by something and ends on the id", () => {
    for (const key of JOB_SORT_KEYS) {
      const o = jobOrderBy({ key, dir: "asc" });
      expect(o.length).toBe(2);
      expect(o.at(-1)).toEqual({ id: "asc" });
    }
  });
  it("lead and task orders end on the id too", () => {
    expect(leadOrderBy({ key: "value", dir: "desc" })).toEqual([{ estimatedJobValue: { sort: "desc", nulls: "last" } }, { id: "asc" }]);
    expect(taskOrderBy({ key: "priority", dir: "desc" }).at(-1)).toEqual({ id: "asc" });
  });
});
