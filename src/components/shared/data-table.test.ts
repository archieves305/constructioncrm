import { describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {} }), usePathname: () => "/x", useSearchParams: () => new URLSearchParams() }));

const { DataTable } = await import("./data-table");

type Row = { id: string; name: string; amount: number };
const rows: Row[] = [{ id: "a", name: "Alpha", amount: 5 }, { id: "b", name: "Beta", amount: 9 }];
const columns = [
  { key: "name", header: "Name", sortKey: "name", card: "title" as const, cell: (r: Row) => r.name },
  { key: "amount", header: "Amount", sortKey: "amount", firstDir: "desc" as const, cell: (r: Row) => `$${r.amount}` },
  { key: "note", header: "Note", cell: () => "—" },
];

describe("DataTable", () => {
  it("marks the sorted column for assistive tech and makes sortable headers buttons", () => {
    const html = renderToStaticMarkup(h(DataTable<Row>, { caption: "Things", rows, columns, rowKey: (r) => r.id, sort: { state: { key: "amount", dir: "desc" }, onChange: () => {} } }));
    expect(html).toContain('aria-sort="descending"');
    expect(html.match(/<th[^>]*aria-sort/g)?.length).toBe(1);
    expect(html).toContain("sorted descending");
    // "Note" has no sort key: a plain header, no button
    expect(html).toMatch(/<th[^>]*>Note<\/th>/);
  });

  it("renders every row twice: a table row and a phone card with label / value pairs", () => {
    const html = renderToStaticMarkup(h(DataTable<Row>, { caption: "Things", rows, columns, rowKey: (r) => r.id }));
    expect(html.match(/<tr/g)?.length).toBe(3); // header + 2 rows
    expect(html.match(/<li/g)?.length).toBe(2);
    expect(html).toContain("<dt");
    expect(html).toContain("Amount</dt>");
  });

  it("shows the failure, with retry, instead of an empty list", () => {
    const html = renderToStaticMarkup(h(DataTable<Row>, { caption: "Things", rows: undefined, columns, rowKey: (r) => r.id, error: new Error("boom"), onRetry: () => {} }));
    expect(html).toContain("Couldn&#x27;t load");
    expect(html).toContain("boom");
    expect(html).toContain("Try again");
  });
});
