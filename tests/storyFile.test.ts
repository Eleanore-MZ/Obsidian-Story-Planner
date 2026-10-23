import { describe, expect, it } from "vitest";
import { isStoryText, outlineWasEdited, parseStory, renderOutline, safeMarkdown, serializeStory } from "../src/format/storyFile";
import { createCard, createEmptyStory } from "../src/model/defaults";
import { Story } from "../src/model/types";

function sampleStory(): Story {
  const story = createEmptyStory("The Glass Harbour");
  const plotLine = story.plotLines[0]!.id;
  const chapter = story.chapters[0]!.id;
  const a = createCard({ title: "Body found at the pier", plotLine, chapter, order: 1, synopsis: "Mara is called out before dawn." });
  const b = createCard({ title: "The harbourmaster's last meeting", plotLine, chapter: null, order: 1 });
  story.cards[a.id] = a;
  story.cards[b.id] = b;
  return story;
}

function parseOk(text: string) {
  const result = parseStory(text);
  if (!result.ok) throw new Error(result.error);
  return result;
}

describe("story file round trip", () => {
  it("parses what it serializes", () => {
    const story = sampleStory();
    const parsed = parseOk(serializeStory(story));
    expect(parsed.story).toEqual(story);
    expect(parsed.warnings).toEqual([]);
  });

  it("is stable: serializing twice gives the same text", () => {
    const text = serializeStory(sampleStory());
    expect(serializeStory(parseOk(text).story, parseOk(text).frontmatter)).toBe(text);
  });

  it("reads files saved with Windows line endings", () => {
    const story = sampleStory();
    const text = serializeStory(story).replace(/\n/g, "\r\n");
    expect(parseOk(text).story).toEqual(story);
  });

  it("keeps the user's own frontmatter properties", () => {
    const text = serializeStory(sampleStory(), ["aliases: [Harbour]", "storyplanner: story"]);
    expect(text).toContain("aliases: [Harbour]");
    expect(text.match(/storyplanner: story/g)).toHaveLength(1);
    expect(parseOk(text).frontmatter).toContain("aliases: [Harbour]");
  });

  it("marks the note as a story", () => {
    expect(isStoryText(serializeStory(sampleStory()))).toBe(true);
    expect(isStoryText("---\ntags: x\n---\nHello")).toBe(false);
    expect(isStoryText("No frontmatter at all")).toBe(false);
  });
});

