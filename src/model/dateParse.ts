import { dateProblem, dayFromNumber, dayNumber, daysInMonth, lineYear, mainCalendar, eraYear, storyFormats } from "./calendar";
import { Calendar, Story, StoryDate } from "./types";

// Reading a date the writer typed, the way date fields on good websites do:
// "2020/07/12 19:49", "20200712", "2020-7-12", "2020/07", "1531",
// "12 Jul 2020", "4 Frost 1531 AF dawn", and for an
// end date "+3d" from the start. Numbers without names are read in the order
// the story's date format puts them (year, month, day for YYYY/MM/DD).

export type ParsedDate = { ok: true; date: StoryDate | undefined } | { ok: false; error: string };

/** The order year, month and day come in, by the story's date format. */
function fieldOrder(story: Story): ("Y" | "M" | "D")[] {
  const format = storyFormats(story).date.replace(/\[[^\]]*\]/g, "");
  const at = (pattern: RegExp, fallback: number) => {
    const m = pattern.exec(format);
    return m ? m.index : fallback;
  };
  const positions: [("Y" | "M" | "D"), number][] = [
    ["Y", at(/Y/, 0)],
    ["M", at(/M/, 1)],
    ["D", at(/D/, 2)],
  ];
  return positions.sort((a, b) => a[1] - b[1]).map(([k]) => k);
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A name as a whole word, ignoring case. */
const word = (name: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${escape(name)}(?=$|[^\\p{L}\\p{N}])`, "iu");

/** Finds and removes the first of `names` that appears as a word; longer names are tried first. */
function take<T>(text: string, names: [string, T][]): { text: string; value?: T } {
  for (const [name, value] of [...names].sort((a, b) => b[0].length - a[0].length)) {
    if (!name.trim()) continue;
    const m = word(name).exec(text);
    if (m) return { text: text.slice(0, m.index) + m[1] + " " + text.slice(m.index + m[0].length), value };
  }
  return { text };
}

/**
 * Reads a typed date. An empty field means no date. For an end date, `start`
 * lets "+3d", "+2w", "+1m", "+1y" or "+5h" count on from the start.
 */
export function parseStoryDate(story: Story, typed: string, start?: StoryDate): ParsedDate {
  const calendar = mainCalendar(story);
  let text = typed.trim();
  if (!text) return { ok: true, date: undefined };

  // "~2023/09" or "around 2023/09", from older habits, read as the date itself.
  const rough = /^(~|around\b|about\b|circa\b|ca\.?(?=\s))\s*/i.exec(text);
  if (rough) text = text.slice(rough[0].length);

  // "+3d": counted on from the start.
  const relative = /^\+\s*(\d+)\s*([a-z]+)?$/i.exec(text);
  if (relative) {
    if (!start) return { ok: false, error: "Only an end date can count on from the start." };
    const moved = addToDate(calendar, start, Number(relative[1]), (relative[2] ?? "d").toLowerCase());
    if (!moved) return { ok: false, error: "Use d, w, m, y or h, as in +3d." };
    const problem = dateProblem(calendar, moved);
    return problem ? { ok: false, error: problem } : { ok: true, date: moved };
  }

  const date: StoryDate = { calendar: calendar.id, year: 0 };

  // A zone, written as "(Eastern Provinces)" or by name.
  let found = take(text.replace(/[()]/g, " "), story.zones.map((z): [string, string] => [z.name, z.id]));
  text = found.text;
  if (found.value) date.zone = found.value;

  found = take(text, (calendar.eras ?? []).map((e): [string, string] => [e.name, e.id]));
  text = found.text;
  if (found.value) date.era = found.value;

  found = take(text, (calendar.dayParts ?? []).map((p): [string, string] => [p.name, p.id]));
  text = found.text;
  if (found.value) date.dayPart = found.value;

  // A clock time: "19:49" or "19h49".
  const time = /(\d{1,3})\s*[:h]\s*(\d{1,3})/i.exec(text);
  let minutes: number | undefined;
  if (time) {
    const hours = Number(time[1]);
    const mins = Number(time[2]);
    if (hours >= calendar.hoursPerDay || mins >= calendar.minutesPerHour) {
      return { ok: false, error: `The time must be between 00:00 and ${calendar.hoursPerDay - 1}:${calendar.minutesPerHour - 1}.` };
    }
    minutes = hours * calendar.minutesPerHour + mins;
    text = text.slice(0, time.index) + " " + text.slice(time.index + time[0].length);
  }

  // A month by name, in full, by its short name, or by the first three letters or more.
  const monthNames: [string, number][] = [];
  calendar.months.forEach((m, i) => {
    monthNames.push([m.name, i + 1]);
    if (m.short) monthNames.push([m.short, i + 1]);
  });
  const byName = take(text, monthNames);
  text = byName.text;
  let month: number | undefined = byName.value;
  if (month === undefined) {
    for (const piece of text.match(/\p{L}{3,}/gu) ?? []) {
      const matches = calendar.months.map((m, i) => [m.name.toLowerCase(), i + 1] as const).filter(([name]) => name.startsWith(piece.toLowerCase()));
      if (matches.length === 1) {
        month = matches[0]![1];
        text = text.replace(piece, " ");
        break;
      }
    }
  }
  const letters = text.match(/\p{L}+/gu);
  if (letters) return { ok: false, error: `"${letters[0]}" is not a month, era or time of day here.` };

  // The numbers that are left: a year, a month and a day, in the format's order.
  // Dashes are separators; only a minus sign right at the start makes a year negative.
  let numbers: string[] = [...(text.match(/\d+/g) ?? [])];
  if (numbers.length > 0 && /^\s*-\s*\d/.test(text)) numbers[0] = `-${numbers[0]}`;
  // "20200712 1949": a compact date, then a compact time.
  if (minutes === undefined && numbers.length === 2 && numbers[0]!.length >= 6 && numbers[1]!.length === 4) {
    const parsed = Number(numbers[1]!.slice(0, 2)) * calendar.minutesPerHour + Number(numbers[1]!.slice(2));
    if (Number(numbers[1]!.slice(0, 2)) < calendar.hoursPerDay && Number(numbers[1]!.slice(2)) < calendar.minutesPerHour) {
      minutes = parsed;
      numbers = [numbers[0]!];
    }
  }
  const order = fieldOrder(story).filter((f) => f !== "M" || month === undefined);
  const parts: Partial<Record<"Y" | "M" | "D", number>> = {};
  if (numbers.length === 1 && /^\d{6,8}$/.test(numbers[0]!) && month === undefined) {
    // Digits only: the year takes four, the month and day two each, in the format's order.
    const digits = numbers[0]!;
    const fields = digits.length === 8 ? order : order.filter((f) => f !== "D");
    let i = 0;
    for (const f of fields) {
      const width = f === "Y" ? digits.length - (fields.length - 1) * 2 : 2;
      parts[f] = Number(digits.slice(i, i + width));
      i += width;
    }
  } else {
    // A number of three or more digits is the year, wherever it stands.
    const yearAt = numbers.findIndex((n) => n.replace("-", "").length >= 3);
    // "July 12": with a month named and only a short number, the number is the day, and the year is missing.
    if (month !== undefined && yearAt === -1 && numbers.length === 1 && numbers[0]!.length <= 2) return { ok: false, error: "Give a year." };
    const rest = order.filter((f) => f !== "Y" || yearAt === -1);
    if (yearAt !== -1) {
      parts.Y = Number(numbers[yearAt]);
      numbers = numbers.filter((_, i) => i !== yearAt);
    }
    if (numbers.length > rest.length) return { ok: false, error: "There are more numbers than a date has." };
    // With fewer numbers than fields, the year comes first, then the month, then the day.
    const fill = rest.length > numbers.length ? (["Y", "M", "D"] as const).filter((f) => rest.includes(f)).slice(0, numbers.length) : rest;
    const ordered = rest.filter((f) => fill.includes(f));
    ordered.forEach((f, i) => (parts[f] = Number(numbers[i])));
  }
  if (month !== undefined) parts.M = month;

  if (parts.Y === undefined) return { ok: false, error: "Give a year." };
  if (parts.D !== undefined && parts.M === undefined) return { ok: false, error: "A day needs a month." };
  date.year = parts.Y;
  if (parts.M !== undefined) date.month = parts.M;
  if (parts.D !== undefined) date.day = parts.D;
  if (minutes !== undefined) date.minutes = minutes;
  if ((minutes !== undefined || date.dayPart) && date.day === undefined) return { ok: false, error: "A time needs a day." };
  if (date.era === undefined) delete date.era;

  const problem = dateProblem(calendar, date);
  return problem ? { ok: false, error: problem } : { ok: true, date };
}

/** A date moved on by an amount: d(ays), w(eeks), m(onths), y(ears) or h(ours). */
function addToDate(calendar: Calendar, from: StoryDate, amount: number, unit: string): StoryDate | null {
  const date: StoryDate = { ...from };
  const line = lineYear(calendar, from.era, from.year);
  const kind = unit[0];
  if (kind === "y") {
    const moved = eraYear(calendar, line + amount);
    date.year = moved.year;
    if (moved.era) date.era = moved.era;
    return date;
  }
  if (kind === "m" && unit !== "min") {
    if (date.month === undefined) return null;
    const total = (line - 1) * calendar.months.length + (date.month - 1) + amount;
    const moved = eraYear(calendar, Math.floor(total / calendar.months.length) + 1);
    date.year = moved.year;
    if (moved.era) date.era = moved.era;
    date.month = (total % calendar.months.length) + 1;
    if (date.day !== undefined) date.day = Math.min(date.day, daysInMonth(calendar, Math.floor(total / calendar.months.length) + 1, date.month));
    return date;
  }
  if (kind === "d" || kind === "w" || kind === "h") {
    if (date.month === undefined || date.day === undefined) return null;
    let days = kind === "w" ? amount * 7 : kind === "d" ? amount : 0;
    if (kind === "h") {
      const perDay = calendar.hoursPerDay * calendar.minutesPerHour;
      const minutes = (date.minutes ?? 0) + amount * calendar.minutesPerHour;
      days = Math.floor(minutes / perDay);
      date.minutes = minutes % perDay;
      delete date.dayPart;
    }
    const moved = dayFromNumber(calendar, dayNumber(calendar, line, date.month, date.day) + days);
    const era = eraYear(calendar, moved.year);
    date.year = era.year;
    if (era.era) date.era = era.era;
    date.month = moved.month;
    date.day = moved.day;
    return date;
  }
  return null;
}
