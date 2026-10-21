import { describe, expect, it } from "vitest";
import { createCard, createEmptyStory } from "../src/model/defaults";
import {
  addCharacterToCards,
  characterRoles,
  common,
  nextRole,
  setRoleOnCards,
  deleteCards,
  moveCardsTo,
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

  it("cycles a role present, point of view, mentioned, and sets it on every card that has the character", () => {
    expect([nextRole("present"), nextRole("pov"), nextRole("mentioned"), nextRole("mixed")]).toEqual(["pov", "mentioned", "present", "present"]);
    const s = story();
    addCharacterToCards(s, ["a", "b"], "Mara", NOW);
    const mara = s.characters[0]!.id;
    s.cards.b!.characters[0]!.role = "pov";
    expect(characterRoles(s, selectedCards(s, ["a", "b", "c"]))).toEqual([{ id: mara, role: "mixed", onAll: false }]);
    setRoleOnCards(s, ["a", "b", "c"], mara, "mentioned", NOW);
    expect(characterRoles(s, selectedCards(s, ["a", "b"]))).toEqual([{ id: mara, role: "mentioned", onAll: true }]);
    expect(s.cards.c!.characters).toEqual([]);
  });

  describe("dragging several cards", () => {
    const board = () => {
      const s = story();
      s.plotLines.push({ id: "p3", name: "C", color: "#222" });
      s.cards.b!.plotLine = "p2";
      s.cards.b!.order = 1; // a and b share a row in c1
      s.cards.c!.order = 2;
      const add = (id: string, chapter: string | null, order: number, plotLine = "p1") =>
        (s.cards[id] = { ...createCard({ title: id, plotLine, chapter, order }), id });
      add("y", "c2", 2);
      add("o1", null, 1);
      add("o2", null, 2, "p2");
      return s;
    };
    const lane = (s: Story, ...ids: string[]) => ids.map((id) => `${id}:${s.cards[id]!.plotLine}:${s.cards[id]!.chapter ?? "off"}`);

    it("moves them all to another plot line, each keeping its chapter and row", () => {
      const s = board();
      expect(moveCardsTo(s, ["a", "b", "x"], "a", { chapter: "c1", plotLine: "p3", besideCardId: "a" }, false, NOW)).toBe(true);
      expect(lane(s, "a", "b", "x")).toEqual(["a:p3:c1", "b:p3:c1", "x:p3:c2"]);
      // a and b shared a row; in one plot line now, they keep their order, a first.
      expect(chapterCards(s, "c1").map((c) => c.id)).toEqual(["a", "b", "c"]);
    });

    it("moves them into another chapter one after another, in reading order", () => {
      const s = board();
      moveCardsTo(s, ["c", "a"], "a", { chapter: "c2", plotLine: "p1", afterCardId: "x" }, false, NOW);
      expect(chapterCards(s, "c2").map((c) => c.id)).toEqual(["x", "a", "c", "y"]);
      expect(chapterCards(s, "c1").map((c) => c.id)).toEqual(["b"]);
    });

    it("moves selected cards within their chapter as a block", () => {
      const s = board();
      moveCardsTo(s, ["a", "c", "x"], "c", { chapter: "c1", plotLine: "p1", beforeCardId: "b" }, false, NOW);
      expect(chapterCards(s, "c1").map((c) => c.id)).toEqual(["a", "c", "b"]);
      expect(lane(s, "x")).toEqual(["x:p1:c2"]);
    });

    it("puts off-page events into a chapter, in the plot line they were dropped in, in their off-page order", () => {
      const s = board();
      moveCardsTo(s, ["o1", "o2"], "o1", { chapter: "c2", plotLine: "p1" }, false, NOW);
      expect(lane(s, "o1", "o2")).toEqual(["o1:p1:c2", "o2:p1:c2"]);
      expect(chapterCards(s, "c2").map((c) => c.id)).toEqual(["x", "y", "o1", "o2"]);
    });

    it("keeps off-page events off-page, during the chapter, with Ctrl+Alt", () => {
      const s = board();
      moveCardsTo(s, ["o1", "o2"], "o1", { chapter: "c2", plotLine: "p2" }, true, NOW);
      expect(lane(s, "o1", "o2")).toEqual(["o1:p2:off", "o2:p2:off"]);
      expect([s.cards.o1!.during, s.cards.o2!.during]).toEqual(["c2", "c2"]);
    });

    it("with off-page events and scenes together, only the off-page ones join the chapter", () => {
      const s = board();
      moveCardsTo(s, ["o1", "a"], "o1", { chapter: "c2", plotLine: "p3" }, false, NOW);
      expect(lane(s, "o1", "a")).toEqual(["o1:p3:c2", "a:p3:c1"]);
    });
  });
});
