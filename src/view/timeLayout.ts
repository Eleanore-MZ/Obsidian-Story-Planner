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
import { readingOrder, referenceDate, referenceEndDate, timeSorted } from "../model/storyTime";
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
  /** `until` is set on a card that runs on to a later span: the span its end date falls in. */
  | { kind: "card"; cardId: Id; bucketId: string; until?: string }
  | { kind: "echo"; cardId: Id; plotLineId: Id; bucketId: string; until?: string }
  /** Empty space in a span and plot line; a drop or double-click lands in that span. */
  | { kind: "time-cell"; bucketId: string; plotLineId: Id };

export interface PlacedTimeItem {
  item: TimeItem;
  /** 1-based grid lines. */
  row: number;
  column: number;
  /** How many slots the item covers along the time axis. */
  span: number;
  /** How many tracks it covers across its lane (always one in story time). */
  cross: number;
  /** How many long cards it sits on top of, in its plot line: it is drawn that many steps in. */
  depth: number;
}

export interface TimeLayout {
  rows: number;
  columns: number;
  items: PlacedTimeItem[];
  buckets: Bucket[];
  /** Cards without a date, in reading order, for the undated tray. */
  undated: Id[];
  /** How many tracks each plot line has (one each in story time). */
  laneTracks: number[];
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

  // Group cards into spans. A card whose end date falls in a later span runs
  // on to it; that span is shown even if no card starts there.
  const buckets = new Map<string, { bucket: Bucket; cards: Card[] }>();
  const bucketOf = (date: StoryDate) => {
    const at = bucketDate(calendar, date, zoom);
    const id = JSON.stringify(at);
    let entry = buckets.get(id);
    if (!entry) {
      const [start, end] = dateSpan(calendar, at);
      entry = { bucket: { id, date: at, label: formatStoryDate(story, at), start, end }, cards: [] };
      buckets.set(id, entry);
    }
    return entry;
  };
  const until = new Map<Id, string>();
  for (const card of dated) {
    const entry = bucketOf(referenceDate(story, card)!);
    entry.cards.push(card);
    const end = referenceEndDate(story, card);
    if (end) {
      const last = bucketOf(end).bucket;
      if (last.id !== entry.bucket.id && last.start > entry.bucket.start) until.set(card.id, last.id);
    }
  }
  // A coarser span sorts before the finer spans it contains.
  const ordered = [...buckets.values()].sort((a, b) => a.bucket.start - b.bucket.start || b.bucket.end - a.bucket.end);

  // Slots along the time axis: each span as tall as its tallest stack of
  // cards, with a gap row where time passes between spans. A long card sits in
  // its start span like any other, and then runs on down to its end span.
  type Laid = { item: TimeItem; slot: number; lane: number; span: number; depth: number };
  const items: Laid[] = [];
  const long: { laid: Laid; last: string }[] = [];
  const lastSlot = new Map<string, number>();

  let slot = 1;
  // The span reaching furthest so far; a span that starts after it leaves a gap.
  let reach: Bucket | null = null;
  for (const { bucket, cards: inBucket } of ordered) {
    if (reach && bucket.start > reach.end) {
      items.push({ item: { kind: "gap", text: describeGap(calendar, reach.start, bucket.start) }, slot, lane: 0, span: 1, depth: 0 });
      slot++;
    }
    if (!reach || bucket.end > reach.end) reach = bucket;

    const stacks: TimeItem[][] = story.plotLines.map(() => []);
    for (const card of inBucket) {
      const last = until.get(card.id);
      const extra = last ? { until: last } : {};
      stacks[laneIndex.get(card.plotLine)!]!.push({ kind: "card", cardId: card.id, bucketId: bucket.id, ...extra });
      for (const other of card.alsoIn) {
        const lane = laneIndex.get(other);
        if (lane !== undefined && other !== card.plotLine) {
          stacks[lane]!.push({ kind: "echo", cardId: card.id, plotLineId: other, bucketId: bucket.id, ...extra });
        }
      }
    }
    const height = Math.max(1, ...stacks.map((s) => s.length));
    lastSlot.set(bucket.id, slot + height - 1);
    items.push({ item: { kind: "time-header", bucket }, slot, lane: 0, span: height, depth: 0 });
    stacks.forEach((stack, lane) => {
      for (let i = 0; i < height; i++) {
        const item = stack[i] ?? { kind: "time-cell", bucketId: bucket.id, plotLineId: story.plotLines[lane]!.id };
        const laid: Laid = { item, slot: slot + i, lane: lane + 1, span: 1, depth: 0 };
        items.push(laid);
        if ((item.kind === "card" || item.kind === "echo") && item.until) long.push({ laid, last: item.until });
      }
    });
    slot += height;
  }

  // A long card runs from its own row to its last span's last slot, through
  // any gap rows between. Everything in its plot line in the rows below its
  // own sits on top of it, one step further in for each long card it is in.
  for (const { laid, last } of long) {
    const to = lastSlot.get(last)!;
    laid.span = to - laid.slot + 1;
    for (const other of items) {
      if (other.lane === laid.lane && other.slot > laid.slot && other.slot <= to) other.depth++;
    }
  }

  const vertical = orientation === "vertical";
  const laneCount = story.plotLines.length;
  const laneTracks = story.plotLines.map(() => 1);
  const placed: PlacedTimeItem[] = [{ item: { kind: "corner" }, row: 1, column: 1, span: 1, cross: 1, depth: 0 }];
  story.plotLines.forEach((p, i) =>
    placed.push({ item: { kind: "lane-header", plotLineId: p.id }, row: vertical ? 1 : i + 2, column: vertical ? i + 2 : 1, span: 1, cross: 1, depth: 0 }),
  );
  for (const { item, slot: at, lane, span, depth } of items) {
    placed.push({ item, row: (vertical ? at : lane) + 1, column: (vertical ? lane : at) + 1, span, cross: 1, depth });
  }
  const crossCount = laneCount + 1;

  return {
    rows: vertical ? slot : crossCount,
    columns: vertical ? crossCount : slot,
    items: placed,
    buckets: ordered.map((b) => b.bucket),
    undated,
    laneTracks,
  };
}