describe("text that could break the note", () => {
  it("survives %% in card text, which would otherwise close the data comment", () => {
    const story = sampleStory();
    const card = Object.values(story.cards)[0]!;
    card.title = "100%% certain";
    card.synopsis = "%%\nstoryplanner-data\n{}\n%%";
    expect(parseOk(serializeStory(story)).story).toEqual(story);
  });

  it("never writes Obsidian tags, links or comments into the outline", () => {
    const story = sampleStory();
    const card = Object.values(story.cards)[0]!;
    card.title = "Find the #clue";
    card.synopsis = "See [[Some Note]] and %%hidden%%\n- not a list\n2. not numbered";
    const outline = renderOutline(story);
    expect(outline).not.toMatch(/(^|[^\\])#clue/);
    expect(outline).not.toContain("[[Some Note]]");
    expect(outline).not.toContain("%%");
    expect(outline).toContain("\\- not a list");
    expect(outline).toContain("2\\. not numbered");
  });

  it("writes story tags as plain text, never as Obsidian tags", () => {
    const story = sampleStory();
    story.tags = [{ id: "g1", name: "#clue", color: "#000" }, { id: "g2", name: "red herring", color: "#111" }];
    const card = Object.values(story.cards)[0]!;
    card.tags = ["g1", "g2"];
    const outline = renderOutline(story);
    expect(outline).toContain("Scene tags: \\#clue, red herring");
    expect(outline).not.toMatch(/(^|[^\\])#clue/);
    expect(parseOk(serializeStory(story)).story).toEqual(story);
  });

  it("names an untitled card in the outline, and keeps its empty title", () => {
    const story = sampleStory();
    Object.values(story.cards)[0]!.title = "";
    expect(renderOutline(story)).toContain("**Untitled** (");
    expect(renderOutline(story)).not.toContain("****");
    expect(parseOk(serializeStory(story)).story).toEqual(story);
  });

  it("keeps the story's clock block length, and dates with both a clock time and a chosen part of the day", () => {
    const story = sampleStory();
    story.timeBlockMinutes = 30;
    const card = Object.values(story.cards)[0]!;
    card.date = { calendar: story.calendars[0]!.id, year: 2020, month: 1, day: 1, minutes: 600, dayPart: "evening" };
    expect(parseOk(serializeStory(story)).story).toEqual(story);
    expect("timeBlockMinutes" in parseOk(serializeStory(sampleStory())).story).toBe(false);
  });

  it("opens dates once marked approximate, and drops the mark on the next save", () => {
    const story = sampleStory();
    const card = Object.values(story.cards)[0]!;
    card.date = { calendar: story.calendars[0]!.id, year: 2020, month: 1 };
    card.endDate = { calendar: story.calendars[0]!.id, year: 2020, month: 2 };
    const old = serializeStory(story).replace('"year":2020,"month":1}', '"year":2020,"month":1,"approximate":true}').replace('"month":2}', '"month":2,"approximate":true}');
    expect(old.match(/"approximate":true/g)).toHaveLength(2);
    const parsed = parseOk(old);
    expect(parsed.story).toEqual(story);
    expect(serializeStory(parsed.story, parsed.frontmatter)).not.toContain("approximate");
  });

  it("keeps the card fields a story chooses for itself, and nothing for stories that follow the defaults", () => {
    const story = sampleStory();
    story.cardShows = { characters: true, synopsis: false };
    expect(parseOk(serializeStory(story)).story).toEqual(story);
    expect("cardShows" in parseOk(serializeStory(sampleStory())).story).toBe(false);
    // Unknown fields and values that are not true or false are dropped.
    const odd = serializeStory(story).replace('"cardShows":{"characters":true,"synopsis":false}', '"cardShows":{"characters":true,"colour":true,"place":"yes"}');
    expect(parseOk(odd).story.cardShows).toEqual({ characters: true });
  });

  it("keeps the story's own start and end, and stories without them parse as before", () => {
    const story = sampleStory();
    const cal = story.calendars[0]!.id;
    story.storyStart = { calendar: cal, year: 1531, month: 12, day: 1 };
    story.storyEnd = { calendar: cal, year: 1532, month: 1, day: 3, minutes: 600 };
    expect(parseOk(serializeStory(story)).story).toEqual(story);
    const plain = parseOk(serializeStory(sampleStory())).story;
    expect("storyStart" in plain || "storyEnd" in plain).toBe(false);
    // Something that is not a date is dropped.
    const odd = serializeStory(story).replace(/"storyStart":\{[^}]*\}/, '"storyStart":"soon"');
    expect("storyStart" in parseOk(odd).story).toBe(false);
  });

  it("does write real links for notes linked to cards", () => {
    const story = sampleStory();
    Object.values(story.cards)[0]!.notes = ["Drafts/Chapter 1.md"];
    expect(renderOutline(story)).toContain("[[Drafts/Chapter 1]]");
  });

  it("links characters and places that have notes, showing their names", () => {
    const story = sampleStory();
    story.characters = [
      { id: "x1", name: "Mara", color: "#000", note: "People/Mara Venn.md" },
      { id: "x2", name: "Ilse", color: "#000" },
    ];
    story.locations = [{ id: "l1", name: "The pier", note: "Places/The pier.md" }];
    const card = Object.values(story.cards)[0]!;
    card.characters = [{ id: "x1", role: "pov" }, { id: "x2", role: "present" }];
    card.location = "l1";
    const outline = renderOutline(story);
    expect(outline).toContain("Characters: [[People/Mara Venn|Mara]], Ilse");
    expect(outline).toContain("[[Places/The pier]])");
  });

  it("never writes a link that could break the note", () => {
    const story = sampleStory();
    const card = Object.values(story.cards)[0]!;
    card.notes = ["Drafts/100%% done.md"];
    story.characters = [{ id: "x1", name: "Mara | the [watch]", color: "#000", note: "People/Mara.md" }];
    card.characters = [{ id: "x1", role: "pov" }];
    const outline = renderOutline(story);
    expect(outline).not.toContain("%%");
    expect(outline).toContain(String.raw`Notes: 100\%\% done`);
    // A name that would break the link's label falls back to the note's own name.
    expect(outline).toContain("Characters: [[People/Mara]]");
    expect(parseOk(serializeStory(story)).story).toEqual(story);
  });
});

describe("safe Markdown, for synopses in exported notes", () => {
  it("keeps emphasis, lists, quotes and code", () => {
    const text = "**Bold** and *italic* and `code`\n- one\n- two\n1. first\n> said";
    expect(safeMarkdown(text)).toBe(text);
  });

  it("stops tags, links, embeds, comments and HTML", () => {
    const out = safeMarkdown("A #clue, [[Note]], ![[Pic.png]], ![img](x.png), %%hidden%%, <b>hi</b>");
    expect(out).not.toMatch(/(^|[^\\])#clue/);
    expect(out).not.toContain("[[");
    expect(out).not.toMatch(/(^|[^\\])!\[/);
    expect(out).not.toMatch(/(^|[^\\])%/);
    expect(out).not.toMatch(/(^|[^\\])</);
  });

  it("stops headings, fences, setext underlines and block ids", () => {
    expect(safeMarkdown("# Not a heading")).toBe("\\# Not a heading");
    expect(safeMarkdown("```\ncode")).toBe("\\```\ncode");
    expect(safeMarkdown("Title\n---")).toBe("Title\n\\---");
    expect(safeMarkdown("Title\n===")).toBe("Title\n\\===");
    expect(safeMarkdown("Ends with ^ref1")).toBe("Ends with \\^ref1");
  });

  it("keeps a writer's backslash from undoing an escape", () => {
    expect(safeMarkdown("\\#tag")).toBe("\\\\\\#tag");
    expect(safeMarkdown("\\[[Note]]")).toBe("\\\\\\[\\[Note\\]\\]");
  });
});

describe("scenes that share a row", () => {
  it("lists them left to right by plot line in the outline, and keeps the shared order", () => {
    const story = createEmptyStory("Parallel");
    story.plotLines.push({ id: "p2", name: "Second", color: "#d9534f" });
    const [first] = story.plotLines;
    const chapter = story.chapters[0]!.id;
    // Ids chosen so that sorting by id alone would give the wrong order.
    story.cards.a = { ...createCard({ title: "Right column", plotLine: "p2", chapter, order: 1 }), id: "a" };
    story.cards.b = { ...createCard({ title: "Left column", plotLine: first!.id, chapter, order: 1 }), id: "b" };
    const outline = renderOutline(story);
    expect(outline.indexOf("Left column")).toBeLessThan(outline.indexOf("Right column"));
    const parsed = parseOk(serializeStory(story));
    expect(parsed.story.cards.a!.order).toBe(1);
    expect(parsed.story.cards.b!.order).toBe(1);
  });
});

describe("written and unwritten scenes", () => {
  it("keeps whether a card is written", () => {
    const story = sampleStory();
    Object.values(story.cards)[0]!.written = true;
    expect(parseOk(serializeStory(story)).story).toEqual(story);
  });

  it("reads the statuses of older stories: drafted and revised scenes are written, ideas and outlines are not", () => {
    const story = sampleStory();
    const text = serializeStory(story);
    const statuses = ["idea", "outlined", "drafted", "revised"];
    let i = 0;
    // Turn each card line back into the old form, with a status instead of "written".
    const old = text.replace(/"written":false/g, () => `"status":"${statuses[i++ % statuses.length]}"`);
    expect(old).not.toContain('"written"');
    const cards = Object.values(parseOk(old).story.cards).sort((a, b) => a.id.localeCompare(b.id));
    const expected = Object.keys(story.cards).sort().map((_, n) => ["drafted", "revised"].includes(statuses[n % 4]!));
    expect(cards.map((c) => c.written)).toEqual(expected);
    // The old field is dropped on the next save.
    for (const card of cards) expect("status" in card).toBe(false);
    expect(serializeStory(parseOk(old).story)).not.toContain('"status"');
  });
});

describe("relationships, which were removed", () => {
  it("still opens stories that have them, and drops them on the next save", () => {
    const story = sampleStory();
    const color = story.plotLines[0]!.color;
    const text = serializeStory(story)
      .replace(`"color":"${color}"}`, `"color":"${color}","characters":["x1"]}`)
      .replace(/"written":false/, '"written":false,"relationshipState":"allies"');
    expect(text).toContain('"characters":["x1"]');
    expect(text).toContain('"relationshipState":"allies"');
    const parsed = parseOk(text);
    expect("characters" in parsed.story.plotLines[0]!).toBe(false);
    expect(Object.values(parsed.story.cards).some((c) => "relationshipState" in c)).toBe(false);
    const saved = serializeStory(parsed.story, parsed.frontmatter);
    expect(saved).not.toContain("relationshipState");
    expect(saved).not.toContain('"characters":["x1"]');
  });
});

describe("damaged or unusual notes", () => {
  it("refuses notes that are not stories", () => {
    expect(parseStory("# Just a note").ok).toBe(false);
  });

  it("reports a missing data block instead of guessing", () => {
    const text = serializeStory(sampleStory());
    const damaged = text.slice(0, text.indexOf("%%\nstoryplanner-data"));
    const result = parseStory(damaged);
    expect(result.ok).toBe(false);
  });

  it("reports a corrupted card line", () => {
    const text = serializeStory(sampleStory());
    const damaged = text.replace(/\n\{"id":"k[^\n]*/, '\n{"id": broken');
    const result = parseStory(damaged);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Line \d+ of the data block/);
  });

  it("refuses stories saved by a newer version", () => {
    const text = serializeStory(sampleStory()).replace('"schema":3', '"schema":99');
    const result = parseStory(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/newer version/);
  });

  it("keeps the newer copy when a sync merge leaves a card twice", () => {
    const story = sampleStory();
    const card = Object.values(story.cards)[0]!;
    card.modified = "2026-01-01T00:00:00.000Z";
    const text = serializeStory(story);
    const line = text.split("\n").find((l) => l.includes(`"id":"${card.id}"`))!;
    const newer = line.replace(card.title, "Edited on the laptop").replace(card.modified, "2026-02-01T00:00:00.000Z");
    const merged = text.replace(line, `${newer}\n${line}`);
    const parsed = parseOk(merged);
    expect(parsed.story.cards[card.id]!.title).toBe("Edited on the laptop");
    expect(parsed.warnings).toHaveLength(1);
  });

  it("notices when the outline was edited by hand", () => {
    const text = serializeStory(sampleStory());
    expect(outlineWasEdited(parseOk(text))).toBe(false);
    const edited = text.replace("Mara is called out before dawn.", "Mara oversleeps.");
    expect(outlineWasEdited(parseOk(edited))).toBe(true);
  });
});
