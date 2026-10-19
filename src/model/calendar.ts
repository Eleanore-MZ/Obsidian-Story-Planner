import { Calendar, CalendarEra, Card, Id, Story, StoryDate, TimeZone } from "./types";

// Story dates on the story's own calendar: formatting, checking, and the
// arithmetic behind story time. Nothing here uses real-world dates; a day is
// whatever the calendar says it is.
//
// Every date becomes a point on one line of minutes (its "key"), counted from
// the first moment of year 1 of the anchor era in the reference zone. Year 1
// of the anchor era is the first year of the first era that counts up, or
// simply year 1 when the calendar has no eras. Years before it are 0, -1, and
// so on, so a counting-down era like "BC" just before the anchor fits on the
// same line: 1 BC is year 0, 2 BC is year -1.

/** Assumed length of an era whose length the writer has not given, so later eras still sort after it. */
export const DEFAULT_ERA_YEARS = 10000;

export function findCalendar(story: Story, id: string): Calendar | undefined {
  return story.calendars.find((c) => c.id === id);
}

/** The story's main calendar; every story has one. */
export function mainCalendar(story: Story): Calendar {
  return story.calendars[0]!;
}

export function minutesPerDay(calendar: Calendar): number {
  return calendar.hoursPerDay * calendar.minutesPerHour;
}

// ---------------------------------------------------------------------------
// Years and leap years

/** Whether a year (counted on the anchor era's line) is a leap year. */
export function isLeapYear(calendar: Calendar, year: number): boolean {
  const leap = calendar.leap;
  return !!leap && leap.everyYears > 0 && mod(year, leap.everyYears) === 0;
}

/** Days in a month (1-based) of a year counted on the anchor era's line. */
export function daysInMonth(calendar: Calendar, year: number, month: number): number {
  const base = calendar.months[month - 1]?.days ?? 0;
  const leap = calendar.leap;
  return leap && leap.monthIndex === month - 1 && isLeapYear(calendar, year) ? base + leap.extraDays : base;
}

export function daysInYear(calendar: Calendar, year: number): number {
  return baseYearLength(calendar) + (isLeapYear(calendar, year) ? leapExtra(calendar) : 0);
}

/** Days from the first day of year 1 to the first day of `year` (negative before year 1). */
export function daysBeforeYear(calendar: Calendar, year: number): number {
  const leap = calendar.leap;
  const leapDays = leap && leap.everyYears > 0 ? leapExtra(calendar) * Math.floor((year - 1) / leap.everyYears) : 0;
  return (year - 1) * baseYearLength(calendar) + leapDays;
}

function baseYearLength(calendar: Calendar): number {
  return calendar.months.reduce((sum, m) => sum + m.days, 0);
}

/** Leap days only count when the leap month exists. */
function leapExtra(calendar: Calendar): number {
  const leap = calendar.leap;
  return leap && calendar.months[leap.monthIndex] ? leap.extraDays : 0;
}

// ---------------------------------------------------------------------------
// Eras

/** Where each era sits on the anchor era's line of years: from `first` up to, not including, `end`. */
interface EraSpan {
  era: CalendarEra;
  first: number;
  end: number;
}

function eraSpans(calendar: Calendar): EraSpan[] {
  const eras = calendar.eras ?? [];
  if (eras.length === 0) return [];
  // The anchor is the first era that counts up; when every era counts down, the last one ends just before year 1.
  let anchor = eras.findIndex((e) => !e.countsDown);
  const lengthOf = (e: CalendarEra) => (e.years && e.years > 0 ? e.years : DEFAULT_ERA_YEARS);
  const spans: EraSpan[] = new Array(eras.length);
  if (anchor === -1) {
    anchor = eras.length - 1;
    spans[anchor] = { era: eras[anchor]!, first: 1 - lengthOf(eras[anchor]!), end: 1 };
  } else {
    spans[anchor] = { era: eras[anchor]!, first: 1, end: 1 + lengthOf(eras[anchor]!) };
  }
  for (let i = anchor + 1; i < eras.length; i++) {
    const first = spans[i - 1]!.end;
    spans[i] = { era: eras[i]!, first, end: first + lengthOf(eras[i]!) };
  }
  for (let i = anchor - 1; i >= 0; i--) {
    const end = spans[i + 1]!.first;
    const era = eras[i]!;
    // The earliest era needs no length when it counts down: it simply ends where the next begins.
    const first = i === 0 && era.countsDown && !era.years ? Number.NEGATIVE_INFINITY : end - lengthOf(era);
    spans[i] = { era, first, end };
  }
  return spans;
}

