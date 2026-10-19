import { describe, expect, it } from "vitest";
import { createCard, createEmptyStory } from "../src/model/defaults";
import { cardInterval, findClashes } from "../src/model/storyTime";
import { Card, CardCharacter, Story, StoryDate } from "../src/model/types";
import { computeMatrix, computeTrackLayout } from "../src/view/trackLayout";

const d = (year: number, month?: number, day?: number, extra: Partial<StoryDate> = {}): StoryDate => ({
  calendar: "main",
  year,
  month,
  day,
  ...extra,
});
const at = (hour: number) => ({ minutes: hour * 60 });

function story(): Story {
  const s = createEmptyStory("Track");
  s.plotLines = [
    { id: "p1", name: "A", color: "#000" },
    { id: "p2", name: "B", color: "#111" },
  ];
  s.chapters = [
    { id: "c1", name: "One" },
    { id: "c2", name: "Two" },
  ];
  s.characters = [
    { id: "ann", name: "Ann", color: "#a00" },
    { id: "bo", name: "Bo", color: "#0a0" },
    { id: "cy", name: "Cy", color: "#00a" },
  ];
  s.locations = [
    { id: "city", name: "City" },
    { id: "inn", name: "Inn", parent: "city" },
    { id: "farm", name: "Farm" },
  ];
  return s;
}

const who = (...entries: [string, CardCharacter["role"]][]): CardCharacter[] => entries.map(([id, role]) => ({ id, role }));

function add(s: Story, id: string, fields: Partial<Card> = {}): void {
  s.cards[id] = { ...createCard({ title: id, plotLine: "p1", chapter: "c1", order: Object.keys(s.cards).length + 1, ...fields }), id };
}

/** The track as text, one line per row: lane by lane, "." for an empty cell. */
function track(s: Story, ids: string[], axis: "chapters" | "time", zoom: "year" | "month" | "day" | "time" = "day"): string[] {
  const layout = computeTrackLayout(s, ids, axis, zoom, "vertical");
  const grid: string[][] = Array.from({ length: layout.rows }, () => Array.from({ length: layout.columns }, () => ""));
  for (const p of layout.items) {
    const it = p.item;
    const text =
      it.kind === "corner"
        ? "#"
        : it.kind === "character-header"
          ? it.characterId
          : it.kind === "chapter-header"
            ? `[${it.chapterId ?? "off"}]`
            : it.kind === "time-header"
              ? `[${it.bucket.label}]`
              : it.kind === "gap"
                ? `(${it.text})`
                : it.kind === "appearance"
                  ? it.cardId
                  : ".";
    grid[p.row - 1]![p.column - 1] = text;
  }
  return grid.map((row) => row.filter((c) => c !== "").join(" "));
}

describe("character track", () => {
  it("shows each card in the lane of every chosen character, by chapter", () => {
    const s = story();
    add(s, "meet", { characters: who(["ann", "pov"], ["bo", "present"]) });
    add(s, "alone", { characters: who(["bo", "present"]) });
    add(s, "later", { chapter: "c2", characters: who(["ann", "mentioned"]) });
    add(s, "nobody", { chapter: "c2" });
    expect(track(s, ["ann", "bo"], "chapters")).toEqual(["# ann bo", "[c1] meet meet", ". alone", "[c2] later ."]);
    expect(computeTrackLayout(s, ["ann", "bo"], "chapters", "day", "vertical").hidden).toBe(1);
  });

  it("keeps scenes that share a board row together unless they share a character", () => {
    const s = story();
    add(s, "x", { order: 1, characters: who(["ann", "present"]) });
    add(s, "y", { order: 1, plotLine: "p2", characters: who(["bo", "present"]) });
    add(s, "z", { order: 1, plotLine: "p2", characters: who(["ann", "present"]) });
    expect(track(s, ["ann", "bo"], "chapters")).toEqual(["# ann bo", "[c1] x y", "z .", "[c2] . ."]);
  });

  it("gives an empty chapter an empty row and leaves out an empty off-page group", () => {
    const s = story();
    add(s, "x", { chapter: "c2", characters: who(["ann", "present"]) });
    expect(track(s, ["ann"], "chapters")).toEqual(["# ann", "[c1] .", "[c2] x"]);
  });

  it("runs along story time, with gaps, leaving undated cards out", () => {
    const s = story();
    add(s, "b", { date: d(1531, 12, 4), characters: who(["ann", "present"], ["bo", "present"]) });
    add(s, "a", { date: d(1528, 3, 1), characters: who(["bo", "present"]) });
    add(s, "c", { date: d(1531, 12, 4), characters: who(["ann", "present"]) });
    add(s, "undated", { characters: who(["ann", "present"]) });
    expect(track(s, ["ann", "bo"], "time")).toEqual([
      "# ann bo",
      "[1528/03/01] . a",
      "(3 years later)",
      "[1531/12/04] b b",
      "c .",
    ]);
  });

  it("transposes, with characters as rows", () => {
    const s = story();
    add(s, "x", { characters: who(["ann", "present"]) });
    const layout = computeTrackLayout(s, ["ann", "bo"], "chapters", "day", "horizontal");
    expect([layout.rows, layout.columns]).toEqual([3, 3]);
    const x = layout.items.find((p) => p.item.kind === "appearance")!;
    expect([x.row, x.column]).toEqual([2, 2]);
  });
});

