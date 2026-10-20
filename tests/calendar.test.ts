import { describe, expect, it } from "vitest";
import {
  compareDates,
  dateInZone,
  dateProblem,
  dayFromNumber,
  dayNumber,
  daysBetween,
  daysInMonth,
  effectiveZone,
  eraYear,
  formatDateRange,
  formatOffset,
  formatStoryDate,
  lineYear,
  parseClock,
  parseOffset,
  momentOf,
  weekdayOf,
} from "../src/model/calendar";
import { blankCalendar, CALENDAR_PRESETS, createCard, createEmptyStory, gregorianStyleCalendar } from "../src/model/defaults";
import { Calendar, Story, StoryDate } from "../src/model/types";

const d = (year: number, month?: number, day?: number, extra: Partial<StoryDate> = {}): StoryDate => ({
  calendar: "main",
  year,
  month,
  day,
  ...extra,
});

function gregorian(): Story {
  return createEmptyStory("Gregorian");
}

/** The Glass Harbour's calendar: seven months, a five-day week, twenty hours of fifty minutes, and two zones. */
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
        { name: "Deepdark", days: 30 },
        { name: "Turning", days: 5 },
      ],
      leap: { everyYears: 3, monthIndex: 6, extraDays: 1 },
      weekdays: ["Moonday", "Tideday", "Marketday", "Restday", "Fireday"],
      weekAnchor: { year: 1531, month: 1, day: 1, weekdayIndex: 2 },
      hoursPerDay: 20,
      minutesPerHour: 50,
      dayParts: [
        { id: "dawn", name: "Dawn", startHour: 4, endHour: 6 },
        { id: "night", name: "Night", startHour: 15, endHour: 20 },
      ],
    },
  ];
  s.zones = [
    { id: "z1", name: "Harbour Time", offsetMinutes: 0 },
    { id: "z2", name: "Eastern Provinces", offsetMinutes: 150 },
  ];
  s.referenceZone = "z1";
  return s;
}

describe("days and leap years", () => {
  const cal = gregorianStyleCalendar();

  it("gives the leap month its extra day only in leap years", () => {
    expect(daysInMonth(cal, 1532, 2)).toBe(29);
    expect(daysInMonth(cal, 1531, 2)).toBe(28);
    expect(daysInMonth(cal, 1531, 12)).toBe(31);
  });

  it("turns day numbers back into dates, across leap days and before year 1", () => {
    for (const [y, m, day] of [
      [1, 1, 1],
      [1532, 2, 29],
      [1532, 3, 1],
      [1531, 12, 31],
      [0, 12, 31],
      [-4, 2, 29],
      [-700, 7, 15],
    ] as const) {
      expect(dayFromNumber(cal, dayNumber(cal, y, m, day))).toEqual({ year: y, month: m, day });
    }
    expect(dayNumber(cal, 1, 1, 1)).toBe(0);
    expect(dayNumber(cal, 0, 12, 31)).toBe(-1);
  });

  it("counts days between dates", () => {
    expect(daysBetween(gregorian(), d(1531, 12, 4), d(1532, 3, 1))).toBe(27 + 31 + 29 + 1);
    expect(daysBetween(gregorian(), d(1531, 12), d(1532, 3, 1))).toBeUndefined();
  });
});

describe("weekdays", () => {
  it("matches the real calendar for recent dates in the Gregorian-style preset", () => {
    const s = gregorian();
    const cal = s.calendars[0]!;
    expect(cal.weekdays![weekdayOf(cal, d(2000, 1, 1))!]).toBe("Saturday");
    expect(cal.weekdays![weekdayOf(cal, d(2026, 10, 19))!]).toBe("Monday");
  });

  it("follows an invented week from its anchor, backwards too", () => {
    const cal = harbour().calendars[0]!;
    const name = (date: StoryDate) => cal.weekdays![weekdayOf(cal, date)!];
    expect(name(d(1531, 1, 1))).toBe("Marketday");
    expect(name(d(1531, 1, 2))).toBe("Restday");
    expect(name(d(1530, 7, 6))).toBe("Tideday"); // the leap day just before the anchor
    expect(weekdayOf(cal, d(1531, 1))).toBeUndefined();
    expect(weekdayOf(blankCalendar(), d(1, 1, 1))).toBeUndefined();
  });
});

