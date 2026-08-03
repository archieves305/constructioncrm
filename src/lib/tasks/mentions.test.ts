import { describe, expect, it } from "vitest";
import { parseMentions, type MentionableUser } from "./mentions";

const frank: MentionableUser = {
  id: "u-frank",
  firstName: "Frank",
  lastName: "Ruiz",
  email: "frank@knuco.com",
};
const mary: MentionableUser = {
  id: "u-mary",
  firstName: "Mary Beth",
  lastName: "Olsen",
  email: "mbolsen@knuco.com",
};
const frankie: MentionableUser = {
  id: "u-frankie",
  firstName: "Frankie",
  lastName: "Vega",
  email: "fvega@knuco.com",
};
const otherFrank: MentionableUser = {
  id: "u-frank2",
  firstName: "Frank",
  lastName: "Delgado",
  email: "fdelgado@knuco.com",
};

describe("parseMentions", () => {
  it("returns nothing when there is no @ at all", () => {
    expect(parseMentions("all done, moving on", [frank])).toEqual([]);
  });

  it("matches a unique first name", () => {
    expect(parseMentions("@Frank can you check this", [frank])).toEqual(["u-frank"]);
  });

  it("matches a full name containing a space", () => {
    // A naive @(\w+) pattern captures only "Mary" and the mention is lost.
    expect(parseMentions("cc @Mary Beth Olsen please", [mary, frank])).toEqual(["u-mary"]);
  });

  it("does not let a shorter name match inside a longer one", () => {
    expect(parseMentions("@Frankie Vega owns this", [frank, frankie])).toEqual(["u-frankie"]);
  });

  it("refuses to guess when a first name is ambiguous", () => {
    // Two Franks: mailing the wrong one is worse than mailing neither, and the
    // composer's autocomplete is what steers the author to a full name.
    expect(parseMentions("@Frank take a look", [frank, otherFrank])).toEqual([]);
  });

  it("still resolves an ambiguous first name when the surname is given", () => {
    expect(parseMentions("@Frank Delgado take a look", [frank, otherFrank])).toEqual([
      "u-frank2",
    ]);
  });

  it("matches an email local part", () => {
    expect(parseMentions("@mbolsen has the paperwork", [mary])).toEqual(["u-mary"]);
  });

  it("tolerates trailing punctuation", () => {
    expect(parseMentions("@Frank, can you confirm?", [frank])).toEqual(["u-frank"]);
  });

  it("returns each person once however often they are named", () => {
    expect(parseMentions("@Frank and again @Frank Ruiz", [frank])).toEqual(["u-frank"]);
  });

  it("returns people in the order they first appear", () => {
    const body = "@Mary Beth Olsen then @Frank Ruiz";
    expect(parseMentions(body, [frank, mary])).toEqual(["u-mary", "u-frank"]);
  });

  it("is case-insensitive", () => {
    expect(parseMentions("@frank ruiz", [frank])).toEqual(["u-frank"]);
  });
});
