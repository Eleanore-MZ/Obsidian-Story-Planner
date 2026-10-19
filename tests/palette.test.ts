import { afterEach, describe, expect, it } from "vitest";
import { cleanPalette, currentPalette, DEFAULT_PALETTE, nextColor, normalizeHex, setPalette } from "../src/model/palette";
import { addPlotLine } from "../src/model/setup";
import { createEmptyStory } from "../src/model/defaults";

afterEach(() => setPalette(undefined));

describe("the colour palette", () => {
  it("reads colours written in the usual ways", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("4e79a7")).toBe("#4e79a7");
    expect(normalizeHex(" #4E79A7 ")).toBe("#4e79a7");
    expect(normalizeHex("blue")).toBeNull();
    expect(normalizeHex("#12345")).toBeNull();
  });

  it("keeps each valid colour once, in order, and falls back to the default when none are left", () => {
    expect(cleanPalette(["#fff", "nope", "#FFFFFF", "#000"])).toEqual(["#ffffff", "#000000"]);
    expect(cleanPalette([])).toEqual(DEFAULT_PALETTE);
    expect(cleanPalette(["nope"])).toEqual(DEFAULT_PALETTE);
  });

  it("gives the next colour nobody uses, in the palette's order, then goes round again", () => {
    const colors = ["#111111", "#222222", "#333333"];
    expect(nextColor([], colors)).toBe("#111111");
    expect(nextColor([{ color: "#111111" }], colors)).toBe("#222222");
    expect(nextColor([{ color: "#222222" }], colors)).toBe("#111111");
    // Every colour taken: the next in turn by count.
    expect(nextColor([{ color: "#111111" }, { color: "#222222" }, { color: "#333333" }], colors)).toBe("#111111");
    expect(nextColor([{ color: "#111111" }, { color: "#222222" }, { color: "#333333" }, { color: "#000000" }], colors)).toBe("#222222");
  });

  it("is what new plot lines take their colour from", () => {
    setPalette(["#123456", "#abcdef"]);
    expect(currentPalette()).toEqual(["#123456", "#abcdef"]);
    const story = createEmptyStory("Palette");
    expect(story.plotLines[0]?.color).toBe("#123456");
    story.plotLines = [];
    addPlotLine(story, "One");
    addPlotLine(story, "Two");
    expect(story.plotLines.map((p) => p.color)).toEqual(["#123456", "#abcdef"]);
  });
});