describe("eras", () => {
  const cal: Calendar = {
    ...gregorianStyleCalendar(),
    eras: [
      { id: "bc", name: "BC", countsDown: true },
      { id: "ad", name: "AD", years: 2000 },
      { id: "new", name: "New Era" },
    ],
  };

  it("puts a counting-down era just before the anchor, without needing its length", () => {
    expect(lineYear(cal, "bc", 1)).toBe(0);
    expect(lineYear(cal, "bc", 44)).toBe(-43);
    expect(lineYear(cal, "ad", 1531)).toBe(1531);
    expect(lineYear(cal, undefined, 1531)).toBe(1531);
  });

  it("places a later era after the length of the one before it", () => {
    expect(lineYear(cal, "new", 1)).toBe(2001);
    expect(eraYear(cal, 2001)).toEqual({ era: "new", year: 1 });
    expect(eraYear(cal, 0)).toEqual({ era: "bc", year: 1 });
    expect(eraYear(cal, 2000)).toEqual({ era: "ad", year: 2000 });
  });

  it("sorts 44 BC before 1 BC before 1 AD", () => {
    const s = gregorian();
    s.calendars = [cal];
    const sorted = [d(1, 1, 1, { era: "ad" }), d(1, 1, 1, { era: "bc" }), d(44, 3, 15, { era: "bc" })].sort((a, b) =>
      compareDates(s, a, b),
    );
    expect(sorted.map((x) => `${x.year} ${x.era}`)).toEqual(["44 bc", "1 bc", "1 ad"]);
  });
});

describe("sorting", () => {
  it("puts partial dates before more precise ones in the same span", () => {
    const s = harbour();
    const dates = [
      d(1531, 6, 4, { minutes: 300 }),
      d(1531, 6, 4, { dayPart: "dawn" }),
      d(1531, 6, 4),
      d(1531, 6),
      d(1531),
      d(1530, 7, 6),
    ];
    const sorted = [...dates].sort((a, b) => compareDates(s, a, b));
    expect(sorted.map((x) => formatStoryDate(s, x))).toEqual([
      "1530/07/06",
      "1531",
      "1531/06",
      "1531/06/04",
      "1531/06/04 Dawn",
      "1531/06/04 06:00",
    ]);
  });

  it("orders events in different zones by when they really happened", () => {
    const s = harbour();
    // 07:00 in the east is 04:00 in the harbour (the offset is three hours of fifty minutes), before 05:00 harbour time.
    const east = d(1531, 6, 4, { minutes: 7 * 50, zone: "z2" });
    const harbourFive = d(1531, 6, 4, { minutes: 5 * 50 });
    expect(compareDates(s, east, harbourFive)).toBeLessThan(0);
  });
});

describe("time zones", () => {
  it("converts across midnight, a leap day and the new year", () => {
    const s = harbour();
    // 01:00 on 1 Thaw 1531 in the east is 18:00 on the leap day, 6 Turning 1530, in the harbour.
    const east = d(1531, 1, 1, { minutes: 50, zone: "z2" });
    expect(dateInZone(s, east, "z2", "z1")).toEqual(d(1530, 7, 6, { minutes: 18 * 50, zone: "z1" }));
    // And back again.
    expect(dateInZone(s, d(1530, 7, 6, { minutes: 18 * 50 }), "z1", "z2")).toEqual(east);
  });

  it("treats a part of the day as approximate once it changes zone", () => {
    const s = harbour();
    const dawn = d(1531, 2, 3, { dayPart: "dawn", zone: "z2" });
    expect(momentOf(s, dawn).approximate).toBe(true);
    expect(momentOf(s, { ...dawn, zone: "z1" }).approximate).toBe(false);
    expect(dateInZone(s, dawn, "z2", "z1")).toEqual(d(1531, 2, 3, { minutes: 4 * 50 - 150, zone: "z1" }));
  });

  it("never shifts a date without a time", () => {
    const s = harbour();
    expect(momentOf(s, d(1531, 2, 3, { zone: "z2" })).key).toBe(momentOf(s, d(1531, 2, 3)).key);
  });

  it("resolves a card's zone from the card, its location, its point of view, then the reference zone", () => {
    const s = harbour();
    s.locations = [
      { id: "east", name: "Eastern Provinces", zone: "z2" },
      { id: "manor", name: "Vell Manor", parent: "east" },
      { id: "pier", name: "The pier" },
    ];
    s.characters = [{ id: "ilse", name: "Ilse", color: "#000", zone: "z2" }];
    const card = createCard({ title: "Letter", plotLine: "p", chapter: null, order: 1, date: d(1531, 2, 3, { minutes: 100 }) });
    expect(effectiveZone(s, card)).toEqual({ zone: s.zones[0], source: "reference" });
    card.characters = [{ id: "ilse", role: "pov" }];
    expect(effectiveZone(s, card).source).toBe("character");
    card.location = "manor";
    expect(effectiveZone(s, card)).toEqual({ zone: s.zones[1], source: "location" });
    card.location = "pier";
    expect(effectiveZone(s, card).source).toBe("character");
    card.date!.zone = "z1";
    expect(effectiveZone(s, card)).toEqual({ zone: s.zones[0], source: "card" });
  });
});

