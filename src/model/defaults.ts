import { DEFAULT_PALETTE, nextColor } from "./palette";
import { Calendar, Card, STORY_SCHEMA_VERSION, Story } from "./types";

/** The default colour palette; the one in use is a plugin setting (see model/palette.ts). */
export const PALETTE = DEFAULT_PALETTE;

/** Short random ids; unique enough within one story. */
export function newId(prefix: string): string {
  return prefix + Math.random().toString(36).slice(2, 10);
}

/** A Gregorian-style calendar, used as the starting preset for new stories. */
export function gregorianStyleCalendar(): Calendar {
  const months: [string, number][] = [
    ["January", 31], ["February", 28], ["March", 31], ["April", 30],
    ["May", 31], ["June", 30], ["July", 31], ["August", 31],
    ["September", 30], ["October", 31], ["November", 30], ["December", 31],
  ];
  return {
    id: "main",
    name: "Main calendar",
    months: months.map(([name, days]) => ({ name, short: name.slice(0, 3), days })),
    leap: { everyYears: 4, monthIndex: 1, extraDays: 1 },
    weekdays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
    // 1 January 2000 was a Saturday, so weekdays match the real calendar for recent centuries.
    weekAnchor: { year: 2000, month: 1, day: 1, weekdayIndex: 5 },
    hoursPerDay: 24,
    minutesPerHour: 60,
    dayParts: [
      { id: "dawn", name: "Dawn", startHour: 5, endHour: 7 },
      { id: "morning", name: "Morning", startHour: 7, endHour: 12 },
      { id: "afternoon", name: "Afternoon", startHour: 12, endHour: 17 },
      { id: "evening", name: "Evening", startHour: 17, endHour: 21 },
      { id: "night", name: "Night", startHour: 21, endHour: 24 },
    ],
  };
}

/** The Gregorian-style calendar without leap years. */
export function noLeapCalendar(): Calendar {
  const calendar = gregorianStyleCalendar();
  delete calendar.leap;
  return calendar;
}

/** Twelve numbered months of thirty days, with the usual week and parts of the day. */
export function thirtyDayCalendar(): Calendar {
  const calendar = gregorianStyleCalendar();
  delete calendar.leap;
  calendar.months = Array.from({ length: 12 }, (_, i) => ({ name: `Month ${i + 1}`, short: `M${i + 1}`, days: 30 }));
  return calendar;
}

/** A starting point to build an invented calendar from: one month, no week, no named parts of the day. */
export function blankCalendar(): Calendar {
  return { id: "main", name: "Main calendar", months: [{ name: "First month", days: 30 }], hoursPerDay: 24, minutesPerHour: 60 };
}

/** Presets offered in story setup; each is copied into the story, so stories never share a calendar. */
export const CALENDAR_PRESETS: { name: string; create: () => Calendar }[] = [
  { name: "Gregorian-style", create: gregorianStyleCalendar },
  { name: "Gregorian-style without leap years", create: noLeapCalendar },
  { name: "Twelve months of thirty days", create: thirtyDayCalendar },
  { name: "Blank", create: blankCalendar },
];

export function createEmptyStory(title: string): Story {
  const plotLine = { id: newId("p"), name: "Main plot", color: nextColor([]) };
  const chapter = { id: newId("c"), name: "" };
  return {
    schema: STORY_SCHEMA_VERSION,
    title,
    plotLines: [plotLine],
    plotLineCategories: [],
    actsEnabled: true,
    colorByCategory: false,
    acts: [],
    chapters: [chapter],
    characters: [],
    locations: [],
    tags: [],
    tagsEnabled: true,
    calendars: [gregorianStyleCalendar()],
    zones: [],
    cards: {},
  };
}

export function createCard(fields: Pick<Card, "title" | "plotLine" | "chapter" | "order"> & Partial<Card>): Card {
  return {
    id: newId("k"),
    synopsis: "",
    alsoIn: [],
    characters: [],
    written: false,
    tags: [],
    notes: [],
    modified: new Date().toISOString(),
    ...fields,
  };
}

/** True for a card with no title of its own: an empty one, or the "Untitled" earlier versions filled in. */
export function isUntitled(title: string): boolean {
  const t = title.trim();
  return t === "" || t === "Untitled";
}
