import { describe, expect, it } from "vitest";
import { parseStory, serializeStory } from "../src/format/storyFile";
import { createEmptyStory } from "../src/model/defaults";
import { addCategory, deleteCategory, plotLineColor, plotLinesInCategory, setPlotLineCategory } from "../src/model/setup";
import { Story } from "../src/model/types";

function story(): Story {
  const s = createEmptyStory("Categories");
  s.plotLines = [
    { id: "p1", name: "Investigation", color: "#111111" },
    { id: "p2", name: "Mara and Ilse", color: "#222222" },
    { id: "p3", name: "Letters", color: "#333333" },
  ];
  return s;
}

describe("plot line categories", () => {
  it("puts plot lines in categories and takes them out", () => {
    const s = story();
    const main = addCategory(s, "Main story lines");
    expect(s.plotLineCategories[0]).toMatchObject({ id: main, name: "Main story lines" });
    expect(setPlotLineCategory(s, "p1", main)).toBe(true);
    expect(setPlotLineCategory(s, "p3", main)).toBe(true);
    expect(setPlotLineCategory(s, "p3", main)).toBe(false);
    expect(plotLinesInCategory(s, main).map((p) => p.id)).toEqual(["p1", "p3"]);
    expect(setPlotLineCategory(s, "p3", undefined)).toBe(true);
    expect("category" in s.plotLines[2]!).toBe(false);
    expect(setPlotLineCategory(s, "p1", "no-such-category")).toBe(false);
  });

  it("gives new categories distinct colours", () => {
    const s = story();
    addCategory(s, "A");
    addCategory(s, "B");
    expect(s.plotLineCategories[0]!.color).not.toBe(s.plotLineCategories[1]!.color);
  });

  it("colours a plot line by its category only when the story says so", () => {
    const s = story();
    const rel = addCategory(s, "Relationship development");
    s.plotLineCategories[0]!.color = "#ff0000";
    setPlotLineCategory(s, "p2", rel);
    expect(plotLineColor(s, s.plotLines[1])).toBe("#222222");
    s.colorByCategory = true;
    expect(plotLineColor(s, s.plotLines[1])).toBe("#ff0000");
    // Plot lines without a category keep their own colour.
    expect(plotLineColor(s, s.plotLines[0])).toBe("#111111");
    expect(plotLineColor(s, undefined)).toBeUndefined();
  });

  it("keeps the plot lines of a deleted category, with their own colours", () => {
    const s = story();
    const rel = addCategory(s, "Relationship development");
    setPlotLineCategory(s, "p2", rel);
    s.colorByCategory = true;
    expect(deleteCategory(s, rel)).toBe(true);
    expect(s.plotLines).toHaveLength(3);
    expect(s.plotLines[1]!.category).toBeUndefined();
    expect(plotLineColor(s, s.plotLines[1])).toBe("#222222");
    expect(deleteCategory(s, rel)).toBe(false);
  });
});

describe("categories in the story file", () => {
  it("survive a save and load", () => {
    const s = story();
    const main = addCategory(s, "Main story lines");
    setPlotLineCategory(s, "p1", main);
    s.colorByCategory = true;
    const parsed = parseStory(serializeStory(s));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.story).toEqual(s);
  });

  it("are empty, and off, in stories saved before categories existed", () => {
    const text = serializeStory(story())
      .replace(',"plotLineCategories":[]', "")
      .replace(',"colorByCategory":false', "");
    expect(text).not.toContain("plotLineCategories");
    const parsed = parseStory(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.story.plotLineCategories).toEqual([]);
      expect(parsed.story.colorByCategory).toBe(false);
    }
  });
});
