import { describe, expect, it } from "vitest";
import { composeOutline, composeTimeOutline, outlineContents, outlineMarkdown } from "../src/format/outline";
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

  it("writes the plot as Markdown in that structure, under its own heading", () => {
    const md = outlineMarkdown(story());
    expect(md).toBe(
      [
        "---",
        "storyplanner: outline",
        "---",
        "",
        "# The Glass Harbour",
        "",
        "## Plot",
        "",
        "### Act I: The body",
        "",
        "A death at the harbour.",
        "",
        "#### Chapter 1: The Pier",
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
        "##### Background",
        "",
        "**The meeting** (Investigation)  ",
        "Oren meets someone.",
        "",
        "#### Chapter 2: Letters",
        "",
        "### Off-page",
        "",
        "**The theft** (Investigation)",
        "",
      ].join("\n"),
    );
  });

  it("starts with the story, its characters and its organizations, and puts events and plot lines in the plot", () => {
    const s = story();
    s.info = { logline: "A death at the harbour.", premise: "A watchwoman.\nA courier." };
    s.characters = [
      { id: "x1", name: "Mara", color: "#a00", role: "Investigator", aliases: ["The Watch"], summary: "Harbour watch.", orgs: [{ id: "o1", rank: "Captain" }] },
    ];
    s.organizations = [{ id: "o1", name: "The Watch", color: "#00a", summary: "Keeps the harbour." }];
    s.customFields = [{ id: "f1", name: "Motto", type: "text", appliesTo: "both" }];
    s.organizations[0]!.fields = { f1: "Never twice" };
    s.plotLines[0]!.synopsis = "Who killed Oren.";
    s.events = [
      { id: "arc", title: "The case", color: "#c00" },
      { id: "e1", title: "The pier", color: "#c00", parent: "arc", synopsis: "Morning at the pier." },
    ];
    s.cards.k1!.event = "e1";
    s.cards.k2!.event = "e1";
    const md = outlineMarkdown(s);
    const at = (text: string) => md.indexOf(text);
    expect(md).toContain("## Story\n\n**Logline:** A death at the harbour.\n\n**Premise:**  \nA watchwoman.  \nA courier.\n");
    expect(md).toContain("## Characters\n\n### Mara\n\n**Aliases:** The Watch  \n**Role:** Investigator  \n**Organizations:** The Watch (Captain)\n\nHarbour watch.\n");
    expect(md).toContain("## Organizations\n\n### The Watch\n\n**Members:** Mara (Captain)  \n**Motto:** Never twice\n\nKeeps the harbour.\n");
    expect(md).toContain("### Plot lines\n\n**Investigation**  \nWho killed Oren.\n");
    expect(md).toContain("##### The case › The pier\n\nMorning at the pier.\n\n**Body found**");
    // Scenes in no event after an event's are set apart.
    expect(at("##### Other scenes")).toBeGreaterThan(at("**Ilse arrives**"));
    expect(at("## Story")).toBeLessThan(at("## Characters"));
    expect(at("## Characters")).toBeLessThan(at("## Organizations"));
    expect(at("## Organizations")).toBeLessThan(at("## Plot"));
  });

  it("uses chapters as the plot's top headings when the story does not show acts", () => {
    const s = story();
    s.actsEnabled = false;
    const md = outlineMarkdown(s);
    expect(md).toContain("\n### Chapter 1: The Pier\n");
    expect(md).toContain("\n#### Background\n");
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

  it("keeps the writer's Markdown in synopses, unescaped", () => {
    const s = story();
    s.cards.k1!.synopsis = "She finds **the key**.\n\n- under the mat\n- *rusted*";
    const md = outlineMarkdown(s);
    expect(md).toContain("She finds **the key**.\n\n- under the mat  \n- *rusted*\n");
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

describe("the story contents", () => {
  it("lists the parts, people, plot lines, chapters and events in outline order", () => {
    const s = createEmptyStory("Contents");
    const ch = s.chapters[0]!;
    const c = createCard({ title: "Scene", plotLine: s.plotLines[0]!.id, chapter: ch.id, order: 0 });
    s.cards[c.id] = c;
    s.events = [{ id: "ev", title: "The ledger", color: "#c00" }];
    c.event = "ev";
    const list = outlineContents(s);
    const labels = list.map((e) => e.label);
    expect(labels.slice(0, 2)).toEqual(["Story", "Characters"]);
    expect(labels.indexOf("Plot")).toBeLessThan(labels.indexOf("Plot lines"));
    const chapter = list.find((e) => e.chapterId === ch.id)!;
    const event = list.find((e) => e.eventId === "ev")!;
    expect(list.indexOf(event)).toBe(list.indexOf(chapter) + 1);
    expect(event.unfold).toContain(`chapter:${ch.id}`);
    expect(event.depth).toBe(chapter.depth + 1);
  });
});

describe("the outline in story-time order", () => {
  const timed = () => {
    const s = createEmptyStory("Timed");
    s.dateFormat = "YYYY/MM/DD";
    const ch = s.chapters[0]!.id;
    const p = s.plotLines[0]!.id;
    const add = (title: string, date: Story["cards"][string]["date"], chapter: string | null = ch, order = 0) => {
      const c = createCard({ title, plotLine: p, chapter, order });
      if (date) c.date = date;
      s.cards[c.id] = c;
      return c;
    };
    const late = add("Late", { calendar: "main", year: 1531, month: 12, day: 4 }, ch, 0);
    const early = add("Early", { calendar: "main", year: 1531, month: 3, day: 9 }, ch, 1);
    const yearOnly = add("Some time that year", { calendar: "main", year: 1531 }, ch, 2);
    const offPage = add("Off-page", { calendar: "main", year: 1531, month: 12, day: 4 }, null, 0);
    const undated = add("Whenever", undefined, ch, 3);
    return { s, late, early, yearOnly, offPage, undated };
  };

  it("groups scenes by year, month and day, in the order they happen, with undated ones last", () => {
    const { s, late, early, yearOnly, offPage, undated } = timed();
    const t = composeTimeOutline(s);
    expect(t.spans.map((y) => y.heading)).toEqual(["1531"]);
    const year = t.spans[0]!;
    expect(year.groups.flatMap((g) => g.cards.map((c) => c.id))).toEqual([yearOnly.id]);
    expect(year.spans.map((m) => m.heading)).toEqual(["1531/03", "1531/12"]);
    expect(year.spans[0]!.spans[0]!.groups[0]!.cards.map((c) => c.id)).toEqual([early.id]);
    // Off-page scenes are in time order with the rest.
    const dec4 = year.spans[1]!.spans[0]!;
    expect(dec4.heading).toBe("1531/12/04");
    expect(dec4.groups.flatMap((g) => g.cards.map((c) => c.id)).sort()).toEqual([late.id, offPage.id].sort());
    expect(t.undated.flatMap((g) => g.cards.map((c) => c.id))).toEqual([undated.id]);
  });

  it("exports in that order, with each scene's chapter", () => {
    const { s } = timed();
    const md = outlineMarkdown(s, "time");
    expect(md.indexOf("### 1531\n")).toBeGreaterThan(-1);
    expect(md.indexOf("#### 1531/03")).toBeLessThan(md.indexOf("#### 1531/12"));
    expect(md).toContain("##### 1531/12/04");
    expect(md).toContain("**Off-page** (Main plot · Off-page)".replace("Main plot", s.plotLines[0]!.name));
    expect(md.indexOf("### Undated")).toBeGreaterThan(md.indexOf("1531/12/04"));
    expect(md).not.toContain("### Chapter");
  });
});

describe("Markdown in synopses, in the exported outline", () => {
  it("keeps code blocks whole and closed, and lists and rules as written", () => {
    const s = createEmptyStory("Code");
    const c = createCard({ title: "Scene", plotLine: s.plotLines[0]!.id, chapter: s.chapters[0]!.id, order: 0 });
    c.synopsis = "Notes:\n```\n#include <x>\nline two\n\n- a\n  - b\n\n---\n\nAfter";
    s.cards[c.id] = c;
    const md = outlineMarkdown(s);
    // The open block is closed at the end of the synopsis; lines inside it get no trailing spaces.
    expect(md).toContain("Notes:\n```\n#include <x>\nline two\n\n- a\n  - b\n\n---\n\nAfter\n```\n");
    // What follows the synopsis is outside any code block.
    const after = md.slice(md.indexOf("After\n```\n") + "After\n```\n".length);
    expect(after.includes("```")).toBe(false);
  });

  it("round-trips code and lists through the story file, one line per card", () => {
    const s = createEmptyStory("Code");
    const c = createCard({ title: "Scene", plotLine: s.plotLines[0]!.id, chapter: s.chapters[0]!.id, order: 0 });
    c.synopsis = "```\ncode %% [[x]]\n```\n- [ ] task\n  1. nested";
    s.cards[c.id] = c;
    const text = serializeStory(s);
    const back = parseStory(text);
    expect(back.ok && back.story.cards[c.id]!.synopsis).toBe(c.synopsis);
    // The card is still one line in the data block.
    expect(text.split("\n").filter((l) => l.includes(`"id":"${c.id}"`))).toHaveLength(1);
  });
});

describe("writing lists in the Outline tab", () => {
  it("carries the marker on at Enter, and ends the list on an empty item", async () => {
    const { continueList } = await import("../src/view/listKeys");
    expect(continueList("- one", 5)).toMatchObject({ text: "- one\n- ", caret: 8 });
    expect(continueList("  3. three", 10)).toMatchObject({ text: "  3. three\n  4. ", caret: 16 });
    expect(continueList("- [x] done", 10)).toMatchObject({ text: "- [x] done\n- [ ] ", caret: 17 });
    // An empty item ends the list, leaving an empty line to go on writing in.
    expect(continueList("- one\n- ", 8)).toMatchObject({ text: "- one\n", caret: 6, from: 6, to: 8, insert: "" });
    expect(continueList("plain text", 10)).toBeNull();
    // In the middle of an item, Enter is an ordinary new line.
    expect(continueList("- one two", 5)).toBeNull();
  });

  it("moves a list line in and out with Tab and Shift+Tab", async () => {
    const { indentLine } = await import("../src/view/listKeys");
    expect(indentLine("- a\n- b", 7, false)).toMatchObject({ text: "- a\n  - b", caret: 9 });
    expect(indentLine("- a\n  - b", 9, true)).toMatchObject({ text: "- a\n- b", caret: 7 });
    expect(indentLine("plain", 3, false)).toBeNull();
  });
});
