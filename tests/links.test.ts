import { describe, expect, it } from "vitest";
import { createCard, createEmptyStory } from "../src/model/defaults";
import { History } from "../src/model/history";
import {
  addCardNote,
  fillTemplate,
  linkedPaths,
  linkTarget,
  noteFileName,
  noteValues,
  removeCardNote,
  renameLinkedPath,
  setEntityNote,
} from "../src/model/links";
import { Story } from "../src/model/types";

const NOW = "2026-10-19T00:00:00.000Z";

function story(): Story {
  const s = createEmptyStory("The Glass Harbour");
  const card = createCard({ title: "Body found at the pier", plotLine: s.plotLines[0]!.id, chapter: s.chapters[0]!.id, order: 1 });
  card.id = "k1";
  s.cards.k1 = card;
  s.characters = [{ id: "x1", name: "Mara", color: "#000" }];
  s.locations = [{ id: "l1", name: "The pier" }];
  return s;
}

describe("linking notes", () => {
  it("links a note to a card once, and unlinks it", () => {
    const s = story();
    expect(addCardNote(s, "k1", "Drafts/Pier.md", NOW)).toBe(true);
    expect(addCardNote(s, "k1", "Drafts/Pier.md", NOW)).toBe(false);
    expect(s.cards.k1!.notes).toEqual(["Drafts/Pier.md"]);
    expect(s.cards.k1!.modified).toBe(NOW);
    expect(removeCardNote(s, "k1", "Drafts/Pier.md")).toBe(true);
    expect(s.cards.k1!.notes).toEqual([]);
    expect(removeCardNote(s, "k1", "Drafts/Pier.md")).toBe(false);
  });

  it("sets and clears the notes of characters and places", () => {
    const s = story();
    expect(setEntityNote(s, "character", "x1", "People/Mara.md")).toBe(true);
    expect(setEntityNote(s, "location", "l1", "Places/Pier.md")).toBe(true);
    expect(linkedPaths(s)).toEqual(new Set(["People/Mara.md", "Places/Pier.md"]));
    expect(setEntityNote(s, "character", "x1", undefined)).toBe(true);
    expect("note" in s.characters[0]!).toBe(false);
    expect(setEntityNote(s, "character", "nobody", "x.md")).toBe(false);
  });
});

describe("following renamed notes", () => {
  it("updates links to a renamed note everywhere it is used", () => {
    const s = story();
    s.cards.k1!.notes = ["Drafts/Pier.md", "Research/Tides.md"];
    s.characters[0]!.note = "Drafts/Pier.md";
    expect(renameLinkedPath(s, "Drafts/Pier.md", "Drafts/The pier.md", NOW)).toBe(true);
    expect(s.cards.k1!.notes).toEqual(["Drafts/The pier.md", "Research/Tides.md"]);
    expect(s.cards.k1!.modified).toBe(NOW);
    expect(s.characters[0]!.note).toBe("Drafts/The pier.md");
  });

  it("follows notes inside a renamed folder, but not folders that only share a prefix", () => {
    const s = story();
    s.cards.k1!.notes = ["Drafts/Pier.md", "Drafts old/Pier.md"];
    s.locations[0]!.note = "Drafts/Places/Pier.md";
    expect(renameLinkedPath(s, "Drafts", "Writing/Drafts")).toBe(true);
    expect(s.cards.k1!.notes).toEqual(["Writing/Drafts/Pier.md", "Drafts old/Pier.md"]);
    expect(s.locations[0]!.note).toBe("Writing/Drafts/Places/Pier.md");
  });

  it("changes nothing when the story does not link to the note", () => {
    const s = story();
    s.cards.k1!.notes = ["Drafts/Pier.md"];
    const before = JSON.stringify(s);
    expect(renameLinkedPath(s, "Other.md", "Elsewhere.md")).toBe(false);
    expect(JSON.stringify(s)).toBe(before);
  });

  it("does not leave two links to the same note", () => {
    const s = story();
    s.cards.k1!.notes = ["A.md", "B.md"];
    renameLinkedPath(s, "A.md", "B.md");
    expect(s.cards.k1!.notes).toEqual(["B.md"]);
  });

  it("is applied to the undo history, so undo never brings back the old path", () => {
    const s = story();
    const history = new History();
    history.record(s);
    s.cards.k1!.notes = ["Drafts/Pier.md"];
    history.record(s);
    s.cards.k1!.title = "Renamed";
    renameLinkedPath(s, "Drafts/Pier.md", "Drafts/New.md");
    history.rewrite((x) => renameLinkedPath(x, "Drafts/Pier.md", "Drafts/New.md"));
    const previous = history.undo(s)!;
    expect(previous.cards.k1!.notes).toEqual(["Drafts/New.md"]);
    expect(history.undo(previous)!.cards.k1!.notes).toEqual([]);
  });
});

describe("notes made from cards", () => {
  it("fills a template from the card, leaving unknown placeholders alone", () => {
    const s = story();
    const card = s.cards.k1!;
    card.synopsis = "Mara finds the body.";
    card.characters = [{ id: "x1", role: "pov" }];
    card.location = "l1";
    card.date = { calendar: "main", year: 1531, month: 12, day: 4 };
    const text = fillTemplate("# {{title}}\n{{ characters }} at {{location}}, {{date}}\n{{chapter}} · {{plotLine}}\n{{other}}", noteValues(s, card));
    expect(text).toBe("# Body found at the pier\nMara at The pier, 4 December 1531\nChapter 1 · Main plot\n{{other}}");
  });

  it("calls a card with no chapter off-page", () => {
    const s = story();
    s.cards.k1!.chapter = null;
    expect(noteValues(s, s.cards.k1!).chapter).toBe("Off-page");
  });

  it("makes a file name from the title", () => {
    expect(noteFileName("Who is Ilse? [draft] #1")).toBe("Who is Ilse draft 1");
    expect(noteFileName("  ")).toBe("Untitled scene");
  });

  it("refuses link targets that could break out of a link or open a comment", () => {
    expect(linkTarget("Drafts/Pier.md")).toBe("Drafts/Pier");
    expect(linkTarget("Drafts/100%% sure.md")).toBeNull();
    expect(linkTarget("Drafts/a]]b.md")).toBeNull();
  });
});
