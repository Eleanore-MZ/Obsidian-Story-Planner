import { describe, expect, it } from "vitest";
import { formatStoryDate } from "../src/model/calendar";
import { dayPartAt, joinDateParts, splitDate } from "../src/model/dateParts";
import { createEmptyStory } from "../src/model/defaults";
import { Story, StoryDate } from "../src/model/types";

function story(): Story {
  const s = createEmptyStory("Parts");
  s.calendars[0]!.dayParts = [
    { id: "morning", name: "Morning", startHour: 6, endHour: 12 },
    { id: "evening", name: "Evening", startHour: 17, endHour: 22 },
  ];
  return s;
}

const parts = (date: string, clock = "", part = "", partAuto = true) => ({ date, clock, part, partAuto });
const join = (s: Story, p: ReturnType<typeof parts>) => {
  const r = joinDateParts(s, p);
  if (!r.ok) throw new Error(r.error);
  return r.date;
};

describe("a date entered in parts", () => {
  it("reads the date alone, with the month and day optional", () => {
    const s = story();
    expect(join(s, parts("2024/03/02"))).toEqual({ calendar: "main", year: 2024, month: 3, day: 2 });
    expect(join(s, parts("2024/03"))).toEqual({ calendar: "main", year: 2024, month: 3 });
    expect(join(s, parts("2024"))).toEqual({ calendar: "main", year: 2024 });
    expect(join(s, parts(""))).toBeUndefined();
  });

  it("adds the clock time, with the time of day following it and not stored", () => {
    const s = story();
    const date = join(s, parts("2024/03/02", "19:30", "evening", true))!;
    expect(date).toEqual({ calendar: "main", year: 2024, month: 3, day: 2, minutes: 19 * 60 + 30 });
    expect(dayPartAt(s.calendars[0]!, date.minutes!)?.id).toBe("evening");
  });

  it("keeps a time of day the writer picked over the clock's", () => {
    const s = story();
    const date = join(s, parts("2024/03/02", "19:30", "morning", false))!;
    expect(date.dayPart).toBe("morning");
    expect(date.minutes).toBe(19 * 60 + 30);
    expect(formatStoryDate(s, date)).toBe("2024/03/02 Morning 19:30");
    // Picking the clock's own part stores nothing extra.
    expect(join(s, parts("2024/03/02", "19:30", "evening", false))!.dayPart).toBeUndefined();
  });

  it("takes a time of day without a clock time", () => {
    expect(join(story(), parts("2024/03/02", "", "morning", false))).toEqual({ calendar: "main", year: 2024, month: 3, day: 2, dayPart: "morning" });
  });

  it("still reads a time typed into the date field", () => {
    expect(join(story(), parts("2024/03/02 06:15", "19:30"))!.minutes).toBe(6 * 60 + 15);
  });

  it("says what is wrong", () => {
    const s = story();
    expect(joinDateParts(s, parts("2024/03", "10:00")).ok).toBe(false);
    expect(joinDateParts(s, parts("2024/03/02", "25:00")).ok).toBe(false);
    expect(joinDateParts(s, parts("", "10:00")).ok).toBe(false);
  });

  it("splits a stored date back into the fields", () => {
    const s = story();
    const date: StoryDate = { calendar: "main", year: 2024, month: 3, day: 2, minutes: 19 * 60 + 30 };
    expect(splitDate(s, date)).toEqual({ date: "2024/03/02", clock: "19:30", part: "evening", partAuto: true });
    expect(splitDate(s, { ...date, dayPart: "morning" })).toEqual({ date: "2024/03/02", clock: "19:30", part: "morning", partAuto: false });
    expect(splitDate(s, { calendar: "main", year: 2024, month: 3, day: 2, dayPart: "evening" })).toEqual({
      date: "2024/03/02",
      clock: "",
      part: "evening",
      partAuto: false,
    });
    for (const d of [date, { ...date, dayPart: "morning" }]) expect(join(s, splitDate(s, d))).toEqual(d);
  });
});
