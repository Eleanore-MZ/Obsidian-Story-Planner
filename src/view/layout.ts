import { eventPlotLine } from "../model/events";
import { Card, Story } from "../model/types";

/** What an event's card may cover on the board: empty cells, and the starts and ends of chapters it runs through. */
const BOARD_COVERABLE: ReadonlySet<string> = new Set(["empty", "add-card", "chapter-end", "background-cell"]);

// Pure layout of the plot line board, kept free of Obsidian and the DOM so it
// can be unit tested. The board is a grid of lanes (plot lines) and slots.
// Each chapter contributes a header slot, one slot per scene in scene order,
// and a thin drop-zone slot at its end, so reading along the slots gives the
// order of the book. Every lane has an item in every content slot (a card, an
// echo or an empty cell), so there is somewhere to drop anywhere on the board.
// Orientation only decides whether lanes are columns or rows.

export type Orientation = "vertical" | "horizontal";

export type BoardItem =
  | { kind: "corner" }
  | { kind: "lane-header"; plotLineId: string }
  | { kind: "chapter-header"; chapterId: string | null }
  /** `background` marks an off-page event shown in the chapter it happens during. */
  | { kind: "card"; cardId: string; background?: true }
  | { kind: "echo"; cardId: string; plotLineId: string; background?: true }
  /** Empty space in a chapter's background rows; a drop or double-click makes an off-page event during the chapter. */
  | { kind: "background-cell"; chapterId: string; plotLineId: string }
  | { kind: "add-card"; chapterId: string | null; plotLineId: string }
  /** Empty space beside a scene in another plot line; a drop lands next to that scene. */
  | { kind: "empty"; cardId: string; plotLineId: string }
  /** Drop zone after a chapter's last scene, so cards can be dropped at the end. */
  | { kind: "chapter-end"; chapterId: string | null; plotLineId: string }
  /** An act in the act column, running beside all its chapters; null for chapters in no act. */
  | { kind: "act-band"; actId: string | null }
  /** A line across the whole board where one act ends and the next begins. */
  | { kind: "act-divider" }
  /**
   * "Show events": an event as one card, in place of its scenes (`cardIds`),
   * in its own plot line; and an echo of it where its scenes are in another.
   */
  | { kind: "event-card"; eventId: string; plotLineId: string; cardIds: string[] }
  | { kind: "event-echo"; eventId: string; plotLineId: string; cardIds: string[] }
  /** A folded chapter's single row: how many cards each plot line has in it. */
  | { kind: "chapter-folded"; chapterId: string | null; plotLineId: string; count: number };

export interface PlacedItem {
  item: BoardItem;
  /** 1-based grid line positions, as CSS grid expects. */
  row: number;
  column: number;
  /** How many slots it covers along the reading axis (acts run beside their chapters). */
  span?: number;
  /** How many event cards it sits on top of: it is drawn that many steps in. */
  depth?: number;
}

export interface BoardLayout {
  rows: number;
  columns: number;
  items: PlacedItem[];
  /** True when the story has acts, which then have a column of their own before the chapters. */
  acts: boolean;
}

/**
 * Lays out the board. In `compact` mode each plot line's cards (and echoes)
 * stack from the top of the chapter without gaps, which hides the order
 * across plot lines but shows at a glance how busy each one is; the space
 * below a short stack is chapter-end space, so a drop there goes last.
 */
