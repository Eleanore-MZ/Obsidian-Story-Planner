import { describe, expect, it } from "vitest";
import { createCard, createEmptyStory } from "../src/model/defaults";
import {
  addCharacterToCards,
  common,
  deleteCards,
  moveCardsToChapter,
  moveCardsToPlotLine,
  selectedCards,
  setDateOnCards,
  setTagOnCards,
  setWrittenOnCards,
  tagState,
} from "../src/model/groupEdits";
import { chapterCards } from "../src/model/moves";
import { Story } from "../src/model/types";

const NOW = "2026-10-20T00:00:00.000Z";

function story(): Story {
  const s = createEmptyStory("Group");
  s.plotLines = [
    { id: "p1", name: "A", color: "#000" },
    { id: "p2", name: "B", color: "#111" },
  ];
  s.chapters = [
    { id: "c1", name: "One" },
    { id: "c2", name: "Two" },
  ];
  s.tags = [{ id: "g1", name: "clue", color: "#e67e22" }];
  const add = (id: string, chapter: string | null, order: number) =>
    (s.cards[id] = { ...createCard({ title: id, plotLine: "p1", chapter, order }), id });
  add("a", "c1", 1);
  add("b", "c1", 2);
  add("c", "c1", 3);
  add("x", "c2", 1);
  return s;
}

describe("editing several cards at once", () => {
  it("takes the selected cards in reading order", () => {
    expect(selectedCards(story(), ["c", "x", "a", "gone"]).map((c) => c.id)).toEqual(["a", "c", "x"]);
  });

  it("puts a tag on all of them, or takes it off all of them", () => {
    const s = story();
    s.cards.a!.tags = ["g1"];
    expect(tagState(selectedCards(s, ["a", "b"]), "g1")).toBe("some");
    setTagOnCards(s, ["a", "b"], "g1", true, NOW);
    expect(tagState(selectedCards(s, ["a", "b"]), "g1")).toBe("all");
    setTagOnCards(s, ["a", "b"], "g1", false, NOW);
    expect(tagState(selectedCards(s, ["a", "b"]), "g1")).toBe("none");
  });

  it("moves them to the end of a chapter, keeping their order", () => {
    const s = story();
    moveCardsToChapter(s, ["c", "a"], "c2", NOW);
    expect(chapterCards(s, "c2").map((c) => c.id)).toEqual(["x", "a", "c"]);
    expect(chapterCards(s, "c1").map((c) => [c.id, c.order])).toEqual([["b", 1]]);
  });

  it("moves them to a plot line in their own rows", () => {
    const s = story();
    moveCardsToPlotLine(s, ["a", "b"], "p2", NOW);
    expect([s.cards.a!.plotLine, s.cards.b!.plotLine, s.cards.c!.plotLine]).toEqual(["p2", "p2", "p1"]);
    expect(chapterCards(s, "c1").map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("dates them, marks them written, adds a character once, and deletes them", () => {
    const s = story();
    const date = { calendar: s.calendars[0]!.id, year: 2020, month: 1, day: 2 };
    s.cards.a!.endDate = { calendar: date.calendar, year: 2019 };
    setDateOnCards(s, ["a", "b"], date, NOW);
    expect(common(selectedCards(s, ["a", "b"]), (c) => c.date)).toEqual(date);
    expect(s.cards.a!.endDate).toBeUndefined();
    setWrittenOnCards(s, ["a", "b"], true, NOW);
    expect(common(selectedCards(s, ["a", "b", "c"]), (c) => c.written)).toBe("mixed");
    addCharacterToCards(s, ["a", "b"], "Mara", NOW);
    expect(s.characters.map((c) => c.name)).toEqual(["Mara"]);
    expect(s.cards.b!.characters.map((c) => c.id)).toEqual([s.characters[0]!.id]);
    deleteCards(s, ["a", "b"], NOW);
    expect(Object.keys(s.cards).sort()).toEqual(["c", "x"]);
    expect(s.cards.c!.order).toBe(1);
  });
});
