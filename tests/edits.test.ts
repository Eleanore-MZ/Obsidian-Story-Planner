import { describe, expect, it } from "vitest";
import { createCard, createEmptyStory } from "../src/model/defaults";
import {
  addCardAt,
  addCharacterByName,
  deleteCard,
  removeCardCharacter,
  setCardDate,
  setEcho,
  updateCard,
  updateCardCharacter,
} from "../src/model/edits";
import { chapterRows } from "../src/model/moves";
import { Story } from "../src/model/types";

const OLD = "2026-01-01T00:00:00.000Z";
const NOW = "2026-10-18T23:00:00.000Z";

function story(): Story {
  const s = createEmptyStory("Edits");
  s.plotLines = [
    { id: "p1", name: "A", color: "#000" },
    { id: "p2", name: "B", color: "#111" },
    { id: "p3", name: "C", color: "#222" },
  ];
  s.chapters = [{ id: "c1", name: "One" }];
  const add = (id: string, order: number, plotLine = "p1") =>
    (s.cards[id] = { ...createCard({ title: id, plotLine, chapter: "c1", order }), id, modified: OLD });
  add("a", 1);
  add("b", 2);
  return s;
}

const rows = (s: Story) =>
  chapterRows(s, "c1")
    .map((row) => row.map((c) => c.title).join("+"))
    .join(" ");

describe("addCardAt", () => {
  it("adds a card at the end of the chapter by default", () => {
    const s = story();
    const id = addCardAt(s, { chapter: "c1", plotLine: "p2" }, "New", NOW);
    expect(s.cards[id]!.plotLine).toBe("p2");
    expect(rows(s)).toBe("a b New");
  });

  it("adds a card beside another, in the same row", () => {
    const s = story();
    addCardAt(s, { chapter: "c1", plotLine: "p2", besideCardId: "a" }, "New", NOW);
    expect(rows(s)).toBe("a+New b");
  });

  it("adds an off-page card", () => {
    const s = story();
    const id = addCardAt(s, { chapter: null, plotLine: "p1" }, "Off", NOW);
    expect(s.cards[id]!.chapter).toBeNull();
    expect(s.cards[id]!.order).toBe(1);
  });
});

describe("card field edits", () => {
  it("updates fields and stamps the card, but only when something changed", () => {
    const s = story();
    expect(updateCard(s, "a", { title: "a" }, NOW)).toBe(false);
    expect(s.cards.a!.modified).toBe(OLD);
    expect(updateCard(s, "a", { title: "Arrival", status: "drafted" }, NOW)).toBe(true);
    expect(s.cards.a!.title).toBe("Arrival");
    expect(s.cards.a!.status).toBe("drafted");
    expect(s.cards.a!.modified).toBe(NOW);
  });

  it("adds and removes echoes in plot line order, never in the primary plot line", () => {
    const s = story();
    expect(setEcho(s, "a", "p1", true, NOW)).toBe(false);
    setEcho(s, "a", "p3", true, NOW);
    setEcho(s, "a", "p2", true, NOW);
    expect(s.cards.a!.alsoIn).toEqual(["p2", "p3"]);
    setEcho(s, "a", "p2", false, NOW);
    expect(s.cards.a!.alsoIn).toEqual(["p3"]);
  });
});

describe("characters on cards", () => {
  it("reuses a story character by name and creates new ones", () => {
    const s = story();
    expect(addCharacterByName(s, "a", "Mara", "pov", NOW)).toBe(true);
    expect(addCharacterByName(s, "b", "  mara ", "present", NOW)).toBe(true);
    expect(s.characters).toHaveLength(1);
    expect(s.cards.b!.characters[0]!.id).toBe(s.characters[0]!.id);
    expect(addCharacterByName(s, "b", "Mara", "present", NOW)).toBe(false);
    expect(addCharacterByName(s, "b", "   ", "present", NOW)).toBe(false);
  });

  it("changes role and note, and removes the character from the card only", () => {
    const s = story();
    addCharacterByName(s, "a", "Mara", "present", NOW);
    const id = s.characters[0]!.id;
    updateCardCharacter(s, "a", id, { role: "pov", note: "Finds the ring" }, NOW);
    expect(s.cards.a!.characters[0]).toEqual({ id, role: "pov", note: "Finds the ring" });
    updateCardCharacter(s, "a", id, { note: "  " }, NOW);
    expect(s.cards.a!.characters[0]).toEqual({ id, role: "pov" });
    expect(removeCardCharacter(s, "a", id, NOW)).toBe(true);
    expect(s.cards.a!.characters).toEqual([]);
    expect(s.characters).toHaveLength(1);
  });
});

describe("deleteCard", () => {
  it("removes the card and closes the gap in scene order", () => {
    const s = story();
    addCardAt(s, { chapter: "c1", plotLine: "p1" }, "c", NOW);
    deleteCard(s, "b", NOW);
    expect(s.cards.b).toBeUndefined();
    expect(rows(s)).toBe("a c");
    expect(chapterRows(s, "c1").map((r) => r[0]!.order)).toEqual([1, 2]);
  });
});

describe("dates on cards", () => {
  it("sets and clears dates, and clearing the start clears the end", () => {
    const s = story();
    const id = Object.keys(s.cards)[0]!;
    expect(setCardDate(s, id, "date", { calendar: "main", year: 1531 }, NOW)).toBe(true);
    expect(setCardDate(s, id, "date", { calendar: "main", year: 1531 }, NOW)).toBe(false);
    setCardDate(s, id, "endDate", { calendar: "main", year: 1532 }, NOW);
    setCardDate(s, id, "date", undefined, NOW);
    expect(s.cards[id]!.date).toBeUndefined();
    expect(s.cards[id]!.endDate).toBeUndefined();
    expect(s.cards[id]!.modified).toBe(NOW);
  });
});