export function computeBoardLayout(
  story: Story,
  orientation: Orientation,
  compact = false,
  /** Folded chapters, which show as one row; null is the off-page group. */
  folded: ReadonlySet<string | null> = new Set(),
  /**
   * Whether off-page events show: those that happen during a chapter in rows
   * at the end of it, the others in the off-page group at the end.
   */
  offPage = true,
  /**
   * "Show events": each event shows as one card in place of its scenes,
   * except the events in `expanded`. Scenes in no event always show.
   */
  events?: { expanded: ReadonlySet<string> },
): BoardLayout {
  const laneIndex = new Map(story.plotLines.map((p, i) => [p.id, i]));
  const laneCount = story.plotLines.length;
  // Lane -1 is the act column, lane 0 the chapter column; plot lines start at 1.
  const items: { item: BoardItem; slot: number; lane: number; span?: number; depth?: number }[] = [];

  // Lane 0 / slot 0 hold the headers; content starts at 1 on both axes.
  items.push({ item: { kind: "corner" }, slot: 0, lane: 0 });
  story.plotLines.forEach((p, i) => {
    items.push({ item: { kind: "lane-header", plotLineId: p.id }, slot: 0, lane: i + 1 });
  });

  const cards = Object.values(story.cards);
  const byOrder = (a: Card, b: Card) => a.order - b.order || a.id.localeCompare(b.id);
  const chapterIds = new Set(story.chapters.map((c) => c.id));

  const during = (c: Card) => (c.chapter === null && c.during && chapterIds.has(c.during) ? c.during : null);
  const groups: { chapterId: string | null; cards: Card[]; background: Card[] }[] = story.chapters.map((c) => ({
    chapterId: c.id,
    cards: cards.filter((card) => card.chapter === c.id).sort(byOrder),
    background: offPage ? cards.filter((card) => during(card) === c.id).sort(byOrder) : [],
  }));
  const rest = cards.filter((c) => (c.chapter === null || !chapterIds.has(c.chapter)) && !during(c)).sort(byOrder);
  if (offPage && rest.length > 0) groups.push({ chapterId: null, cards: rest, background: [] });

  /** A chapter's background rows, below its end: off-page events that happen during it. */
  const backgroundRows = (group: (typeof groups)[number]) => {
    if (group.chapterId === null || group.background.length === 0) return;
    const chapterId = group.chapterId;
    for (const row of sceneRows(group.background, laneIndex)) {
      const filled = new Set<number>();
      for (const card of row) {
        const lane = laneIndex.get(card.plotLine)!;
        filled.add(lane);
        items.push({ item: { kind: "card", cardId: card.id, background: true }, slot, lane: lane + 1 });
        for (const other of card.alsoIn) {
          const echoLane = laneIndex.get(other);
          if (echoLane === undefined || filled.has(echoLane)) continue;
          filled.add(echoLane);
          items.push({ item: { kind: "echo", cardId: card.id, plotLineId: other, background: true }, slot, lane: echoLane + 1 });
        }
      }
      story.plotLines.forEach((p, i) => {
        if (!filled.has(i)) items.push({ item: { kind: "background-cell", chapterId, plotLineId: p.id }, slot, lane: i + 1 });
      });
      slot++;
    }
  };

  let slot = 1;
  const hasActs = story.actsEnabled !== false && story.acts.length > 0;
  const actOf = new Map(story.chapters.map((c) => [c.id, c.act && story.acts.some((a) => a.id === c.act) ? c.act : null]));
  // Runs of chapters in the same act (or in none), for the act column.
  let run: { act: string | null; start: number } | null = null;
  const closeRun = (end: number) => {
    if (run && hasActs) items.push({ item: { kind: "act-band", actId: run.act }, slot: run.start, lane: -1, span: end - run.start });
  };
  for (const group of groups) {
    const act = group.chapterId === null ? null : (actOf.get(group.chapterId) ?? null);
    if (!run || act !== run.act) {
      closeRun(slot);
      // A line across the board where one act gives way to the next.
      if (run && hasActs) items.push({ item: { kind: "act-divider" }, slot, lane: -1 });
      run = { act, start: slot };
    }
    // The chapter's header runs down beside all of its rows; its span is filled in once they are laid out.
    const header: { item: BoardItem; slot: number; lane: number; span?: number } = {
      item: { kind: "chapter-header", chapterId: group.chapterId },
      slot,
      lane: 0,
    };
    items.push(header);
    const headerSlot = slot;
    const finishHeader = () => {
      if (slot - headerSlot > 1) header.span = slot - headerSlot;
    };
    if (folded.has(group.chapterId)) {
      story.plotLines.forEach((p, i) => {
        const count = group.cards.filter((c) => c.plotLine === p.id || c.alsoIn.includes(p.id)).length;
        items.push({ item: { kind: "chapter-folded", chapterId: group.chapterId, plotLineId: p.id, count }, slot, lane: i + 1 });
      });
      slot++;
      finishHeader();
      continue;
    }
    // Chapter header slot also carries an "add card" button in every lane.
    story.plotLines.forEach((p, i) => {
      items.push({ item: { kind: "add-card", chapterId: group.chapterId, plotLineId: p.id }, slot, lane: i + 1 });
    });
    slot++;
    if (compact) {
      const stacks: BoardItem[][] = story.plotLines.map(() => []);
      for (const row of sceneRows(group.cards, laneIndex)) {
        for (const card of row) {
          stacks[laneIndex.get(card.plotLine)!]!.push({ kind: "card", cardId: card.id });
          for (const other of card.alsoIn) {
            const echoLane = laneIndex.get(other);
            if (echoLane !== undefined && other !== card.plotLine) {
              stacks[echoLane]!.push({ kind: "echo", cardId: card.id, plotLineId: other });
            }
          }
        }
      }
      // One more slot than the tallest stack, so every lane ends with a drop zone.
      const height = Math.max(0, ...stacks.map((s) => s.length)) + 1;
      stacks.forEach((stack, lane) => {
        for (let i = 0; i < height; i++) {
          const item = stack[i] ?? { kind: "chapter-end", chapterId: group.chapterId, plotLineId: story.plotLines[lane]!.id };
          items.push({ item, slot: slot + i, lane: lane + 1 });
        }
      });
      slot += height;
      backgroundRows(group);
      finishHeader();
      continue;
    }
    for (const row of sceneRows(group.cards, laneIndex)) {
      const filled = new Set<number>();
      for (const card of row) {
        const lane = laneIndex.get(card.plotLine)!;
        filled.add(lane);
        items.push({ item: { kind: "card", cardId: card.id }, slot, lane: lane + 1 });
        for (const other of card.alsoIn) {
          const echoLane = laneIndex.get(other);
          if (echoLane === undefined || filled.has(echoLane)) continue;
          filled.add(echoLane);
          items.push({ item: { kind: "echo", cardId: card.id, plotLineId: other }, slot, lane: echoLane + 1 });
        }
      }
      // Every other lane gets an empty cell, so the whole row accepts drops.
      // It refers to the row's first card, which stands for the row.
      story.plotLines.forEach((p, i) => {
        if (!filled.has(i)) items.push({ item: { kind: "empty", cardId: row[0]!.id, plotLineId: p.id }, slot, lane: i + 1 });
      });
      slot++;
    }
    story.plotLines.forEach((p, i) => {
      items.push({ item: { kind: "chapter-end", chapterId: group.chapterId, plotLineId: p.id }, slot, lane: i + 1 });
    });
    slot++;
    backgroundRows(group);
    finishHeader();
  }

  closeRun(slot);

  if (events) showEvents(story, items, events.expanded, BOARD_COVERABLE, new Set(["empty"]));

  const vertical = orientation === "vertical";
  // With acts, every lane moves over by one to make room for the act column.
  const offset = hasActs ? 1 : 0;
  return {
    rows: vertical ? slot : laneCount + 1 + offset,
    columns: vertical ? laneCount + 1 + offset : slot,
    items: items.map(({ item, slot, lane, span, depth }) => ({
      item,
      row: (vertical ? slot : lane + offset) + 1,
      column: (vertical ? lane + offset : slot) + 1,
      ...(span !== undefined ? { span } : {}),
      ...(depth ? { depth } : {}),
    })),
    acts: hasActs,
  };
}

