import {
  dayFromNumber,
  dayNumber,
  daysBeforeYear,
  daysInMonth,
  formatStoryDate,
  lineYear,
  mainCalendar,
  minutesPerDay,
  dateSpan,
} from "../model/calendar";
import { readingOrder, referenceDate, timeSorted } from "../model/storyTime";
import { Calendar, Card, Id, Story, StoryDate } from "../model/types";
import { Orientation } from "./layout";


// Pure layout of the story-time view, free of Obsidian and the DOM like
// layout.ts. Lanes are plot lines, as on the board; along the other axis run
// spans of time at the chosen zoom (years, months, days, or parts of the day),
// in story order rather than reading order. Only spans that have cards get a
// row, and a gap marker says how much time passes between rows that are not
// next to each other, so a story that covers decades stays readable.

export type Zoom = "year" | "month" | "day" | "time";

export const ZOOM_LABELS: Record<Zoom, string> = { year: "Years", month: "Months", day: "Days", time: "Times of day" };

const ZOOM_RANK: Record<Zoom, number> = { year: 0, month: 1, day: 2, time: 3 };

/** One span of time that has cards: a row (or column) of the view. */
export interface Bucket {
  /** Stable id: the span's date, as JSON. */
  id: string;
  /** The span as a date in the reference zone, at the precision it covers. */
  date: StoryDate;
  label: string;
  /** First and last-plus-one minute of the span on the story's line of minutes. */
  start: number;
  end: number;
}

export type TimeItem =
  | { kind: "corner" }
  | { kind: "lane-header"; plotLineId: Id }
  | { kind: "time-header"; bucket: Bucket }
  | { kind: "gap"; text: string }
  | { kind: "card"; cardId: Id; bucketId: string }
  | { kind: "echo"; cardId: Id; plotLineId: Id; bucketId: string }
  /** Empty space in a span and plot line; a drop or double-click lands in that span. */
  | { kind: "time-cell"; bucketId: string; plotLineId: Id };

export interface PlacedTimeItem {
  item: TimeItem;
  /** 1-based grid lines. */
  row: number;
  column: number;
  /** How many slots the item covers along the time axis. */
  span: number;
}

export interface TimeLayout {
  rows: number;
  columns: number;
  items: PlacedTimeItem[];
  buckets: Bucket[];
  /** Cards without a date, in reading order, for the undated tray. */
  undated: Id[];
}

/** The span of time a date falls in at a zoom; a date less precise than the zoom keeps its own precision. */
export function bucketDate(calendar: Calendar, date: StoryDate, zoom: Zoom): StoryDate {
  const out: StoryDate = { calendar: date.calendar, year: date.year };
  if (date.era !== undefined) out.era = date.era;
  const rank = ZOOM_RANK[zoom];
  if (rank >= 1 && date.month !== undefined) out.month = date.month;
  if (rank >= 2 && out.month !== undefined && date.day !== undefined) out.day = date.day;
  if (rank >= 3 && out.day !== undefined) {
    if (date.dayPart !== undefined) out.dayPart = date.dayPart;
    else if (date.minutes !== undefined) {
      const hour = Math.floor(date.minutes / calendar.minutesPerHour);
      const part = calendar.dayParts?.find((p) => hour >= p.startHour && hour < p.endHour);
      if (part) out.dayPart = part.id;
      else out.minutes = hour * calendar.minutesPerHour;
    }
  }
  return out;
}

