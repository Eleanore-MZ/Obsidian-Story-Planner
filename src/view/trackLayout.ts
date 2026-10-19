import { dateSpan, formatStoryDate, mainCalendar } from "../model/calendar";
import { chapterRows } from "../model/moves";
import { findClashes, readingOrder, referenceDate, timeSorted } from "../model/storyTime";
import { Card, CharacterRole, Id, Story } from "../model/types";
import { Orientation } from "./layout";
import { Bucket, bucketDate, describeGap, Zoom } from "./timeLayout";

// Pure layouts of the character view, free of Obsidian and the DOM. The
// character track is the board with characters as lanes: a card shows in the
// lane of every chosen character in it, along the chapter axis or the
// story-time axis. The presence matrix is a compact grid of characters
// against chapters or spans of time, marking how each character is there.

export type TrackAxis = "chapters" | "time";

export type TrackItem =
  | { kind: "corner" }
  | { kind: "character-header"; characterId: Id }
  | { kind: "chapter-header"; chapterId: Id | null }
  | { kind: "time-header"; bucket: Bucket }
  | { kind: "gap"; text: string }
  /** A card in a character's lane; on the time axis, with the span it sits in. */
  | { kind: "appearance"; cardId: Id; characterId: Id; bucketId?: string }
  /**
   * Empty space in a character's lane. On the chapter axis it belongs to the
   * row of `cardId` (or to an empty chapter); on the time axis to a span.
   */
  | { kind: "track-cell"; characterId: Id; chapterId?: Id | null; cardId?: Id; bucketId?: string };

export interface PlacedTrackItem {
  item: TrackItem;
  row: number;
  column: number;
  span: number;
}

export interface TrackLayout {
  rows: number;
  columns: number;
  items: PlacedTrackItem[];
  buckets: Bucket[];
  /** Cards with none of the chosen characters, which the track leaves out. */
  hidden: number;
}

/**
 * Lays out the character track for the chosen characters, in the order given.
 * With `sharedOnly`, only cards that have every chosen character show: with two
 * characters chosen, their shared scenes, which with relationship states read
 * as how the two stand at each point of the story.
 */
export function computeTrackLayout(
  story: Story,
  characterIds: Id[],
  axis: TrackAxis,
  zoom: Zoom,
  orientation: Orientation,
  sharedOnly = false,
): TrackLayout {
  const lanes = characterIds.filter((id, i) => story.characters.some((c) => c.id === id) && characterIds.indexOf(id) === i);
  const laneIndex = new Map(lanes.map((id, i) => [id, i]));
  const lanesOf = (card: Card) => card.characters.map((c) => laneIndex.get(c.id)).filter((l): l is number => l !== undefined);
  const shown = (card: Card) => {
    const count = lanesOf(card).length;
    return sharedOnly && lanes.length > 1 ? count === lanes.length : count > 0;
  };

  const items: { item: TrackItem; slot: number; lane: number; span: number }[] = [];
  items.push({ item: { kind: "corner" }, slot: 0, lane: 0, span: 1 });
  lanes.forEach((id, i) => items.push({ item: { kind: "character-header", characterId: id }, slot: 0, lane: i + 1, span: 1 }));

  const appearances = (card: Card, slot: number, filled: Set<number>) => {
    for (const lane of lanesOf(card)) {
      if (filled.has(lane)) continue;
      filled.add(lane);
      items.push({ item: { kind: "appearance", cardId: card.id, characterId: lanes[lane]! }, slot, lane: lane + 1, span: 1 });
    }
  };

  let slot = 1;
  const buckets: Bucket[] = [];
  if (axis === "chapters") {
    const groups: (Id | null)[] = [...story.chapters.map((c) => c.id), null];
    for (const chapterId of groups) {
      // Scenes that share a row on the board share one here too, unless they share a character.
      const rows: Card[][] = [];
      for (const row of chapterRows(story, chapterId)) {
        let open: { cards: Card[]; lanes: Set<number> }[] = [];
        for (const card of row.filter(shown)) {
          let target = open.find((r) => lanesOf(card).every((l) => !r.lanes.has(l)));
          if (!target) {
            target = { cards: [], lanes: new Set() };
            open.push(target);
            rows.push(target.cards);
          }
          target.cards.push(card);
          lanesOf(card).forEach((l) => target!.lanes.add(l));
        }
        open = [];
      }
      if (chapterId === null && rows.length === 0) continue;
      const height = Math.max(1, rows.length);
      items.push({ item: { kind: "chapter-header", chapterId }, slot, lane: 0, span: height });
      if (rows.length === 0) {
        lanes.forEach((id, lane) => items.push({ item: { kind: "track-cell", characterId: id, chapterId }, slot, lane: lane + 1, span: 1 }));
      }
      for (const row of rows) {
        const filled = new Set<number>();
        for (const card of row) appearances(card, slot, filled);
        lanes.forEach((id, lane) => {
          if (!filled.has(lane)) items.push({ item: { kind: "track-cell", characterId: id, chapterId, cardId: row[0]!.id }, slot, lane: lane + 1, span: 1 });
        });
        slot++;
      }
      if (rows.length === 0) slot++;
    }
  } else {
    const calendar = mainCalendar(story);
    const dated = timeSorted(story, Object.values(story.cards).filter((c) => c.date && shown(c)));
    const byBucket = new Map<string, { bucket: Bucket; cards: Card[] }>();
    for (const card of dated) {
      const date = bucketDate(calendar, referenceDate(story, card)!, zoom);
      const id = JSON.stringify(date);
      let entry = byBucket.get(id);
      if (!entry) {
        const [start, end] = dateSpan(calendar, date);
        entry = { bucket: { id, date, label: formatStoryDate(story, date), start, end }, cards: [] };
        byBucket.set(id, entry);
      }
      entry.cards.push(card);
    }
    const ordered = [...byBucket.values()].sort((a, b) => a.bucket.start - b.bucket.start || b.bucket.end - a.bucket.end);
    let reach: Bucket | null = null;
    for (const { bucket, cards } of ordered) {
      buckets.push(bucket);
      if (reach && bucket.start > reach.end) {
        items.push({ item: { kind: "gap", text: describeGap(calendar, reach.start, bucket.start) }, slot, lane: 0, span: 1 });
        slot++;
      }
      if (!reach || bucket.end > reach.end) reach = bucket;
      const stacks: Id[][] = lanes.map(() => []);
      for (const card of cards) for (const lane of lanesOf(card)) stacks[lane]!.push(card.id);
      const height = Math.max(1, ...stacks.map((s) => s.length));
      items.push({ item: { kind: "time-header", bucket }, slot, lane: 0, span: height });
      stacks.forEach((stack, lane) => {
        for (let i = 0; i < height; i++) {
          const cardId = stack[i];
          const item: TrackItem = cardId
            ? { kind: "appearance", cardId, characterId: lanes[lane]!, bucketId: bucket.id }
            : { kind: "track-cell", characterId: lanes[lane]!, bucketId: bucket.id };
          items.push({ item, slot: slot + i, lane: lane + 1, span: 1 });
        }
      });
      slot += height;
    }
  }

  const vertical = orientation === "vertical";
  return {
    rows: vertical ? slot : lanes.length + 1,
    columns: vertical ? lanes.length + 1 : slot,
    items: items.map(({ item, slot, lane, span }) => ({
      item,
      row: (vertical ? slot : lane) + 1,
      column: (vertical ? lane : slot) + 1,
      span,
    })),
    buckets,
    hidden: Object.values(story.cards).filter((c) => !shown(c) && (axis === "chapters" || c.date)).length,
  };
}

