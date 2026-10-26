import { describe, expect, it } from "vitest";
import { isDegenerate } from "../agent";

describe("isDegenerate", () => {
  it("passes a normal reply", () => {
    expect(isDegenerate("Your trim is booked for Tuesday 27 October at 09:00.")).toBe(false);
  });

  it("catches the punctuation-run glitch seen in a live chat", () => {
    expect(isDegenerate("Good ...... ...... ...... ...... ...... ...")).toBe(true);
  });

  it("catches a reply with no letters at all", () => {
    expect(isDegenerate("?! ...")).toBe(true);
  });
});