/** How much time passes from one moment to a later one, in words: "3 years later", "2 days later". */
export function describeGap(calendar: Calendar, from: number, to: number): string {
  const perDay = minutesPerDay(calendar);
  const a = dayFromNumber(calendar, Math.floor(from / perDay));
  const b = dayFromNumber(calendar, Math.floor(to / perDay));
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} later`;
  const earlierInYear = b.month < a.month || (b.month === a.month && b.day < a.day);
  const years = b.year - a.year - (earlierInYear ? 1 : 0);
  if (years >= 1) return plural(years, "year");
  const months = (b.year - a.year) * calendar.months.length + b.month - a.month - (b.day < a.day ? 1 : 0);
  if (months >= 1) return plural(months, "month");
  const days = Math.floor(to / perDay) - Math.floor(from / perDay);
  if (days >= 1) return plural(days, "day");
  const hours = Math.floor((to - from) / calendar.minutesPerHour);
  if (hours >= 1) return plural(hours, "hour");
  return "Later";
}

/**
 * Lays out the story-time view. Each span's cards stack per plot line in
 * story order; a span is as tall as its tallest stack, and the space under a
 * short stack is a time cell, so every plot line accepts drops in every span.
 */
export function computeTimeLayout(story: Story, zoom: Zoom, orientation: Orientation): TimeLayout {
  const calendar = mainCalendar(story);
  const laneIndex = new Map(story.plotLines.map((p, i) => [p.id, i]));
  const cards = Object.values(story.cards).filter((c) => laneIndex.has(c.plotLine));
  const dated = timeSorted(story, cards.filter((c) => c.date));
  const reading = readingOrder(story);
  const undated = cards
    .filter((c) => !c.date)
    .sort((a, b) => reading.get(a.id)! - reading.get(b.id)!)
    .map((c) => c.id);

  // Group cards into spans.
  const buckets = new Map<string, { bucket: Bucket; cards: Card[] }>();
  for (const card of dated) {
    const date = bucketDate(calendar, referenceDate(story, card)!, zoom);
    const id = JSON.stringify(date);
    let entry = buckets.get(id);
    if (!entry) {
      const [start, end] = dateSpan(calendar, date);
      entry = { bucket: { id, date, label: formatStoryDate(story, date), start, end }, cards: [] };
      buckets.set(id, entry);
    }
    entry.cards.push(card);
  }
  // A coarser span sorts before the finer spans it contains.
  const ordered = [...buckets.values()].sort((a, b) => a.bucket.start - b.bucket.start || b.bucket.end - a.bucket.end);

  const items: { item: TimeItem; slot: number; lane: number; span: number }[] = [];
  items.push({ item: { kind: "corner" }, slot: 0, lane: 0, span: 1 });
  story.plotLines.forEach((p, i) => items.push({ item: { kind: "lane-header", plotLineId: p.id }, slot: 0, lane: i + 1, span: 1 }));

  let slot = 1;
  // The span reaching furthest so far; a span that starts after it leaves a gap.
  let reach: Bucket | null = null;
  for (const { bucket, cards: inBucket } of ordered) {
    if (reach && bucket.start > reach.end) {
      items.push({ item: { kind: "gap", text: describeGap(calendar, reach.start, bucket.start) }, slot, lane: 0, span: 1 });
      slot++;
    }
    if (!reach || bucket.end > reach.end) reach = bucket;

    const stacks: TimeItem[][] = story.plotLines.map(() => []);
    for (const card of inBucket) {
      stacks[laneIndex.get(card.plotLine)!]!.push({ kind: "card", cardId: card.id, bucketId: bucket.id });
      for (const other of card.alsoIn) {
        const lane = laneIndex.get(other);
        if (lane !== undefined && other !== card.plotLine) {
          stacks[lane]!.push({ kind: "echo", cardId: card.id, plotLineId: other, bucketId: bucket.id });
        }
      }
    }
    const height = Math.max(1, ...stacks.map((s) => s.length));
    items.push({ item: { kind: "time-header", bucket }, slot, lane: 0, span: height });
    stacks.forEach((stack, lane) => {
      for (let i = 0; i < height; i++) {
        const item = stack[i] ?? { kind: "time-cell", bucketId: bucket.id, plotLineId: story.plotLines[lane]!.id };
        items.push({ item, slot: slot + i, lane: lane + 1, span: 1 });
      }
    });
    slot += height;
  }

  const vertical = orientation === "vertical";
  const laneCount = story.plotLines.length;
  return {
    rows: vertical ? slot : laneCount + 1,
    columns: vertical ? laneCount + 1 : slot,
    items: items.map(({ item, slot, lane, span }) => ({
      item,
      row: (vertical ? slot : lane) + 1,
      column: (vertical ? lane : slot) + 1,
      span,
    })),
    buckets: ordered.map((b) => b.bucket),
    undated,
  };
}
