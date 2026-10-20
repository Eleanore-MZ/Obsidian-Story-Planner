import { describe, expect, it } from "vitest";
import { createCard, createEmptyStory } from "../src/model/defaults";
import { placeLastInTime, reorderInTime, timeSorted } from "../src/model/storyTime";
import { Card, Story, StoryDate } from "../src/model/types";
import { dateSpan } from "../src/model/calendar";
import { bucketDate, computeTimeLayout, describeGap } from "../src/view/timeLayout";

const NOW = "2026-10-19T03:00:00.000Z";
const d = (year: number, month?: number, day?: number, extra: Partial<StoryDate> = {}): StoryDate => ({
  calendar: "main",
  year,
  month,
  day,
  ...extra,
});

function story(): Story {
  const s = createEmptyStory("Time");
  s.plotLines = [
    { id: "p1", name: "A", color: "#000" },
    { id: "p2", name: "B", color: "#111" },
  ];
  s.chapters = [
    { id: "c1", name: "One" },
    { id: "c2", name: "Two" },
  ];
  return s;
}

function add(s: Story, id: string, date: StoryDate | undefined, fields: Partial<Card> = {}): void {
  s.cards[id] = { ...createCard({ title: id, plotLine: "p1", chapter: "c1", order: Object.keys(s.cards).length + 1, date, ...fields }), id };
}

const rowsOf = (s: Story, zoom: Parameters<typeof computeTimeLayout>[1]) => {
  const layout = computeTimeLayout(s, zoom, "vertical");
  const rows = new Map<number, string[]>();
  for (const p of layout.items) {
    const it = p.item;
    const text =
      it.kind === "time-header" ? `[${it.bucket.label}]` : it.kind === "gap" ? `(${it.text})` : it.kind === "card" ? it.cardId : it.kind === "echo" ? `~${it.cardId}` : null;
    if (text) rows.set(p.row, [...(rows.get(p.row) ?? []), text]);
  }
  return [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v.join(" "));
};

