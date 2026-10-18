import { describe, expect, it } from "vitest";
import { createCard, createEmptyStory } from "../src/model/defaults";
import { History } from "../src/model/history";
import { chapterCards, moveCard, moveInList } from "../src/model/moves";
import { Story } from "../src/model/types";

const OLD = "2026-01-01T00:00:00.000Z";
const NOW = "2026-10-18T22:00:00.000Z";

function story(): Story {
  const s = createEmptyStory("Moves");
  s.plotLines = [
    { id: "p1", name: "A", color: "#000" },
    { id: "p2", name: "B", color: "#111" },
  ];
  s.chapters = [
    { id: "c1", name: "One" },
    { id: "c2", name: "Two" },
  ];
  const add = (id: string, chapter: string | null, order: number, plotLine = "p1", alsoIn: string[] = []) =>
    (s.cards[id] = { ...createCard({ title: id, plotLine, chapter, order, alsoIn }), id, modified: OLD });
  add("a", "c1", 1);
  add("b", "c1", 2);
  add("c", "c1", 3, "p1", ["p2"]);
  add("d", "c2", 1);
  add("off", null, 1);
  return s;
}

const ids = (s: Story, chapter: string | null) => chapterCards(s, chapter).map((c) => c.id);

describe("moveCard", () => {
  it("reorders within a chapter", () => {
    const s = story();
    expect(moveCard(s, "c", { chapter: "c1", plotLine: "p1", beforeCardId: "a" }, NOW)).toBe(true);
    expect(ids(s, "c1")).toEqual(["c", "a", "b"]);
    expect(chapterCards(s, "c1").map((c) => c.order)).toEqual([1, 2, 3]);
  });

  it("moves to the end when there is no card to go before", () => {
    const s = story();
    moveCard(s, "a", { chapter: "c1", plotLine: "p1" }, NOW);
    expect(ids(s, "c1")).toEqual(["b", "c", "a"]);
  });

  it("moves between chapters and renumbers both", () => {
    const s = story();
    moveCard(s, "b", { chapter: "c2", plotLine: "p1", beforeCardId: "d" }, NOW);
    expect(ids(s, "c1")).toEqual(["a", "c"]);
    expect(ids(s, "c2")).toEqual(["b", "d"]);
    expect(s.cards.c!.order).toBe(2);
    expect(s.cards.d!.order).toBe(2);
  });

  it("moves into and out of the off-page group", () => {
    const s = story();
    moveCard(s, "a", { chapter: null, plotLine: "p1" }, NOW);
    expect(ids(s, null)).toEqual(["off", "a"]);
    expect(s.cards.a!.chapter).toBeNull();
    moveCard(s, "off", { chapter: "c2", plotLine: "p1" }, NOW);
    expect(s.cards.off!.chapter).toBe("c2");
  });

  it("changes the plot line, and an echo there becomes the real card", () => {
    const s = story();
    moveCard(s, "c", { chapter: "c1", plotLine: "p2" }, NOW);
    expect(s.cards.c!.plotLine).toBe("p2");
    expect(s.cards.c!.alsoIn).toEqual([]);
  });

  it("stamps only the cards whose position changed", () => {
    const s = story();
    moveCard(s, "b", { chapter: "c1", plotLine: "p1", beforeCardId: "a" }, NOW);
    expect(s.cards.a!.modified).toBe(NOW);
    expect(s.cards.b!.modified).toBe(NOW);
    expect(s.cards.c!.modified).toBe(OLD);
    expect(s.cards.d!.modified).toBe(OLD);
  });

  it("reports no change for a drop in the same place", () => {
    const s = story();
    expect(moveCard(s, "a", { chapter: "c1", plotLine: "p1", beforeCardId: "b" }, NOW)).toBe(false);
    expect(moveCard(s, "a", { chapter: "c1", plotLine: "p1", beforeCardId: "a" }, NOW)).toBe(false);
    expect(s.cards.a!.modified).toBe(OLD);
  });
});

describe("moveInList", () => {
  it("moves before another item or to the end", () => {
    const list = [{ id: "x" }, { id: "y" }, { id: "z" }];
    expect(moveInList(list, "z", "x")).toBe(true);
    expect(list.map((i) => i.id)).toEqual(["z", "x", "y"]);
    expect(moveInList(list, "z", null)).toBe(true);
    expect(list.map((i) => i.id)).toEqual(["x", "y", "z"]);
    expect(moveInList(list, "x", "y")).toBe(false);
  });
});

describe("History", () => {
  it("undoes and redoes in order", () => {
    const h = new History();
    let s = story();
    h.record(s);
    moveCard(s, "c", { chapter: "c1", plotLine: "p1", beforeCardId: "a" }, NOW);
    h.record(s);
    s.cards.a!.title = "renamed";

    s = h.undo(s)!;
    expect(s.cards.a!.title).toBe("a");
    expect(ids(s, "c1")).toEqual(["c", "a", "b"]);
    s = h.undo(s)!;
    expect(ids(s, "c1")).toEqual(["a", "b", "c"]);
    expect(h.undo(s)).toBeNull();

    s = h.redo(s)!;
    s = h.redo(s)!;
    expect(s.cards.a!.title).toBe("renamed");
    expect(h.canRedo).toBe(false);
  });

  it("drops the redo stack after a new change, and keeps a bounded history", () => {
    const h = new History(2);
    let s = story();
    h.record(s);
    s.title = "1";
    s = h.undo(s)!;
    h.record(s);
    expect(h.canRedo).toBe(false);
    h.record(s);
    h.record(s);
    let count = 0;
    while (h.undo(s)) count++;
    expect(count).toBe(2);
  });
});