/** The year on the anchor era's line for a year as written in an era. */
export function lineYear(calendar: Calendar, era: Id | undefined, year: number): number {
  const span = spanOf(calendar, era);
  if (!span) return year;
  // Counting down, year 1 is the era's last year.
  return span.era.countsDown ? span.end - year : span.first + year - 1;
}

/** The era and year as written for a year on the anchor era's line. */
export function eraYear(calendar: Calendar, line: number): { era?: Id; year: number } {
  const spans = eraSpans(calendar);
  if (spans.length === 0) return { year: line };
  const span = spans.find((s) => line >= s.first && line < s.end) ?? (line < spans[0]!.first ? spans[0]! : spans[spans.length - 1]!);
  return { era: span.era.id, year: span.era.countsDown ? span.end - line : line - span.first + 1 };
}

function spanOf(calendar: Calendar, era: Id | undefined): EraSpan | undefined {
  const spans = eraSpans(calendar);
  if (spans.length === 0) return undefined;
  if (era !== undefined) {
    const found = spans.find((s) => s.era.id === era);
    if (found) return found;
  }
  // A date without an era is in the anchor era.
  return spans.find((s) => !s.era.countsDown) ?? spans[spans.length - 1];
}

// ---------------------------------------------------------------------------
// Days

/** Day number of a day: 0 is the first day of year 1 of the anchor era. */
export function dayNumber(calendar: Calendar, lineYearValue: number, month: number, day: number): number {
  let days = daysBeforeYear(calendar, lineYearValue);
  for (let m = 1; m < month; m++) days += daysInMonth(calendar, lineYearValue, m);
  return days + day - 1;
}

/** The line year, month and day of a day number. */
export function dayFromNumber(calendar: Calendar, n: number): { year: number; month: number; day: number } {
  const yearLength = baseYearLength(calendar) || 1;
  // Estimate the year, then correct it; leap days can move the estimate by one at most per cycle.
  let year = Math.floor(n / (yearLength + averageLeap(calendar))) + 1;
  while (daysBeforeYear(calendar, year) > n) year--;
  while (daysBeforeYear(calendar, year + 1) <= n) year++;
  let rest = n - daysBeforeYear(calendar, year);
  let month = 1;
  while (month < calendar.months.length && rest >= daysInMonth(calendar, year, month)) {
    rest -= daysInMonth(calendar, year, month);
    month++;
  }
  return { year, month, day: rest + 1 };
}

function averageLeap(calendar: Calendar): number {
  const leap = calendar.leap;
  return leap && leap.everyYears > 0 ? leapExtra(calendar) / leap.everyYears : 0;
}

/** The weekday index of a date, or undefined when the world has no week or the date has no day. */
export function weekdayOf(calendar: Calendar, date: StoryDate): number | undefined {
  const weekdays = calendar.weekdays;
  if (!weekdays || weekdays.length === 0 || date.month === undefined || date.day === undefined) return undefined;
  const anchor = calendar.weekAnchor ?? { year: 1, month: 1, day: 1, weekdayIndex: 0 };
  const day = dayNumber(calendar, lineYear(calendar, date.era, date.year), date.month, date.day);
  const anchorDay = dayNumber(calendar, lineYear(calendar, undefined, anchor.year), anchor.month, anchor.day);
  return mod(day - anchorDay + anchor.weekdayIndex, weekdays.length);
}

// ---------------------------------------------------------------------------
// Checking dates