describe("story-time layout", () => {
  it("puts cards in story order, not reading order, with gaps between distant spans", () => {
    const s = story();
    add(s, "late", d(1531, 12, 4), { chapter: "c1" });
    add(s, "early", d(1528, 3, 1), { chapter: "c2" });
    add(s, "same-day", d(1531, 12, 4), { chapter: "c2", plotLine: "p2" });
    add(s, "next-day", d(1531, 12, 5));
    expect(rowsOf(s, "day")).toEqual(["[1528/03/01] early", "(3 years later)", "[1531/12/04] late same-day", "[1531/12/05] next-day"]);
  });

  it("groups by the zoom, and stacks cards that share a span in the same plot line", () => {
    const s = story();
    add(s, "a", d(1531, 12, 4));
    add(s, "b", d(1531, 12, 20));
    add(s, "c", d(1532, 2, 1));
    expect(rowsOf(s, "month")).toEqual(["[1531/12] a", "b", "(2 months later)", "[1532/02] c"]);
    expect(rowsOf(s, "year")).toEqual(["[1531] a", "b", "[1532] c"]);
  });

  it("gives a date less precise than the zoom its own span, before the finer spans inside it", () => {
    const s = story();
    add(s, "dated", d(1531, 1, 2));
    add(s, "only-year", d(1531));
    expect(rowsOf(s, "day")).toEqual(["[1531] only-year", "[1531/01/02] dated"]);
  });

  it("shows echoes in their other plot lines", () => {
    const s = story();
    add(s, "a", d(1531), { alsoIn: ["p2"] });
    expect(rowsOf(s, "year")).toEqual(["[1531] a ~a"]);
  });

  it("keeps an echo level with its card, even when its plot line already has cards in that span", () => {
    const s = story();
    add(s, "b1", d(1531), { plotLine: "p2" });
    add(s, "b2", d(1531), { plotLine: "p2" });
    add(s, "a", d(1531), { alsoIn: ["p2"] });
    const layout = computeTimeLayout(s, "year", "vertical");
    const at = (kind: string, id: string) => layout.items.find((p) => p.item.kind === kind && "cardId" in p.item && p.item.cardId === id)!;
    expect(at("echo", "a").row).toBe(at("card", "a").row);
    expect(at("echo", "a").row).toBeGreaterThan(at("card", "b2").row);
  });

  it("ends every span with a slim row of empty cells, so a card can always be added after the others", () => {
    const s = story();
    add(s, "a", d(1531));
    add(s, "b", d(1531), { plotLine: "p2" });
    const layout = computeTimeLayout(s, "year", "vertical");
    const card = layout.items.find((p) => p.item.kind === "card")!;
    const ends = layout.items.filter((p) => p.item.kind === "time-cell" && p.item.end);
    expect(ends).toHaveLength(2);
    expect(ends.every((p) => p.row === card.row + 1)).toBe(true);
  });

  it("puts a card added at a moment after the cards there that have an order of their own", () => {
    const s = story();
    add(s, "a", d(1531, 1, 1));
    add(s, "b", d(1531, 1, 1));
    reorderInTime(s, "b", "a", false, NOW);
    add(s, "new", d(1531, 1, 1), { chapter: null });
    placeLastInTime(s, "new");
    expect(timeSorted(s, Object.values(s.cards)).map((c) => c.id)).toEqual(["b", "a", "new"]);
  });

  it("groups clock times into blocks of the story's length at the clock zoom", () => {
    const s = story();
    add(s, "a", d(2020, 1, 1, { minutes: 9 * 60 + 5 }));
    add(s, "b", d(2020, 1, 1, { minutes: 9 * 60 + 14 }));
    add(s, "c", d(2020, 1, 1, { minutes: 9 * 60 + 20 }));
    expect(rowsOf(s, "clock")).toEqual(["[2020/01/01 09:00] a", "b", "[2020/01/01 09:15] c"]);
    s.timeBlockMinutes = 60;
    expect(rowsOf(s, "clock")).toEqual(["[2020/01/01 09:00] a", "b", "c"]);
  });

  it("shows every span from the first to the last when expanded, without gap markers", () => {
    const s = story();
    add(s, "a", d(2020, 1, 1));
    add(s, "b", d(2020, 1, 4));
    const rows = (expand: boolean) => {
      const layout = computeTimeLayout(s, "day", "vertical", expand);
      return layout.items.filter((p) => p.item.kind === "time-header" || p.item.kind === "gap").map((p) => (p.item.kind === "time-header" ? p.item.bucket.label : "gap"));
    };
    expect(rows(false)).toEqual(["2020/01/01", "gap", "2020/01/04"]);
    expect(rows(true)).toEqual(["2020/01/01", "2020/01/02", "2020/01/03", "2020/01/04"]);
  });

  it("expands down to clock blocks, and keeps a coarser card's own span", () => {
    const s = story();
    s.timeBlockMinutes = 30;
    add(s, "y", d(2020));
    add(s, "a", d(2020, 1, 1, { minutes: 9 * 60 }));
    add(s, "b", d(2020, 1, 1, { minutes: 10 * 60 + 40 }));
    const labels = computeTimeLayout(s, "clock", "vertical", true)
      .items.filter((p) => p.item.kind === "time-header")
      .map((p) => (p.item.kind === "time-header" ? p.item.bucket.label : ""));
    expect(labels).toEqual(["2020", "2020/01/01 09:00", "2020/01/01 09:30", "2020/01/01 10:00", "2020/01/01 10:30"]);
  });

  it("does not expand a timeline too long for the zoom, and says so", () => {
    const s = story();
    add(s, "a", d(2020, 1, 1, { minutes: 60 }));
    add(s, "b", d(2021, 1, 1, { minutes: 60 }));
    const layout = computeTimeLayout(s, "clock", "vertical", true);
    expect(layout.tooLongToExpand).toBe(true);
    expect(layout.buckets).toHaveLength(2);
    expect(computeTimeLayout(s, "month", "vertical", true).tooLongToExpand).toBeUndefined();
  });

  it("lists undated cards in reading order for the tray", () => {
    const s = story();
    add(s, "x", undefined, { chapter: "c2", order: 1 });
    add(s, "y", undefined, { chapter: "c1", order: 5 });
    add(s, "z", d(1531));
    expect(computeTimeLayout(s, "year", "vertical").undated).toEqual(["y", "x"]);
  });

  it("buckets times by the part of the day they fall in, or by the hour", () => {
    const cal = story().calendars[0]!;
    expect(bucketDate(cal, d(1531, 1, 2, { minutes: 6 * 60 + 15 }), "time")).toEqual(d(1531, 1, 2, { dayPart: "dawn" }));
    expect(bucketDate(cal, d(1531, 1, 2, { minutes: 2 * 60 + 15 }), "time")).toEqual(d(1531, 1, 2, { minutes: 120 }));
    expect(bucketDate(cal, d(1531, 1, 2, { minutes: 1 }), "month")).toEqual(d(1531, 1));
  });

  it("places spans on the line of minutes", () => {
    const cal = story().calendars[0]!;
    const [start, end] = dateSpan(cal, d(1532, 2));
    expect((end - start) / (24 * 60)).toBe(29);
    const [dawnStart, dawnEnd] = dateSpan(cal, d(1532, 2, 3, { dayPart: "dawn" }));
    expect(dawnEnd - dawnStart).toBe(2 * 60);
  });

  it("converts times in other zones before placing them", () => {
    const s = story();
    s.zones = [
      { id: "z1", name: "Home", offsetMinutes: 0 },
      { id: "z2", name: "East", offsetMinutes: 180 },
    ];
    s.referenceZone = "z1";
    // 01:00 on 2 January in the east is 22:00 on 1 January at home.
    add(s, "east", d(1531, 1, 2, { minutes: 60, zone: "z2" }));
    add(s, "home", d(1531, 1, 1, { minutes: 23 * 60 }), { plotLine: "p2" });
    expect(rowsOf(s, "day")).toEqual(["[1531/01/01] east home"]);
  });

  it("describes gaps in words", () => {
    const cal = story().calendars[0]!;
    const at = (date: StoryDate) => dateSpan(cal, date)[0];
    expect(describeGap(cal, at(d(1531, 12, 4)), at(d(1534, 12, 3)))).toBe("2 years later");
    expect(describeGap(cal, at(d(1531, 12, 4)), at(d(1532, 1, 4)))).toBe("1 month later");
    expect(describeGap(cal, at(d(1531, 12, 4)), at(d(1531, 12, 6)))).toBe("2 days later");
    expect(describeGap(cal, at(d(1531, 12, 4, { minutes: 60 })), at(d(1531, 12, 4, { minutes: 300 })))).toBe("4 hours later");
  });
});

