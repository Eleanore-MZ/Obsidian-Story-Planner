import { Calendar, Card, STORY_SCHEMA_VERSION, Story } from "./types";

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
    weekAnchor: { year: 1, month: 1, day: 1, weekdayIndex: 0 },
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

export function createEmptyStory(title: string): Story {
  const plotLine = { id: newId("p"), name: "Main plot", color: "#4a90d9" };
  const chapter = { id: newId("c"), name: "Chapter 1" };
  return {
    schema: STORY_SCHEMA_VERSION,
    title,
    plotLines: [plotLine],
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
    status: "idea",
    tags: [],
    notes: [],
    modified: new Date().toISOString(),
    ...fields,
  };
}
