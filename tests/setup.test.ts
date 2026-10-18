import { describe, expect, it } from "vitest";
import { createCard, createEmptyStory, PALETTE } from "../src/model/defaults";
import { chapterRows } from "../src/model/moves";
import { addPlotLine, deleteChapter, deleteCharacter, deletePlotLine, mergeCharacters, shiftInList } from "../src/model/setup";
import { CardCharacter, Story } from "../src/model/types";

const NOW = "2026-10-18T23:30:00.000Z";

function story(): Story {
  const s = createEmptyStory("Setup");
  s.plotLines = [
    { id: "p1", name: "A", color: "#000" },
    { id: "p2", name: "B", color: "#111", characters: ["tom"] },
  ];
  s.chapters = [
    { id: "c1", name: "One" },
    { id: "c2", name: "Two" },
  ];
  s.characters = [
    { id: "tom", name: "Tom", color: "#222" },
    { id: "thomas", name: "Thomas", color: "#333", description: "An old friend" },
  ];
  const add = (id: string, chapter: string, order: number, plotLine: string, alsoIn: string[] = [], characters: CardCharacter[] = []) =>
    (s.cards[id] = { ...createCard({ title: id, plotLine, chapter, order, alsoIn, characters }), id });
  add("a", "c1", 1, "p1", ["p2"], [{ id: "tom", role: "mentioned", note: "Writes" }]);
  add("b", "c1", 2, "p2", [], [{ id: "thomas", role: "pov" }]);
  add("c", "c1", 2, "p1", [], [{ id: "tom", role: "present" }, { id: "thomas", role: "mentioned", note: "Arrives" }]);
  add("d", "c2", 1, "p2");
  return s;
}

const rows = (s: Story, chapter: string | null) =>
  chapterRows(s, chapter)
    .map((row) => row.map((c) => c.id).join("+"))
    .join(" ");

describe("plot lines", () => {
  it("moves a deleted plot line's cards to another one and drops its echoes", () => {
    const s = story();
    expect(deletePlotLine(s, "p2", "p1", NOW)).toBe(true);
    expect(s.plotLines.map((p) => p.id)).toEqual(["p1"]);
    expect(s.cards.b!.plotLine).toBe("p1");
    expect(s.cards.d!.plotLine).toBe("p1");
    expect(s.cards.a!.alsoIn).toEqual([]);
  });

  it("can delete the cards with it, closing the gaps in scene order", () => {
    const s = story();
    deletePlotLine(s, "p1", null, NOW);
    expect(Object.keys(s.cards).sort()).toEqual(["b", "d"]);
    expect(s.cards.b!.order).toBe(1);
  });

  it("never deletes the last plot line", () => {
    const s = story();
    deletePlotLine(s, "p2", "p1", NOW);
    expect(deletePlotLine(s, "p1", null, NOW)).toBe(false);
  });

  it("gives a new plot line a colour no other plot line uses", () => {
    const s = story();
    s.plotLines[0]!.color = PALETTE[0]!;
    s.plotLines[1]!.color = PALETTE[1]!;
    const id = addPlotLine(s, "C");
    expect(s.plotLines.find((p) => p.id === id)!.color).toBe(PALETTE[2]);
  });

  it("reorders one step at a time", () => {
    const s = story();
    expect(shiftInList(s.plotLines, "p2", -1)).toBe(true);
    expect(s.plotLines.map((p) => p.id)).toEqual(["p2", "p1"]);
    expect(shiftInList(s.plotLines, "p2", -1)).toBe(false);
  });
});

describe("chapters", () => {
  it("merges a deleted chapter's scenes onto the end of another, keeping shared rows", () => {
    const s = story();
    expect(deleteChapter(s, "c1", "c2", NOW)).toBe(true);
    expect(rows(s, "c2")).toBe("d a b+c");
  });

  it("can move them off-page or delete them", () => {
    const s = story();
    deleteChapter(s, "c2", "off-page", NOW);
    expect(s.cards.d!.chapter).toBeNull();
    const t = story();
    deleteChapter(t, "c1", null, NOW);
    expect(Object.keys(t.cards)).toEqual(["d"]);
  });

  it("never deletes the last chapter", () => {
    const s = story();
    deleteChapter(s, "c2", "c1", NOW);
    expect(deleteChapter(s, "c1", null, NOW)).toBe(false);
  });
});

describe("characters", () => {
  it("deletes a character from the story, its cards and its plot lines", () => {
    const s = story();
    deleteCharacter(s, "tom", NOW);
    expect(s.characters.map((c) => c.id)).toEqual(["thomas"]);
    expect(s.cards.a!.characters).toEqual([]);
    expect(s.plotLines[1]!.characters).toEqual([]);
  });

  it("merges duplicates, keeping the stronger role and both notes", () => {
    const s = story();
    expect(mergeCharacters(s, "thomas", "tom", NOW)).toBe(true);
    expect(s.characters.map((c) => c.id)).toEqual(["tom"]);
    expect(s.characters[0]!.description).toBe("An old friend");
    expect(s.cards.b!.characters).toEqual([{ id: "tom", role: "pov" }]);
    expect(s.cards.c!.characters).toEqual([{ id: "tom", role: "present", note: "Arrives" }]);
    expect(s.cards.a!.characters).toEqual([{ id: "tom", role: "mentioned", note: "Writes" }]);
  });
});
