import { describe, expect, it } from "vitest";
import { composeOutline, outlineMarkdown } from "../src/format/outline";
import { parseStory, serializeStory } from "../src/format/storyFile";
import { createCard, createEmptyStory } from "../src/model/defaults";
import { setCardDuring } from "../src/model/edits";
import { moveCard } from "../src/model/moves";
import { Story } from "../src/model/types";

function story(): Story {
  const s = createEmptyStory("The Glass Harbour");
  s.plotLines = [
    { id: "p1", name: "Investigation", color: "#000" },
    { id: "p2", name: "The courier", color: "#111" },
  ];
  s.acts = [{ id: "a1", title: "The body", summary: "A death at the harbour." }];
  s.chapters = [
    { id: "c1", name: "The Pier", act: "a1", summary: "Mara finds him." },
    { id: "c2", name: "Letters", act: "a1" },
  ];
  const add = (id: string, fields: Parameters<typeof createCard>[0]) => (s.cards[id] = { ...createCard(fields), id });
  add("k1", { title: "Body found", plotLine: "p1", chapter: "c1", order: 1, synopsis: "Before dawn." });
  add("k2", { title: "Ilse arrives", plotLine: "p2", chapter: "c1", order: 1 });
  add("k3", { title: "", plotLine: "p1", chapter: "c1", order: 2, synopsis: "The ledger." });
  add("k4", { title: "The meeting", plotLine: "p1", chapter: null, order: 1, synopsis: "Oren meets someone." });
  add("k5", { title: "The theft", plotLine: "p1", chapter: null, order: 2 });
  s.cards.k4!.during = "c1";
  return s;
}

describe("the composed outline", () => {
  it("lists acts, chapters, scenes in board order, and each chapter's background", () => {
    const parts = composeOutline(story());
    expect(parts.map((p) => p.heading)).toEqual(["Act I: The body", ""]);
    const pier = parts[0]!.chapters[0]!;
    expect(pier.heading).toBe("Chapter 1: The Pier");
    expect(pier.cards.map((c) => c.id)).toEqual(["k1", "k2", "k3"]);
    expect(pier.background.map((c) => c.id)).toEqual(["k4"]);
    expect(parts[1]!.chapters[0]!.cards.map((c) => c.id)).toEqual(["k5"]);
  });

  it("writes it as Markdown in that structure", () => {
    const md = outlineMarkdown(story());
    expect(md).toBe(
      [
        "---",
        "storyplanner: outline",
        "---",
        "",
        "# The Glass Harbour",
        "",
        "## Act I: The body",
        "",
        "A death at the harbour.",
        "",
        "### Chapter 1: The Pier",
        "",
        "Mara finds him.",
        "",
        "**Body found** (Investigation)  ",
        "Before dawn.",
        "",
        "**Ilse arrives** (The courier)  ",
        "",
        "(Investigation)  ",
        "The ledger.",
        "",
        "#### Background",
        "",
        "**The meeting** (Investigation)  ",
        "Oren meets someone.",
        "",
        "### Chapter 2: Letters",
        "",
        "## Off-page",
        "",
        "**The theft** (Investigation)",
        "",
      ].join("\n"),
    );
  });

  it("uses chapters as the top headings when the story does not show acts", () => {
    const s = story();
    s.actsEnabled = false;
    const md = outlineMarkdown(s);
    expect(md).toContain("\n## Chapter 1: The Pier\n");
    expect(md).toContain("\n### Background\n");
    expect(md).not.toContain("Act I");
  });

  it("never writes tags, links or comments", () => {
    const s = story();
    s.cards.k1!.title = "Find the #clue [[Note]]";
    s.cards.k1!.synopsis = "%%hidden%%";
    const md = outlineMarkdown(s);
    expect(md).not.toMatch(/(^|[^\\])#clue/);
    expect(md).not.toContain("[[Note]]");
    expect(md).not.toContain("%%");
  });
});

describe("off-page events during a chapter", () => {
  it("keeps the chapter in the story file, only for off-page events", () => {
    const s = story();
    const parsed = parseStory(serializeStory(s));
    expect(parsed.ok && parsed.story).toEqual(s);
    const text = serializeStory(s).replace('"chapter":"c1","order":1', '"chapter":"c1","order":1,"during":"c2"');
    const again = parseStory(text);
    expect(again.ok && Object.values(again.story.cards).filter((c) => c.during).map((c) => c.id)).toEqual(["k4"]);
  });

  it("is set only on off-page events, and dropped when the event moves into a chapter", () => {
    const s = story();
    expect(setCardDuring(s, "k1", "c2")).toBe(false);
    expect(setCardDuring(s, "k5", "c2")).toBe(true);
    expect(s.cards.k5!.during).toBe("c2");
    moveCard(s, "k5", { chapter: "c2", plotLine: "p1" });
    expect(s.cards.k5!.during).toBeUndefined();
  });
});
