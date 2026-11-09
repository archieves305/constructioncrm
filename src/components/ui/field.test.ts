import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Field } from "./field";
import { Input } from "./input";
import { Textarea } from "./textarea";

const attr = (html: string, tag: string, name: string) => new RegExp(`<${tag}[^>]*\\s${name}="([^"]*)"`).exec(html)?.[1];

describe("Field", () => {
  it("points the label at the control", () => {
    const html = renderToStaticMarkup(h(Field, { label: "City", children: h(Input) }));
    const forId = attr(html, "label", "for");
    expect(forId).toBeTruthy();
    expect(attr(html, "input", "id")).toBe(forId);
  });

  it("describes the control by its help text, and by the error instead when there is one", () => {
    const help = renderToStaticMarkup(h(Field, { label: "Due", help: "Leave empty for none", id: "due", children: h(Input) }));
    expect(attr(help, "input", "aria-describedby")).toBe("due-help");
    expect(help).toContain('id="due-help"');

    const bad = renderToStaticMarkup(h(Field, { label: "Due", help: "Leave empty for none", error: "Pick a date", id: "due", children: h(Input) }));
    expect(attr(bad, "input", "aria-describedby")).toBe("due-error");
    expect(attr(bad, "input", "aria-invalid")).toBe("true");
    expect(bad).not.toContain("Leave empty for none");
    expect(bad).toContain('role="alert"');
  });

  it("a caller's own id wins, and a textarea is wired the same way", () => {
    const own = renderToStaticMarkup(h(Field, { label: "Notes", children: h(Textarea, { id: "notes" }) }));
    expect(attr(own, "textarea", "id")).toBe("notes");
    const req = renderToStaticMarkup(h(Field, { label: "Name", required: true, id: "n", children: h(Input) }));
    expect(attr(req, "input", "aria-required")).toBe("true");
  });

  it("outside a Field a control is untouched", () => {
    const html = renderToStaticMarkup(h(Input, { placeholder: "x" }));
    expect(html).not.toContain("aria-describedby");
    expect(attr(html, "input", "aria-invalid")).toBeUndefined();
    expect(attr(html, "input", "id") ?? "").not.toMatch(/^field-/);
  });
});
