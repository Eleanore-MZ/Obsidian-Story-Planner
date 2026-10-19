import { describe, expect, it } from "vitest";
import { csvCell, exportCsv, exportJson, exportMarkdown } from "../src/format/export";
import { createCard, createEmptyStory } from "../src/model/defaults";
import { Story } from "../src/model/types";

function story(): Story {
  const s = createEmptyStory("A Small Story");
  s.plotLines = [
    { id: "p1", name: "The move", color: "#000" },
    { id: "p2", name: "Old friends", color: "#000" },
  ];
  s.chapters = [
    { id: "c1", name: "", summary: "June leaves." },
    { id: "c2", name: "" },
  ];
  s.characters = [
    { id: "x1", name: "June", color: "#000" },
    { id: "x2", name: "Tom", color: "#000" },
  ];
  s.locations = [
    { id: "l1", name: "Linden Street" },
    { id: "l2", name: "The café", parent: "l1" },
  ];
  s.tags = [{ id: "g1", name: "turning point", color: "#000" }];
  const add = (id: string, fields: Parameters<typeof createCard>[0]) => (s.cards[id] = { ...createCard(fields), id });
  add("k1", {
    title: "Boxes everywhere", plotLine: "p1", chapter: "c1", order: 1, synopsis: "June packs.\n#1 rule: no tears",
    date: { calendar: "main", year: 2024, month: 3, day: 2 }, characters: [{ id: "x1", role: "pov", note: "Tired" }],
  });
  add("k2", {
    title: "Coffee, with Tom", plotLine: "p2", chapter: "c2", order: 1, alsoIn: ["p1"], location: "l2", tags: ["g1"],
    date: { calendar: "main", year: 2024, month: 3, day: 1 },
    characters: [{ id: "x1", role: "pov" }, { id: "x2", role: "present" }], notes: ["Drafts/Coffee.md"],
  });
  add("k3", { title: "Unpacked", plotLine: "p1", chapter: "c2", order: 2 });
  add("k4", { title: "Tom moves", plotLine: "p2", chapter: null, order: 1, date: { calendar: "main", year: 2023, month: 9, approximate: true } });
  return s;
}

describe("Markdown export", () => {
  it("lists chapters and scenes in reading order, with details", () => {
    const text = exportMarkdown(story(), "reading");
    expect(text.indexOf("## Chapter 1")).toBeLessThan(text.indexOf("### Boxes everywhere"));
    expect(text.indexOf("### Boxes everywhere")).toBeLessThan(text.indexOf("## Chapter 2"));
    expect(text.indexOf("### Unpacked")).toBeLessThan(text.indexOf("## Off-page"));
    expect(text).toContain("June leaves.");
    expect(text).toContain("*Old friends · 2024/03/01 · Linden Street › The café*");
    expect(text).toContain("**Characters:** June (point of view: Tired)");
    expect(text).toContain("**Scene tags:** turning point");
    // Nothing from a card becomes an Obsidian tag or heading.
    expect(text).toContain("\\#1 rule: no tears");
    expect(text).not.toContain("storyplanner-data");
  });

  it("lists scenes in the order they happen, with a heading per date and the undated ones last", () => {
    const text = exportMarkdown(story(), "time");
    const order = ["Tom moves", "Coffee, with Tom", "Boxes everywhere", "## Undated", "Unpacked"].map((t) => text.indexOf(t));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(text).toContain("## around 2023/09");
    expect(text).toContain("*Old friends · Chapter 2 · Linden Street › The café*");
  });
});

describe("CSV export", () => {
  it("writes one row per card with a header, readable by spreadsheets", () => {
    const text = exportCsv(story(), "reading");
    expect(text.startsWith("\uFEFFAct,Chapter,Chapter title,Scene,Title,")).toBe(true);
    const lines = text.slice(1).trimEnd().split("\r\n");
    // Rows end in CRLF; the line break inside a quoted synopsis stays a plain LF.
    expect(lines).toHaveLength(1 + 4);
    expect(text).toContain('"June packs.\n#1 rule: no tears"');
    expect(text).toContain('"Coffee, with Tom"');
    expect(text).toContain("June (point of view); Tom (present)");
    expect(text).toContain(",Coffee\r\n");
  });

  it("puts dated cards in story order, then undated ones", () => {
    const titles = exportCsv(story(), "time")
      .split("\r\n")
      .slice(1, -1)
      .map((line) => line.split(",")[4]);
    expect(titles[0]).toBe("Tom moves");
    expect(titles.at(-1)).toBe("Unpacked");
  });

  it("quotes cells that need it and defuses spreadsheet formulas", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("a\nb")).toBe('"a\nb"');
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("-1, then")).toBe(`"'-1, then"`);
  });
});

describe("JSON export", () => {
  it("is the whole story as data", () => {
    const s = story();
    expect(JSON.parse(exportJson(s))).toEqual(s);
  });
});