/**
 * Splits a chapter's cards into board rows. Cards that share an order share a
 * row, left to right by plot line. If two of them would need the same cell
 * (the same plot line, or one's echo where the other sits), the later one
 * starts another row with the same order.
 */
function sceneRows(cards: Card[], laneIndex: Map<string, number>): Card[][] {
  const rows: Card[][] = [];
  let lastOrder: number | null = null;
  let open: { cards: Card[]; lanes: Set<number> }[] = [];
  const placed = cards
    .filter((c) => laneIndex.has(c.plotLine)) // its plot line no longer exists
    .sort((a, b) => a.order - b.order || laneIndex.get(a.plotLine)! - laneIndex.get(b.plotLine)! || a.id.localeCompare(b.id));
  for (const card of placed) {
    if (card.order !== lastOrder) {
      open = [];
      lastOrder = card.order;
    }
    const lanes = [card.plotLine, ...card.alsoIn].map((p) => laneIndex.get(p)).filter((l): l is number => l !== undefined);
    let row = open.find((r) => lanes.every((l) => !r.lanes.has(l)));
    if (!row) {
      row = { cards: [], lanes: new Set() };
      open.push(row);
      rows.push(row.cards);
    }
    row.cards.push(card);
    lanes.forEach((l) => row!.lanes.add(l));
  }
  return rows;
}

/**
 * "Show events": each event, in place of its scenes, as one card in its own
 * plot line, running from the row of its first scene to the row of its last
 * (across chapters), with an echo in every other plot line its scenes are in.
 * The card covers only empty space and its own scenes; if something else is in
 * the way, it shows where its own scenes are instead, one card per run of them.
 * An event without scenes shows at the end of the chapter chosen for it.
 * Works on the items before they become grid lines; `coverable` names the
 * kinds of empty space a card may cover, and `runOver` those an echo may.
 */
