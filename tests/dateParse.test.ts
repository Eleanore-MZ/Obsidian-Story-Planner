import { describe, expect, it } from "vitest";
import { parseStoryDate } from "../src/model/dateParse";
import { createEmptyStory } from "../src/model/defaults";
import { Story, StoryDate } from "../src/model/types";

const gregorian = () => createEmptyStory("Dates");

/** An invented calendar with eras, named times of day and zones. */
function harbour(): Story {
  const s = createEmptyStory("Harbour");
  s.calendars = [
    {
      id: "main",
      name: "Harbour reckoning",
      months: [
        { name: "Thaw", days: 40 },
        { name: "Sowing", days: 40 },
        { name: "Highsun", days: 45 },
        { name: "Reaping", days: 40 },
        { name: "Frost", days: 35 },
      ],
      eras: [{ id: "af", name: "AF" }],
      hoursPerDay: 20,
      minutesPerHour: 50,
      dayParts: [
        { id: "dawn", name: "Dawn", startHour: 4, endHour: 6 },
        { id: "dusk", name: "Dusk", startHour: 13, endHour: 15 },
      ],
    },
  ];
  s.zones = [
    { id: "z1", name: "Harbour Time", offsetMinutes: 0 },
    { id: "z2", name: "Eastern Provinces", offsetMinutes: 150 },
  ];
  return s;
}

const read = (s: Story, text: string, start?: StoryDate) => {
  const r = parseStoryDate(s, text, start);
  return r.ok ? r.date : r.error;
};
const d = (year: number, month?: number, day?: number, extra: Partial<StoryDate> = {}): StoryDate => {
  const date: StoryDate = { calendar: "main", year, ...extra };
  if (month !== undefined) date.month = month;
  if (day !== undefined) date.day = day;
  return date;
};

describe("typed dates", () => {
  it("reads the format's own way of writing a date, with or without a time", () => {
    const s = gregorian();
    expect(read(s, "2020/07/12")).toEqual(d(2020, 7, 12));
    expect(read(s, "2020/07/12 19:49")).toEqual(d(2020, 7, 12, { minutes: 19 * 60 + 49 }));
    expect(read(s, "2020/07")).toEqual(d(2020, 7));
    expect(read(s, "1531")).toEqual(d(1531));
  });

  it("reads digits typed without separators, as date fields on websites do", () => {
    const s = gregorian();
    expect(read(s, "20200712")).toEqual(d(2020, 7, 12));
    expect(read(s, "202007")).toEqual(d(2020, 7));
    expect(read(s, "20200712 1949")).toEqual(d(2020, 7, 12, { minutes: 19 * 60 + 49 }));
  });

  it("takes any separator, and single digits", () => {
    const s = gregorian();
    expect(read(s, "2020-7-12")).toEqual(d(2020, 7, 12));
    expect(read(s, "2020.7.2")).toEqual(d(2020, 7, 2));
    expect(read(s, " 2020 7 12 9:05 ")).toEqual(d(2020, 7, 12, { minutes: 9 * 60 + 5 }));
  });

  it("reads month names in full, short or by their first letters, in any order", () => {
    const s = gregorian();
    expect(read(s, "12 Jul 2020")).toEqual(d(2020, 7, 12));
    expect(read(s, "July 12 2020")).toEqual(d(2020, 7, 12));
    expect(read(s, "september 2023")).toEqual(d(2023, 9));
    expect(read(s, "12 sept 2020")).toEqual(d(2020, 9, 12));
  });

  it("follows the story's date format for numbers without names", () => {
    const s = gregorian();
    s.dateFormat = "DD.MM.YYYY";
    expect(read(s, "12.07.2020")).toEqual(d(2020, 7, 12));
    expect(read(s, "12072020")).toEqual(d(2020, 7, 12));
    expect(read(s, "07.2020")).toEqual(d(2020, 7));
  });

  it("reads approximate dates, times of day, eras and zones", () => {
    const s = harbour();
    expect(read(s, "~2023/03")).toEqual(d(2023, 3, undefined, { approximate: true }));
    expect(read(s, "around 1531")).toEqual(d(1531, undefined, undefined, { approximate: true }));
    expect(read(s, "4 Frost 1531 AF dawn")).toEqual(d(1531, 5, 4, { era: "af", dayPart: "dawn" }));
    expect(read(s, "1531/05/04 Dusk (Eastern Provinces)")).toEqual(d(1531, 5, 4, { dayPart: "dusk", zone: "z2" }));
    // Twenty hours of fifty minutes: 19:49 is the last minute of the day.
    expect(read(s, "1531/05/04 19:49")).toEqual(d(1531, 5, 4, { minutes: 19 * 50 + 49 }));
  });

  it("counts an end date on from the start", () => {
    const s = gregorian();
    const start = d(2020, 1, 30, { minutes: 22 * 60 });
    expect(read(s, "+3d", start)).toEqual(d(2020, 2, 2, { minutes: 22 * 60 }));
    expect(read(s, "+2w", start)).toEqual(d(2020, 2, 13, { minutes: 22 * 60 }));
    expect(read(s, "+1m", start)).toEqual(d(2020, 2, 29, { minutes: 22 * 60 }));
    expect(read(s, "+1y", start)).toEqual(d(2021, 1, 30, { minutes: 22 * 60 }));
    expect(read(s, "+5h", start)).toEqual(d(2020, 1, 31, { minutes: 3 * 60 }));
    expect(read(s, "+3d")).toBe("Only an end date can count on from the start.");
  });

  it("is empty for no date, and says what is wrong otherwise", () => {
    const s = gregorian();
    expect(read(s, "  ")).toBeUndefined();
    expect(read(s, "July 12")).toBe("Give a year.");
    expect(read(s, "2020/13/01")).toMatch(/month/i);
    expect(read(s, "2020/02/30")).toMatch(/day/i);
    expect(read(s, "2020/07/12 25:00")).toMatch(/time/i);
    expect(read(s, "2020 Smarch 3")).toBe('"Smarch" is not a month, era or time of day here.');
    expect(read(s, "2020/7/12/4")).toBe("There are more numbers than a date has.");
    expect(read(s, "2020 19:00")).toBe("A time needs a day.");
  });
});