// ---------------------------------------------------------------------------
// Presence matrix

export interface MatrixColumn {
  id: string;
  label: string;
}

export interface MatrixCell {
  /** The strongest role the character has in this column, if any. */
  role?: CharacterRole;
  /** The column's cards the character is in, in story order. */
  cards: Id[];
  /** Cards in this column where the character is in two places at once. */
  clashes: Id[];
}

export interface Matrix {
  columns: MatrixColumn[];
  /** One row per character, in story order; cells line up with the columns. */
  rows: { characterId: Id; cells: MatrixCell[]; total: number }[];
  clashCount: number;
}

const ROLE_RANK: Record<CharacterRole, number> = { mentioned: 1, present: 2, pov: 3 };

export function computeMatrix(story: Story, axis: TrackAxis, zoom: Zoom): Matrix {
  const columnOf = new Map<Id, string>();
  const columns: MatrixColumn[] = [];
  if (axis === "chapters") {
    const ids = new Set(story.chapters.map((c) => c.id));
    for (const chapter of story.chapters) columns.push({ id: chapter.id, label: chapter.name });
    const offPage = Object.values(story.cards).filter((c) => c.chapter === null || !ids.has(c.chapter));
    if (offPage.length > 0) columns.push({ id: "", label: "Off-page" });
    for (const card of Object.values(story.cards)) columnOf.set(card.id, card.chapter && ids.has(card.chapter) ? card.chapter : "");
  } else {
    const calendar = mainCalendar(story);
    const seen = new Map<string, { label: string; start: number; end: number }>();
    for (const card of timeSorted(story, Object.values(story.cards).filter((c) => c.date))) {
      const date = bucketDate(calendar, referenceDate(story, card)!, zoom);
      const id = JSON.stringify(date);
      if (!seen.has(id)) {
        const [start, end] = dateSpan(calendar, date);
        seen.set(id, { label: formatStoryDate(story, date), start, end });
      }
      columnOf.set(card.id, id);
    }
    const sorted = [...seen.entries()].sort((a, b) => a[1].start - b[1].start || b[1].end - a[1].end);
    for (const [id, { label }] of sorted) columns.push({ id, label });
  }
  const index = new Map(columns.map((c, i) => [c.id, i]));

  const clashes = findClashes(story);
  const clashCards = new Map<Id, Set<Id>>();
  for (const clash of clashes) {
    const set = clashCards.get(clash.characterId) ?? new Set<Id>();
    clash.cards.forEach((c) => set.add(c));
    clashCards.set(clash.characterId, set);
  }

  const reading = readingOrder(story);
  const ordered =
    axis === "time"
      ? timeSorted(story, Object.values(story.cards).filter((c) => c.date))
      : Object.values(story.cards).sort((a, b) => reading.get(a.id)! - reading.get(b.id)!);
  const rows = story.characters.map((character) => {
    const cells: MatrixCell[] = columns.map(() => ({ cards: [], clashes: [] }));
    let total = 0;
    for (const card of ordered) {
      const entry = card.characters.find((c) => c.id === character.id);
      const column = index.get(columnOf.get(card.id) ?? "\u0000");
      if (!entry || column === undefined) continue;
      const cell = cells[column]!;
      cell.cards.push(card.id);
      total++;
      if (!cell.role || ROLE_RANK[entry.role] > ROLE_RANK[cell.role]) cell.role = entry.role;
      if (clashCards.get(character.id)?.has(card.id)) cell.clashes.push(card.id);
    }
    return { characterId: character.id, cells, total };
  });
  return { columns, rows, clashCount: clashes.length };
}