export function showEvents<T extends { kind: string }>(
  story: Story,
  items: { item: T | BoardItem; slot: number; lane: number; span?: number; depth?: number }[],
  expanded: ReadonlySet<string>,
  coverable: ReadonlySet<string>,
  runOver: ReadonlySet<string>,
): void {
  const eventIds = new Set(story.events.map((e) => e.id));
  const laneOf = new Map(story.plotLines.map((p, i) => [p.id, i + 1]));
  type Found = { slot: number; end: number; index: number; cardId: string };
  const found = new Map<string, Map<number, Found[]>>();
  items.forEach((placed, index) => {
    const it = placed.item as { kind: string; cardId?: string };
    if ((it.kind !== "card" && it.kind !== "echo") || !it.cardId) return;
    const event = story.cards[it.cardId]?.event;
    if (!event || !eventIds.has(event) || expanded.has(event)) return;
    const lanes = found.get(event) ?? new Map<number, Found[]>();
    found.set(event, lanes);
    const list = lanes.get(placed.lane) ?? [];
    lanes.set(placed.lane, list);
    list.push({ slot: placed.slot, end: placed.slot + (placed.span ?? 1) - 1, index, cardId: it.cardId });
  });
  const cells = new Map<string, number[]>();
  items.forEach((placed, index) => {
    if (placed.lane <= 0) return;
    const key = `${placed.lane}:${placed.slot}`;
    cells.set(key, [...(cells.get(key) ?? []), index]);
  });
  const cellsAt = (lane: number, slot: number) => cells.get(`${lane}:${slot}`) ?? [];
  const drop = new Set<number>();
  const added: typeof items = [];
  const push = (kind: "event-card" | "event-echo", eventId: string, lane: number, from: number, to: number, cardIds: string[]) => {
    const plotLineId = story.plotLines[lane - 1]?.id ?? "";
    added.push({ item: { kind, eventId, plotLineId, cardIds } as BoardItem, slot: from, lane, span: to - from + 1, depth: 0 });
  };
  for (const [eventId, lanes] of found) {
    const all = [...lanes.values()].flat();
    const main = laneOf.get(eventPlotLine(story, eventId) ?? "") ?? 1;
    const from = Math.min(...all.map((f) => f.slot));
    const to = Math.max(...all.map((f) => f.end));
    const own = new Set(all.map((f) => f.index));
    // One card in its own plot line, across all its rows. Empty space under it
    // goes; anything else in those rows (another scene, a long card) stays, on
    // top of it and a step in, as on a long card in story time.
    for (let slot = from; slot <= to; slot++) {
      for (const index of cellsAt(main, slot)) {
        if (own.has(index)) continue;
        const placed = items[index]!;
        const kind = placed.item.kind;
        if (coverable.has(kind) && !(kind === "time-cell" && !coverable.has("time-end") && (placed.item as { end?: boolean }).end)) drop.add(index);
        else placed.depth = (placed.depth ?? 0) + 1;
      }
    }
    push("event-card", eventId, main, from, to, [...new Set(all.map((f) => f.cardId))]);
    // In every other plot line, a small echo for each of its scenes there, in that scene's row.
    for (const [lane, list] of lanes) {
      for (const f of list) {
        drop.add(f.index);
        if (lane !== main) push("event-echo", eventId, lane, f.slot, f.slot, [f.cardId]);
      }
    }
  }

  // Events without scenes: at the end of their chosen chapter, in their plot line.
  for (const event of story.events) {
    if (!event.chapter || found.has(event.id) || story.cards && Object.values(story.cards).some((c) => c.event === event.id)) continue;
    const lane = laneOf.get(eventPlotLine(story, event.id) ?? "") ?? 1;
    const at = items.findIndex(
      (p) => p.lane === lane && p.item.kind === "chapter-end" && (p.item as { chapterId?: string | null }).chapterId === event.chapter && !drop.has(items.indexOf(p)),
    );
    if (at === -1) continue;
    drop.add(at);
    push("event-card", event.id, lane, items[at]!.slot, items[at]!.slot, []);
  }

  // An event inside another in the same plot line (its rows within the
  // other's, or starting later where they overlap) sits on top of it, a step
  // in, as a card on a long one does.
  const cardsOf = added.filter((a) => a.item.kind === "event-card");
  const outerFirst = [...cardsOf].sort((a, b) => (b.span ?? 1) - (a.span ?? 1) || a.slot - b.slot);
  outerFirst.forEach((inner, i) => {
    const end = inner.slot + (inner.span ?? 1) - 1;
    for (const outer of outerFirst.slice(0, i)) {
      if (outer.lane === inner.lane && outer.slot <= end && outer.slot + (outer.span ?? 1) - 1 >= inner.slot) inner.depth = (inner.depth ?? 0) + 1;
    }
  });

  const kept = items.filter((_, i) => !drop.has(i));
  items.length = 0;
  items.push(...kept, ...added);
}