describe("checking dates", () => {
  const cal = harbour().calendars[0]!;

  it("accepts valid dates at every precision", () => {
    for (const date of [d(1531), d(1531, 7), d(1530, 7, 6), d(1531, 1, 1, { minutes: 999 }), d(1531, 1, 1, { dayPart: "dawn" })]) {
      expect(dateProblem(cal, date)).toBeNull();
    }
  });

  it("explains what is wrong", () => {
    expect(dateProblem(cal, d(1531, 7, 6))).toBe("Turning has 5 days that year.");
    expect(dateProblem(cal, d(1531, 8))).toBe("The month must be between 1 and 7.");
    expect(dateProblem(cal, d(1531, 1, 1, { minutes: 1000 }))).toBe("The time must be between 00:00 and 19:49.");
    expect(dateProblem(cal, d(1531, undefined, 3))).toBe("A day or time needs a month.");
    expect(dateProblem(cal, d(1531, 1, 1, { dayPart: "noon" }))).toBe("That part of the day is not in the calendar.");
  });
});

describe("presets", () => {
  it("are independent copies", () => {
    const [a, b] = [CALENDAR_PRESETS[0]!.create(), CALENDAR_PRESETS[0]!.create()];
    a.months[0]!.name = "Changed";
    expect(b.months[0]!.name).toBe("January");
  });

  it("have no leap years where they say so", () => {
    const noLeap = CALENDAR_PRESETS[1]!.create();
    expect(daysInMonth(noLeap, 2000, 2)).toBe(28);
    const thirty = CALENDAR_PRESETS[2]!.create();
    expect(thirty.months.every((m) => m.days === 30)).toBe(true);
  });
});

describe("date ranges", () => {
  it("leaves out what the end shares with the start", () => {
    const s = harbour();
    const start = d(1531, 5, 4, { minutes: 300, zone: "z2" });
    expect(formatDateRange(s, start, { ...start })).toBe("1531/05/04 06:00 (Eastern Provinces)");
    expect(formatDateRange(s, start, { ...start, day: 9 })).toBe("1531/05/04 06:00 (Eastern Provinces) – 1531/05/09 06:00");
    expect(formatDateRange(s, start, { ...start, zone: "z1" })).toBe(
      "1531/05/04 06:00 (Eastern Provinces) – 1531/05/04 06:00 (Harbour Time)",
    );
  });
});

describe("reading times and offsets", () => {
  const cal = harbour().calendars[0]!;

  it("reads clock times on a calendar of twenty hours of fifty minutes", () => {
    expect(parseClock(cal, "6:05")).toBe(305);
    expect(parseClock(cal, " 19:49 ")).toBe(999);
    expect(parseClock(cal, "7")).toBe(350);
    expect(parseClock(cal, "20:00")).toBeNull();
    expect(parseClock(cal, "6:50")).toBeNull();
    expect(parseClock(cal, "dawn")).toBeNull();
  });

  it("reads and writes zone offsets", () => {
    expect(parseOffset(cal, "+3:00")).toBe(150);
    expect(parseOffset(cal, "-0:45")).toBe(-45);
    expect(parseOffset(cal, "2")).toBe(100);
    expect(parseOffset(cal, "1:50")).toBeNull();
    expect(formatOffset(cal, 150)).toBe("+3:00");
    expect(formatOffset(cal, -45)).toBe("-0:45");
  });
});