describe("presence matrix", () => {
  it("marks the strongest role per chapter and counts appearances", () => {
    const s = story();
    add(s, "one", { characters: who(["ann", "mentioned"]) });
    add(s, "two", { characters: who(["ann", "pov"], ["bo", "present"]) });
    add(s, "three", { chapter: null, characters: who(["bo", "mentioned"]) });
    const m = computeMatrix(s, "chapters", "day");
    expect(m.columns.map((c) => c.label)).toEqual(["One", "Two", "Off-page"]);
    const row = (id: string) => m.rows.find((r) => r.characterId === id)!;
    expect(row("ann").cells.map((c) => c.role ?? "-")).toEqual(["pov", "-", "-"]);
    expect(row("ann").cells[0]!.cards).toEqual(["one", "two"]);
    expect(row("bo").cells.map((c) => c.role ?? "-")).toEqual(["present", "-", "mentioned"]);
    expect(row("cy").total).toBe(0);
  });

  it("uses spans of time as columns along story time", () => {
    const s = story();
    add(s, "b", { date: d(1532, 1, 2), characters: who(["ann", "present"]) });
    add(s, "a", { date: d(1531, 5, 2), characters: who(["ann", "present"]) });
    add(s, "u", { characters: who(["ann", "present"]) });
    const m = computeMatrix(s, "time", "year");
    expect(m.columns.map((c) => c.label)).toEqual(["1531", "1532"]);
    expect(m.rows[0]!.total).toBe(2);
  });

  it("flags clashes in their cells", () => {
    const s = story();
    add(s, "x", { date: d(1531, 1, 1, at(9)), location: "inn", characters: who(["ann", "present"]) });
    add(s, "y", { chapter: "c2", date: d(1531, 1, 1, at(9)), location: "farm", characters: who(["ann", "present"]) });
    const m = computeMatrix(s, "chapters", "day");
    expect(m.clashCount).toBe(1);
    expect(m.rows[0]!.cells.map((c) => c.clashes)).toEqual([["x"], ["y"]]);
  });
});

describe("clashes", () => {
  it("gives cards a stretch of time only when it is definite", () => {
    const s = story();
    const card = (date: StoryDate, endDate?: StoryDate) => ({ ...createCard({ title: "", plotLine: "p1", chapter: "c1", order: 1, date, endDate }) });
    expect(cardInterval(s, card(d(1531, 1, 1)))).toBeUndefined();
    const [a, b] = cardInterval(s, card(d(1531, 1, 1, at(9))))!;
    expect(b - a).toBe(60);
    const [c, e] = cardInterval(s, card(d(1531, 1, 1, { dayPart: "morning" })))!;
    expect(e - c).toBe(5 * 60);
    const [f, g] = cardInterval(s, card(d(1531, 1, 1), d(1531, 1, 3)))!;
    expect(g - f).toBe(3 * 24 * 60);
    expect(cardInterval(s, card(d(1531, 1), d(1531, 2)))).toBeUndefined();
  });

  it("finds a character in two places at once", () => {
    const s = story();
    add(s, "inn", { date: d(1531, 1, 1, at(9)), location: "inn", characters: who(["ann", "present"], ["bo", "present"]) });
    add(s, "farm", { date: d(1531, 1, 1, { dayPart: "morning" }), location: "farm", characters: who(["ann", "pov"], ["bo", "mentioned"]) });
    expect(findClashes(s)).toEqual([{ characterId: "ann", cards: ["farm", "inn"] }]);
  });

  it("allows places inside each other, different times, and day-only cards", () => {
    const s = story();
    add(s, "inn", { date: d(1531, 1, 1, at(9)), location: "inn", characters: who(["ann", "present"]) });
    add(s, "city", { date: d(1531, 1, 1, at(9)), location: "city", characters: who(["ann", "present"]) });
    add(s, "farm-later", { date: d(1531, 1, 1, at(10)), location: "farm", characters: who(["ann", "present"]) });
    add(s, "farm-day", { date: d(1531, 1, 1), location: "farm", characters: who(["ann", "present"]) });
    expect(findClashes(s)).toEqual([]);
  });

  it("converts zones before comparing", () => {
    const s = story();
    s.zones = [
      { id: "z1", name: "Home", offsetMinutes: 0 },
      { id: "z2", name: "East", offsetMinutes: 180 },
    ];
    s.referenceZone = "z1";
    add(s, "home", { date: d(1531, 1, 1, at(9)), location: "inn", characters: who(["ann", "present"]) });
    add(s, "east", { date: d(1531, 1, 1, { ...at(12), zone: "z2" }), location: "farm", characters: who(["ann", "present"]) });
    expect(findClashes(s)).toHaveLength(1);
    s.cards.east!.date = d(1531, 1, 1, { ...at(9), zone: "z2" });
    expect(findClashes(s)).toEqual([]);
  });

  it("covers the whole stay of a card with an end date", () => {
    const s = story();
    add(s, "trip", { date: d(1531, 1, 1), endDate: d(1531, 1, 5), location: "farm", characters: who(["bo", "present"]) });
    add(s, "visit", { date: d(1531, 1, 3, at(15)), location: "inn", characters: who(["bo", "present"]) });
    expect(findClashes(s)).toEqual([{ characterId: "bo", cards: ["trip", "visit"] }]);
  });
});

describe("shared scenes", () => {
  it("shows only the scenes every chosen character is in", () => {
    const s = story();
    add(s, "both", { characters: who(["ann", "present"], ["bo", "present"]) });
    add(s, "ann-only", { characters: who(["ann", "present"]) });
    const layout = computeTrackLayout(s, ["ann", "bo"], "chapters", "day", "vertical", true);
    expect(layout.items.filter((p) => p.item.kind === "appearance").map((p) => (p.item as { cardId: string }).cardId)).toEqual(["both", "both"]);
    expect(layout.hidden).toBe(1);
  });
});
