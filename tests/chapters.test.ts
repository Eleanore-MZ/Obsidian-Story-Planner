import { describe, expect, it } from "vitest";
import { parseStory, renderOutline, serializeStory } from "../src/format/storyFile";
import {
  actsShown,
  actTitle,
  chapterNumbers,
  chapterTitle,
  deleteAct,
  moveOutlineEntry,
  outlineEntries,
  orderedActs,
  romanNumeral,
  setChapterAct,
  startActAt,
  titleFromOldName,
} from "../src/model/chapters";
import { createEmptyStory } from "../src/model/defaults";
import { Story } from "../src/model/types";
import { computeBoardLayout } from "../src/view/layout";
import { computeMatrix } from "../src/view/trackLayout";

function story(): Story {
  const s = createEmptyStory("Acts");
  s.chapters = [
    { id: "c1", name: "The Pier" },
    { id: "c0", name: "", label: "Prologue" },
    { id: "c2", name: "" },
    { id: "c3", name: "Letters", summary: "Ilse writes home." },
    { id: "c4", name: "The Manor" },
  ];
  return s;
}

describe("chapter numbers and titles", () => {
  it("numbers chapters in order, skipping those with a label", () => {
    const s = story();
    expect([...chapterNumbers(s).entries()]).toEqual([
      ["c1", 1],
      ["c2", 2],
      ["c3", 3],
      ["c4", 4],
    ]);
    expect(s.chapters.map((c) => chapterTitle(s, c))).toEqual([
      "Chapter 1: The Pier",
      "Prologue",
      "Chapter 2",
      "Chapter 3: Letters",
      "Chapter 4: The Manor",
    ]);
    expect(chapterTitle(s, undefined)).toBe("Off-page");
  });

  it("splits the titles out of older chapter names", () => {
    expect(titleFromOldName("Chapter 1")).toBe("");
    expect(titleFromOldName("Chapter 1: The Pier")).toBe("The Pier");
    expect(titleFromOldName("chapter 12 - Letters")).toBe("Letters");
    expect(titleFromOldName("Ch. 3 – The Manor")).toBe("The Manor");
    expect(titleFromOldName("Ch 4—Home")).toBe("Home");
    expect(titleFromOldName("Chapter IV. Home")).toBe("Home");
    expect(titleFromOldName("Prologue")).toBe("Prologue");
    expect(titleFromOldName("Chapters of my life")).toBe("Chapters of my life");
  });
});

describe("acts", () => {
  it("starts an act at a chapter, taking the chapters after it that were in the same act", () => {
    const s = story();
    const first = startActAt(s, "c1", "Arrival")!;
    expect(s.chapters.map((c) => c.act)).toEqual([first, first, first, first, first]);
    const second = startActAt(s, "c3")!;
    expect(s.chapters.map((c) => c.act)).toEqual([first, first, first, second, second]);
    expect(orderedActs(s).map((a) => actTitle(s, a))).toEqual(["Act I: Arrival", "Act II"]);
  });

  it("numbers acts by where their chapters are, and keeps chapters when an act goes", () => {
    const s = story();
    const a = startActAt(s, "c3")!;
    const b = startActAt(s, "c1")!;
    // "b" was added second but its chapters come first, so it is Act I.
    expect(orderedActs(s).map((x) => x.id)).toEqual([b, a]);
    expect(romanNumeral(14)).toBe("XIV");
    expect(setChapterAct(s, "c4", undefined)).toBe(true);
    expect(deleteAct(s, a)).toBe(true);
    expect(s.chapters.find((c) => c.id === "c3")!.act).toBeUndefined();
    expect(s.acts.map((x) => x.id)).toEqual([b]);
  });

  it("runs each act beside its chapters in a column of its own, with a line between acts", () => {
    const s = story();
    const a = startActAt(s, "c1")!;
    const b = startActAt(s, "c3")!;
    const layout = computeBoardLayout(s, "vertical");
    expect(layout.acts).toBe(true);
    const header = (id: string) => layout.items.find((p) => p.item.kind === "chapter-header" && p.item.chapterId === id)!;
    const bands = layout.items.filter((p) => p.item.kind === "act-band");
    expect(bands.map((p) => [p.item.kind === "act-band" && p.item.actId, p.column])).toEqual([
      [a, 1],
      [b, 1],
    ]);
    // Act I runs from chapter 1's header to just before chapter 3's.
    expect(bands[0]!.row).toBe(header("c1").row);
    expect(bands[0]!.row + bands[0]!.span!).toBe(header("c3").row);
    expect(header("c1").column).toBe(2);
    const dividers = layout.items.filter((p) => p.item.kind === "act-divider");
    expect(dividers.map((p) => p.row)).toEqual([header("c3").row]);
  });

  it("gives chapters outside any act an empty act cell, and has no act column without acts", () => {
    const s = story();
    startActAt(s, "c3");
    const bands = computeBoardLayout(s, "vertical").items.filter((p) => p.item.kind === "act-band");
    expect(bands.map((p) => p.item.kind === "act-band" && p.item.actId !== null)).toEqual([false, true]);
    const plain = computeBoardLayout(story(), "vertical");
    expect(plain.acts).toBe(false);
    expect(plain.items.some((p) => p.item.kind === "act-band" || p.item.kind === "act-divider")).toBe(false);
    expect(plain.items.find((p) => p.item.kind === "chapter-header")!.column).toBe(1);
  });
});

