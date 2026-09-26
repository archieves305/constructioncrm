import { describe, expect, it } from "vitest";
import { isNavActive, type NavMatchItem } from "./nav-active";

const items: NavMatchItem[] = [
  { href: "/" },
  { href: "/reports" },
  { href: "/reports/labor" },
  { href: "/violations", match: "exact" },
  { href: "/violations/list" },
  { href: "/violations/list?view=overdue" },
  { href: "/violations/list?view=mine" },
  { href: "/violations/hearings" },
];
const on = (pathname: string, search = "") => items.filter((i) => isNavActive(pathname, new URLSearchParams(search), i, items)).map((i) => i.href);

describe("isNavActive", () => {
  it("longest path wins and the root only matches itself", () => {
    expect(on("/reports/labor")).toEqual(["/reports/labor"]);
    expect(on("/reports/labor/payroll")).toEqual(["/reports/labor"]);
    expect(on("/reports")).toEqual(["/reports"]);
    expect(on("/")).toEqual(["/"]);
    expect(on("/leads/abc")).toEqual([]);
  });

  it("an exact item does not light for children; queued items need their query", () => {
    expect(on("/violations")).toEqual(["/violations"]);
    expect(on("/violations/hearings")).toEqual(["/violations/hearings"]);
    expect(on("/violations/list")).toEqual(["/violations/list"]);
    expect(on("/violations/list", "view=overdue")).toEqual(["/violations/list?view=overdue"]);
    expect(on("/violations/list", "view=mine&page=2")).toEqual(["/violations/list?view=mine"]);
    // An unknown view falls back to the plain list item.
    expect(on("/violations/list", "view=fines")).toEqual(["/violations/list"]);
    expect(on("/violations/abc123")).toEqual([]);
  });
});

describe("isNavActive on the sidebar tree", () => {
  const tree: NavMatchItem[] = [
    { href: "/" },
    { href: "/leads" },
    { href: "/jobs" },
    { href: "/tasks" },
    { href: "/violations", match: "exact" },
    { href: "/violations/list" },
    { href: "/violations/inspections" },
    { href: "/field" },
    { href: "/field-logs" },
    { href: "/reports" },
    { href: "/reports/labor" },
    { href: "/admin/workflow-templates" },
    { href: "/violations/templates" },
  ];
  const lit = (pathname: string, search = "") => tree.filter((i) => isNavActive(pathname, new URLSearchParams(search), i, tree)).map((i) => i.href);

  it("the board view lights the same entry as the table", () => {
    expect(lit("/leads", "view=board&scope=all")).toEqual(["/leads"]);
    expect(lit("/jobs", "view=board")).toEqual(["/jobs"]);
  });
  it("every saved violation view lights Cases now that the views left the sidebar", () => {
    expect(lit("/violations/list", "view=overdue")).toEqual(["/violations/list"]);
    expect(lit("/violations/list", "view=mine")).toEqual(["/violations/list"]);
  });
  it("neighbouring paths stay distinct", () => {
    expect(lit("/field-logs")).toEqual(["/field-logs"]);
    expect(lit("/field/tasks")).toEqual(["/field"]);
    expect(lit("/reports/labor/payroll")).toEqual(["/reports/labor"]);
    expect(lit("/violations/templates")).toEqual(["/violations/templates"]);
    expect(lit("/admin/workflow-templates/abc")).toEqual(["/admin/workflow-templates"]);
    expect(lit("/jobs/abc", "tab=money")).toEqual(["/jobs"]);
  });
});