describe("story order", () => {
  it("keeps the writer's order among cards at the same moment", () => {
    const s = story();
    add(s, "a", d(1531, 12, 4));
    add(s, "b", d(1531, 12, 4));
    add(s, "c", d(1531, 12, 4));
    add(s, "other", d(1531, 12, 5));
    const ids = () => timeSorted(s, Object.values(s.cards)).map((c) => c.id).join();
    expect(ids()).toBe("a,b,c,other");
    expect(reorderInTime(s, "c", "a", false, NOW)).toBe(true);
    expect(ids()).toBe("c,a,b,other");
    expect(s.cards.c!.modified).toBe(NOW);
    expect(reorderInTime(s, "a", "other", false, NOW)).toBe(false);
  });
});

describe("cards that run over several spans", () => {
  const layoutOf = (s: Story, orientation: "vertical" | "horizontal" = "vertical") => computeTimeLayout(s, "day", orientation);
  const find = (s: Story, kind: string, id: string, orientation: "vertical" | "horizontal" = "vertical") =>
    layoutOf(s, orientation).items.find((p) => p.item.kind === kind && "cardId" in p.item && p.item.cardId === id)!;

  it("runs from its own row down to the span of its end, adding a row for the end", () => {
    const s = story();
    add(s, "trip", d(2020, 1, 1), { endDate: d(2020, 1, 5) });
    add(s, "before", d(2019, 12, 30), { plotLine: "p2" });
    const layout = layoutOf(s);
    expect(layout.buckets.map((b) => b.label)).toEqual(["2019/12/30", "2020/01/01", "2020/01/05"]);
    const trip = find(s, "card", "trip");
    const end = layout.items.find((p) => p.item.kind === "time-header" && p.item.bucket.label === "2020/01/05")!;
    // Through the "4 days later" gap to the 5th's row.
    expect(trip.row + trip.span - 1).toBe(end.row);
    expect(layout.items.some((p) => p.item.kind === "gap" && p.row > trip.row && p.row < end.row)).toBe(true);
    expect(trip.depth).toBe(0);
  });

  it("stays a normal card when it starts and ends in the same span", () => {
    const s = story();
    add(s, "day", d(2020, 1, 1, { minutes: 60 }), { endDate: d(2020, 1, 1, { minutes: 600 }) });
    const card = find(s, "card", "day");
    expect(card.span).toBe(1);
    expect(card.item.kind === "card" && card.item.until).toBeUndefined();
  });

  it("puts the cards it runs past on top of it, a step in, and leaves other plot lines alone", () => {
    const s = story();
    add(s, "long", d(2020, 1, 1), { endDate: d(2020, 1, 9) });
    add(s, "middle", d(2020, 1, 4));
    add(s, "after", d(2020, 1, 20));
    add(s, "elsewhere", d(2020, 1, 4), { plotLine: "p2" });
    const long = find(s, "card", "long");
    const middle = find(s, "card", "middle");
    expect([middle.column, middle.depth]).toEqual([long.column, 1]);
    expect(find(s, "card", "after").depth).toBe(0);
    expect(find(s, "card", "elsewhere").depth).toBe(0);
    // Empty space beside it is on top too, so a drop there lands in that row's span.
    const cells = layoutOf(s).items.filter((p) => p.item.kind === "time-cell" && p.column === long.column && p.row > long.row && p.row < long.row + long.span);
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.every((p) => p.depth === 1)).toBe(true);
  });

  it("nests long cards that overlap each other, each a step further in", () => {
    const s = story();
    add(s, "a", d(2020, 1, 1), { endDate: d(2020, 1, 9) });
    add(s, "b", d(2020, 1, 3), { endDate: d(2020, 1, 5) });
    add(s, "inside", d(2020, 1, 5));
    expect(find(s, "card", "a").depth).toBe(0);
    expect(find(s, "card", "b").depth).toBe(1);
    expect(find(s, "card", "inside").depth).toBe(2);
  });

  it("runs its echoes over the same rows", () => {
    const s = story();
    add(s, "trip", d(2020, 1, 1), { endDate: d(2020, 1, 5), alsoIn: ["p2"] });
    const card = find(s, "card", "trip");
    const echo = find(s, "echo", "trip");
    expect([echo.row, echo.span]).toEqual([card.row, card.span]);
  });

  it("runs across, not down, when time runs across", () => {
    const s = story();
    add(s, "trip", d(2020, 1, 1), { endDate: d(2020, 1, 5) });
    const vertical = find(s, "card", "trip");
    const across = find(s, "card", "trip", "horizontal");
    expect(across.span).toBe(vertical.span);
    expect([across.row, across.column]).toEqual([vertical.column, vertical.row]);
  });
});