describe("acts and chapters in the story file", () => {
  it("survive a save and load", () => {
    const s = story();
    startActAt(s, "c3", "Letters home");
    s.acts[0]!.summary = "Everything goes east.";
    const parsed = parseStory(serializeStory(s));
    expect(parsed.ok && parsed.story).toEqual(s);
  });

  it("puts acts and chapter numbers in the outline, with synopses that cannot make tags or links", () => {
    const s = story();
    startActAt(s, "c3", "Letters home");
    s.chapters[3]!.summary = "#secret [[link]] %% comment";
    const outline = renderOutline(s);
    expect(outline).toContain("### Chapter 1: The Pier");
    expect(outline).toContain("## Act I: Letters home");
    expect(outline).toContain("### Chapter 3: Letters");
    expect(outline).toContain("### Prologue");
    expect(outline).not.toContain("[[link]]");
    expect(outline).not.toContain(" #secret");
    expect(outline).not.toContain("%%");
  });

  it("splits chapter names in stories saved before numbers and titles were separate", () => {
    const s = createEmptyStory("Old");
    s.chapters = [
      { id: "c1", name: "Chapter 1" },
      { id: "c2", name: "Chapter 2: The Pier" },
      { id: "c3", name: "Epilogue" },
    ];
    const old = serializeStory(s).replace('"schema":3', '"schema":1').replace(',"acts":[]', "");
    const parsed = parseStory(old);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.story.chapters.map((c) => c.name)).toEqual(["", "The Pier", "Epilogue"]);
    expect(parsed.story.acts).toEqual([]);
    // Version 2 names are kept as they are, even when they look like old ones.
    const kept = parseStory(serializeStory(s));
    expect(kept.ok && kept.story.chapters.map((c) => c.name)).toEqual(["Chapter 1", "Chapter 2: The Pier", "Epilogue"]);
  });
});

describe("the acts-and-chapters list", () => {
  it("marks each act's start before its first chapter, and empty acts at the end", () => {
    const s = story();
    const a = startActAt(s, "c2")!;
    s.acts.push({ id: "empty" });
    expect(outlineEntries(s).map((e) => (e.kind === "act" ? `act:${e.id === a ? "a" : e.id}` : e.id))).toEqual([
      "c1",
      "c0",
      "act:a",
      "c2",
      "c3",
      "c4",
      "act:empty",
    ]);
  });

  it("moves where an act starts by dragging its marker", () => {
    const s = story();
    const a = startActAt(s, "c3")!;
    // [c1, c0, c2, act a, c3, c4]: move the marker up above c0.
    expect(moveOutlineEntry(s, 3, 1)).toBe(true);
    expect(s.chapters.map((c) => [c.id, c.act ?? "-"])).toEqual([
      ["c1", "-"],
      ["c0", a],
      ["c2", a],
      ["c3", a],
      ["c4", a],
    ]);
  });

  it("gives a chapter dragged past a marker the act it lands in", () => {
    const s = story();
    const a = startActAt(s, "c3")!;
    // Move c1 (index 0) to the end, below the marker.
    expect(moveOutlineEntry(s, 0, 5)).toBe(true);
    expect(s.chapters.map((c) => c.id)).toEqual(["c0", "c2", "c3", "c4", "c1"]);
    expect(s.chapters.find((c) => c.id === "c1")!.act).toBe(a);
    expect(moveOutlineEntry(s, 2, 2)).toBe(false);
  });

  it("puts an empty act's marker into place, so it takes the chapters below it", () => {
    const s = story();
    s.acts.push({ id: "new" });
    // [c1, c0, c2, c3, c4, act new]: move the marker above c3.
    expect(moveOutlineEntry(s, 5, 3)).toBe(true);
    expect(s.chapters.map((c) => c.act ?? "-")).toEqual(["-", "-", "-", "new", "new"]);
  });
});

describe("switching acts off", () => {
  it("hides acts on the board and in the outline, and keeps them for later", () => {
    const s = story();
    const a = startActAt(s, "c3", "Letters home")!;
    s.actsEnabled = false;
    expect(actsShown(s)).toBe(false);
    const layout = computeBoardLayout(s, "vertical");
    expect(layout.acts).toBe(false);
    expect(layout.items.some((p) => p.item.kind === "act-band")).toBe(false);
    const outline = renderOutline(s);
    expect(outline).not.toContain("Act I");
    expect(outline).toContain("## Chapter 3: Letters");
    // The act is still there, and comes back when switched on.
    expect(s.chapters.find((c) => c.id === "c3")!.act).toBe(a);
    s.actsEnabled = true;
    expect(renderOutline(s)).toContain("## Act I: Letters home");
  });

  it("is kept in the story file, and is on in stories saved before it existed", () => {
    const s = story();
    s.actsEnabled = false;
    const parsed = parseStory(serializeStory(s));
    expect(parsed.ok && parsed.story.actsEnabled).toBe(false);
    const old = parseStory(serializeStory(story()).replace(',"actsEnabled":true', ""));
    expect(old.ok && old.story.actsEnabled).toBe(true);
  });
});

describe("the presence matrix's chapters", () => {
  it("are headed by their numbers (or labels), with full titles to hover, and acts above them", () => {
    const s = story();
    const a = startActAt(s, "c3")!;
    const columns = computeMatrix(s, "chapters", "day").columns;
    expect(columns.map((c) => c.label)).toEqual(["1", "Prologue", "2", "3", "4"]);
    expect(columns.map((c) => c.title)).toEqual(["Chapter 1: The Pier", "Prologue", "Chapter 2", "Chapter 3: Letters", "Chapter 4: The Manor"]);
    expect(columns.map((c) => c.act)).toEqual([null, null, null, a, a]);
    s.actsEnabled = false;
    expect(computeMatrix(s, "chapters", "day").columns.every((c) => c.act === undefined)).toBe(true);
  });
});
