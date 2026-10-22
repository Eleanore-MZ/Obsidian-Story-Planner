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
    expect(md).toContain("## Characters\n\n### Mara\n\n**Also known as:** The Watch  \n**Role:** Investigator  \n**Organizations:** The Watch (Captain)\n\nHarbour watch.\n");
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
