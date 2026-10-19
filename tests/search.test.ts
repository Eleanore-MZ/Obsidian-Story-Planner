import { describe, expect, it } from "vitest";
import { createCard, createEmptyStory } from "../src/model/defaults";
import { cardsInReadingOrder, queryTerms, searchCards } from "../src/model/search";
import { Story } from "../src/model/types";

function story(): Story {
  const s = createEmptyStory("The Glass Harbour");
  s.plotLines = [
    { id: "p1", name: "Investigation", color: "#000" },
    { id: "p2", name: "The courier", color: "#000" },
  ];
  s.chapters = [
    { id: "c1", name: "The Pier" },
    { id: "c2", name: "Letters" },
  ];
  s.characters = [
    { id: "x1", name: "Mara", color: "#000" },
    { id: "x2", name: "Ilsé", color: "#000" },
  ];
  s.locations = [
    { id: "l1", name: "Glass Harbour" },
    { id: "l2", name: "The office", parent: "l1" },
  ];
  s.tags = [{ id: "g1", name: "clue", color: "#000" }];
  const add = (id: string, fields: Parameters<typeof createCard>[0]) => (s.cards[id] = { ...createCard(fields), id });
  add("k1", { title: "Body found", plotLine: "p1", chapter: "c1", order: 1, synopsis: "Before dawn.", characters: [{ id: "x1", role: "pov" }] });
  add("k2", { title: "Ilse arrives", plotLine: "p2", chapter: "c1", order: 2, characters: [{ id: "x2", role: "pov", note: "Lies about the letters." }] });
  add("k3", { title: "The ledger", plotLine: "p1", chapter: "c2", order: 1, location: "l2", tags: ["g1"], notes: ["Drafts/Cut page.md"] });
  add("k4", { title: "Last meeting", plotLine: "p1", chapter: null, order: 1 });
  add("k5", { title: "Same row", plotLine: "p2", chapter: "c2", order: 1 });
  return s;
}

const ids = (s: Story, q: string) => searchCards(s, q).map((c) => c.id);

describe("board search", () => {
  it("finds words anywhere on the card, ignoring case and accents", () => {
    const s = story();
    expect(ids(s, "BODY")).toEqual(["k1"]);
    expect(ids(s, "ilse")).toEqual(["k2"]);
    expect(ids(s, "dawn")).toEqual(["k1"]);
  });

  it("needs every word to match", () => {
    const s = story();
    expect(ids(s, "mara dawn")).toEqual(["k1"]);
    expect(ids(s, "mara letters")).toEqual([]);
  });

  it("looks at characters' notes, places with what they are inside, tags, chapters and linked notes", () => {
    const s = story();
    expect(ids(s, "lies")).toEqual(["k2"]);
    expect(ids(s, "harbour office")).toEqual(["k3"]);
    expect(ids(s, "clue")).toEqual(["k3"]);
    expect(ids(s, "cut page")).toEqual(["k3"]);
    expect(ids(s, "off-page")).toEqual(["k4"]);
    // "Letters" is chapter 2's name, and part of a character note in chapter 1.
    expect(ids(s, "letters")).toEqual(["k2", "k3", "k5"]);
  });

  it("ignores tags when story tags are switched off", () => {
    const s = story();
    s.tagsEnabled = false;
    expect(ids(s, "clue")).toEqual([]);
  });

  it("finds nothing for an empty query", () => {
    expect(queryTerms("   ")).toEqual([]);
    expect(ids(story(), "  ")).toEqual([]);
  });

  it("lists cards in reading order, with scenes that share a row left to right, and off-page events last", () => {
    expect(cardsInReadingOrder(story()).map((c) => c.id)).toEqual(["k1", "k2", "k3", "k5", "k4"]);
  });
});
