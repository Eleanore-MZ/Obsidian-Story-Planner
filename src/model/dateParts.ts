import { clock, formatStoryDate, mainCalendar, parseClock } from "./calendar";
import { ParsedDate, parseStoryDate } from "./dateParse";
import { Calendar, DayPart, Story, StoryDate } from "./types";

// A date entered in three parts, as the card panel shows it: the date itself
// (YYYY/MM/DD, with the month and day optional, or any form the date parser
// reads), a time of day (one of the calendar's day parts), and a clock time.
// The time of day follows the clock unless the writer picks another one; only
// a picked one that differs from the clock's is stored beside the time.

export interface DateParts {
  /** The date without its time, in the story's date format. */
  date: string;
  /** The day part's id, or "" for none. */
  part: string;
  /** True when the day part comes from the clock time rather than the writer's choice. */
  partAuto: boolean;
  /** The clock time as hh:mm, or "". */
  clock: string;
}

/** The calendar's part of the day that a clock time falls in. */
export function dayPartAt(calendar: Calendar, minutes: number): DayPart | undefined {
  const hour = Math.floor(minutes / calendar.minutesPerHour);
  return calendar.dayParts?.find((p) => hour >= p.startHour && hour < p.endHour);
}

/** A stored date split into the three fields. */
export function splitDate(story: Story, date: StoryDate | undefined): DateParts {
  if (!date) return { date: "", part: "", partAuto: true, clock: "" };
  const calendar = mainCalendar(story);
  const bare: StoryDate = { ...date, approximate: false };
  delete bare.minutes;
  delete bare.dayPart;
  const text = formatStoryDate(story, bare, { zone: false });
  if (date.minutes !== undefined) {
    const derived = dayPartAt(calendar, date.minutes)?.id ?? "";
    const part = date.dayPart ?? derived;
    return { date: text, part, partAuto: part === derived, clock: clock(calendar, date.minutes) };
  }
  return { date: text, part: date.dayPart ?? "", partAuto: date.dayPart === undefined, clock: "" };
}

/**
 * Joins the three fields into a date. A time or part of the day typed into
 * the date field itself takes precedence over the other two fields.
 */
export function joinDateParts(story: Story, parts: DateParts, start?: StoryDate): ParsedDate {
  const calendar = mainCalendar(story);
  const parsed = parseStoryDate(story, parts.date, start);
  if (!parsed.ok) return parsed;
  const typedClock = parts.clock.trim();
  if (!parsed.date) {
    if (typedClock || (parts.part && !parts.partAuto)) return { ok: false, error: "Give a date for the time." };
    return parsed;
  }
  const date = { ...parsed.date };
  const fromText = date.minutes !== undefined || date.dayPart !== undefined;
  if (!fromText) {
    if (typedClock) {
      const minutes = parseClock(calendar, typedClock);
      if (minutes === null) return { ok: false, error: `Write the time as hh:mm, up to ${clock(calendar, calendar.hoursPerDay * calendar.minutesPerHour - 1)}.` };
      date.minutes = minutes;
    }
    if (parts.part && (!parts.partAuto || date.minutes === undefined)) date.dayPart = parts.part;
    if ((date.minutes !== undefined || date.dayPart !== undefined) && date.day === undefined) {
      return { ok: false, error: "A time needs a day." };
    }
  }
  // A part of the day that is just the clock's own is not stored.
  if (date.minutes !== undefined && date.dayPart !== undefined && dayPartAt(calendar, date.minutes)?.id === date.dayPart) delete date.dayPart;
  return { ok: true, date };
}