/** What is wrong with a date on this calendar, or null when it is valid. */
export function dateProblem(calendar: Calendar, date: StoryDate): string | null {
  if (!Number.isInteger(date.year)) return "The year must be a whole number.";
  if (date.era !== undefined && !(calendar.eras ?? []).some((e) => e.id === date.era)) return "That era is not in the calendar.";
  if (date.month === undefined) {
    if (date.day !== undefined || date.minutes !== undefined || date.dayPart !== undefined) return "A day or time needs a month.";
    return null;
  }
  if (!Number.isInteger(date.month) || date.month < 1 || date.month > calendar.months.length) {
    return `The month must be between 1 and ${calendar.months.length}.`;
  }
  if (date.day === undefined) {
    if (date.minutes !== undefined || date.dayPart !== undefined) return "A time needs a day.";
    return null;
  }
  const length = daysInMonth(calendar, lineYear(calendar, date.era, date.year), date.month);
  if (!Number.isInteger(date.day) || date.day < 1 || date.day > length) {
    return `${calendar.months[date.month - 1]!.name} has ${length} days that year.`;
  }
  if (date.minutes !== undefined && date.dayPart !== undefined) return "A date has either a clock time or a part of the day, not both.";
  if (date.minutes !== undefined && (!Number.isInteger(date.minutes) || date.minutes < 0 || date.minutes >= minutesPerDay(calendar))) {
    return `The time must be between 00:00 and ${clock(calendar, minutesPerDay(calendar) - 1)}.`;
  }
  if (date.dayPart !== undefined && !(calendar.dayParts ?? []).some((p) => p.id === date.dayPart)) {
    return "That part of the day is not in the calendar.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Sorting and time zones

/** How precisely a date is known, from least to most precise. */
export type Precision = "year" | "month" | "day" | "dayPart" | "time";
const PRECISION_RANK: Record<Precision, number> = { year: 0, month: 1, day: 2, dayPart: 3, time: 4 };

export function precisionOf(date: StoryDate): Precision {
  if (date.month === undefined) return "year";
  if (date.day === undefined) return "month";
  if (date.minutes !== undefined) return "time";
  if (date.dayPart !== undefined) return "dayPart";
  return "day";
}

/** A date placed on the story's line of minutes, in the reference zone. */
export interface Moment {
  /** Minutes since the first moment of year 1 of the anchor era, in the reference zone. */
  key: number;
  precision: Precision;
  /** True when the position is only roughly right: a part of the day moved to another zone, or an approximate date. */
  approximate: boolean;
}

/**
 * Places a date on the line. A partial date sits at the start of its span
 * (a year at its first moment), and a part of the day at its first hour.
 * A zone shifts only dates that have a time; a whole day cannot move.
 */
export function momentOf(story: Story, date: StoryDate, zone: Id | undefined = date.zone): Moment {
  const calendar = findCalendar(story, date.calendar) ?? mainCalendar(story);
  const precision = precisionOf(date);
  const line = lineYear(calendar, date.era, date.year);
  const day = dayNumber(calendar, line, date.month ?? 1, date.day ?? 1);
  let minute = 0;
  if (precision === "time") minute = date.minutes!;
  if (precision === "dayPart") {
    const part = calendar.dayParts?.find((p) => p.id === date.dayPart);
    minute = (part?.startHour ?? 0) * calendar.minutesPerHour;
  }
  const offset = precision === "time" || precision === "dayPart" ? zoneOffset(story, zone) : 0;
  return {
    key: day * minutesPerDay(calendar) + minute - offset,
    precision,
    approximate: !!date.approximate || (precision === "dayPart" && offset !== 0),
  };
}

/**
 * Compares two dates in story order: by moment, then less precise first
 * (so "December 1531" comes before "4 December 1531").
 */
export function compareDates(story: Story, a: StoryDate, b: StoryDate, zoneA?: Id, zoneB?: Id): number {
  const ma = momentOf(story, a, zoneA ?? a.zone);
  const mb = momentOf(story, b, zoneB ?? b.zone);
  return ma.key - mb.key || PRECISION_RANK[ma.precision] - PRECISION_RANK[mb.precision];
}

/** Offset of a zone from the reference zone in minutes; 0 for the reference zone or an unknown zone. */
export function zoneOffset(story: Story, zone: Id | undefined): number {
  if (!zone || zone === story.referenceZone) return 0;
  return story.zones.find((z) => z.id === zone)?.offsetMinutes ?? 0;
}

/** Where a card's zone came from, in the order the design gives. */
export type ZoneSource = "card" | "location" | "character" | "reference";

/**
 * The zone in effect for a card: its own, else its location's (inherited
 * from enclosing locations), else its point-of-view character's, else the
 * reference zone (undefined when the story has no zones).
 */
export function effectiveZone(story: Story, card: Card): { zone: TimeZone | undefined; source: ZoneSource } {
  const byId = (id: Id | undefined) => (id ? story.zones.find((z) => z.id === id) : undefined);
  const own = byId(card.date?.zone);
  if (own) return { zone: own, source: "card" };
  const seen = new Set<Id>();
  let place = card.location ? story.locations.find((l) => l.id === card.location) : undefined;
  while (place && !seen.has(place.id)) {
    seen.add(place.id);
    const zone = byId(place.zone);
    if (zone) return { zone, source: "location" };
    place = place.parent ? story.locations.find((l) => l.id === place!.parent) : undefined;
  }
  const pov = card.characters.find((c) => c.role === "pov");
  const povZone = byId(story.characters.find((c) => c.id === pov?.id)?.zone);
  if (povZone) return { zone: povZone, source: "character" };
  return { zone: byId(story.referenceZone), source: "reference" };
}

/** A card's moment, using the zone in effect for it. */
export function cardMoment(story: Story, card: Card): Moment | undefined {
  if (!card.date) return undefined;
  return momentOf(story, card.date, effectiveZone(story, card).zone?.id);
}

/**
 * The same moment as a local date in another zone (undefined for the
 * reference zone). Only dates with a time move; a part of the day moves by
 * its first hour and comes back as an approximate clock time. Day, month
 * and year boundaries, leap days and eras are all carried over.
 */
export function dateInZone(story: Story, date: StoryDate, from: Id | undefined, to: Id | undefined): StoryDate {
  const precision = precisionOf(date);
  if (precision !== "time" && precision !== "dayPart") return { ...date, zone: to };
  const calendar = findCalendar(story, date.calendar) ?? mainCalendar(story);
  const perDay = minutesPerDay(calendar);
  const key = momentOf(story, date, from).key + zoneOffset(story, to);
  const n = Math.floor(key / perDay);
  const { year, month, day } = dayFromNumber(calendar, n);
  const written = eraYear(calendar, year);
  const result: StoryDate = { calendar: date.calendar, year: written.year, month, day, minutes: key - n * perDay };
  if (written.era !== undefined && (calendar.eras ?? []).length > 0) result.era = written.era;
  if (to) result.zone = to;
  if (date.approximate || precision === "dayPart") result.approximate = true;
  return result;
}

/** Days from one day-precision date to another, ignoring times; undefined when either has no day. */
export function daysBetween(story: Story, a: StoryDate, b: StoryDate): number | undefined {
  if (a.day === undefined || b.day === undefined || a.month === undefined || b.month === undefined) return undefined;
  const calendar = findCalendar(story, a.calendar) ?? mainCalendar(story);
  return (
    dayNumber(calendar, lineYear(calendar, b.era, b.year), b.month, b.day) -
    dayNumber(calendar, lineYear(calendar, a.era, a.year), a.month, a.day)
  );
}

/** First and last-plus-one minute of the span of time a date covers at its own precision (a year, a month, a day, a part of the day or an hour of the clock), in the reference zone. */
export function dateSpan(calendar: Calendar, date: StoryDate): [number, number] {
  const perDay = minutesPerDay(calendar);
  const line = lineYear(calendar, date.era, date.year);
  if (date.month === undefined) return [daysBeforeYear(calendar, line) * perDay, daysBeforeYear(calendar, line + 1) * perDay];
  if (date.day === undefined) {
    const first = dayNumber(calendar, line, date.month, 1);
    return [first * perDay, (first + daysInMonth(calendar, line, date.month)) * perDay];
  }
  const day = dayNumber(calendar, line, date.month, date.day) * perDay;
  if (date.dayPart !== undefined) {
    const part = calendar.dayParts?.find((p) => p.id === date.dayPart);
    if (part) return [day + part.startHour * calendar.minutesPerHour, day + part.endHour * calendar.minutesPerHour];
  }
  if (date.minutes !== undefined) return [day + date.minutes, day + date.minutes + calendar.minutesPerHour];
  return [day, day + perDay];
}

// ---------------------------------------------------------------------------
// Formatting

/** Formats a date at its own precision, e.g. "1531", "December 1531", "4 December 1531, Dawn". */
export function formatStoryDate(story: Story, date: StoryDate, options: { zone?: boolean } = {}): string {
  const calendar = findCalendar(story, date.calendar);
  const parts: string[] = [];

  if (date.month !== undefined) {
    const monthName = calendar?.months[date.month - 1]?.name ?? `Month ${date.month}`;
    parts.push(date.day !== undefined ? `${date.day} ${monthName}` : monthName);
  }
  parts.push(String(date.year));

  const era = date.era ? calendar?.eras?.find((e) => e.id === date.era)?.name : undefined;
  let text = parts.join(" ");
  if (era) text += ` ${era}`;

  if (date.dayPart !== undefined) {
    const part = calendar?.dayParts?.find((p) => p.id === date.dayPart);
    text += `, ${part?.name ?? date.dayPart}`;
  } else if (date.minutes !== undefined) {
    text += `, ${clock(calendar, date.minutes)}`;
  }

  if (date.zone && options.zone !== false) {
    const zone = story.zones.find((z) => z.id === date.zone);
    if (zone) text += ` (${zone.name})`;
  }

  return date.approximate ? `around ${text}` : text;
}

/**
 * A date with its end, such as "4 Frost 1531 – 9 Frost 1531". The end leaves
 * out a zone it shares with the start, and an end equal to the start is not repeated.
 */
export function formatDateRange(story: Story, start: StoryDate, end: StoryDate | undefined): string {
  const from = formatStoryDate(story, start);
  if (!end) return from;
  const to = formatStoryDate(story, end, { zone: end.zone !== start.zone });
  return to === formatStoryDate(story, start, { zone: false }) && end.zone === start.zone ? from : `${from} – ${to}`;
}

/** A clock time such as "06:05", on a calendar whose hours may not be 60 minutes long. */
export function clock(calendar: Calendar | undefined, minutes: number): string {
  const perHour = calendar?.minutesPerHour ?? 60;
  const width = String(perHour - 1).length;
  const hours = Math.floor(minutes / perHour);
  return `${String(hours).padStart(2, "0")}:${String(minutes % perHour).padStart(Math.max(2, width), "0")}`;
}

/** Reads a clock time such as "6:05" or "06:05"; null when it is not a time on this calendar. */
export function parseClock(calendar: Calendar, text: string): number | null {
  const match = /^\s*(\d{1,3})(?::(\d{1,3}))?\s*$/.exec(text);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  if (hours >= calendar.hoursPerDay || minutes >= calendar.minutesPerHour) return null;
  return hours * calendar.minutesPerHour + minutes;
}

/** A zone offset such as "+2:30" or "-1:00", in the calendar's hours and minutes. */
export function formatOffset(calendar: Calendar, offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  return `${sign}${Math.floor(abs / calendar.minutesPerHour)}:${String(abs % calendar.minutesPerHour).padStart(2, "0")}`;
}

/** Reads an offset such as "+2:30", "-1", "3" or "-0:45"; null when it cannot be read. */
export function parseOffset(calendar: Calendar, text: string): number | null {
  const match = /^\s*([+-]?)\s*(\d{1,3})(?::(\d{1,3}))?\s*$/.exec(text);
  if (!match) return null;
  const minutes = Number(match[3] ?? 0);
  if (minutes >= calendar.minutesPerHour) return null;
  const total = Number(match[2]) * calendar.minutesPerHour + minutes;
  return match[1] === "-" ? -total : total;
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}
