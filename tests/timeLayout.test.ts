import { describe, expect, it } from "vitest";
import { createCard, createEmptyStory } from "../src/model/defaults";
import { reorderInTime, timeSorted } from "../src/model/storyTime";
import { Card, Story, StoryDate } from "../src/model/types";
import { bucketDate, computeTimeLayout, describeGap, spanOf } from "../src/view/timeLayout";

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
    expect(rowsOf(s, "day")).toEqual(["[1 March 1528] early", "(3 years later)", "[4 December 1531] late same-day", "[5 December 1531] next-day"]);
  });

  it("groups by the zoom, and stacks cards that share a span in the same plot line", () => {
    const s = story();
    add(s, "a", d(1531, 12, 4));
    add(s, "b", d(1531, 12, 20));
    add(s, "c", d(1532, 2, 1));
    expect(rowsOf(s, "month")).toEqual(["[December 1531] a", "b", "(2 months later)", "[February 1532] c"]);
    expect(rowsOf(s, "year")).toEqual(["[1531] a", "b", "[1532] c"]);
  });

  it("gives a date less precise than the zoom its own span, before the finer spans inside it", () => {
    const s = story();
    add(s, "dated", d(1531, 1, 2));
    add(s, "only-year", d(1531));
    expect(rowsOf(s, "day")).toEqual(["[1531] only-year", "[2 January 1531] dated"]);
  });

  it("shows echoes in their other plot lines", () => {
    const s = story();
    add(s, "a", d(1531), { alsoIn: ["p2"] });
    expect(rowsOf(s, "year")).toEqual(["[1531] a ~a"]);
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
    const [start, end] = spanOf(cal, d(1532, 2));
    expect((end - start) / (24 * 60)).toBe(29);
    const [dawnStart, dawnEnd] = spanOf(cal, d(1532, 2, 3, { dayPart: "dawn" }));
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
    expect(rowsOf(s, "day")).toEqual(["[1 January 1531] east home"]);
  });

  it("describes gaps in words", () => {
    const cal = story().calendars[0]!;
    const at = (date: StoryDate) => spanOf(cal, date)[0];
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
