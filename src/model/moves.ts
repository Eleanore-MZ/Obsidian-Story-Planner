import { Card, Id, Story } from "./types";

// Pure edits behind drag and drop. They change the story in place, keep scene
// orders as 1, 2, 3, ... within each chapter, and stamp every card whose
// position changed, so a sync conflict keeps the most recent arrangement.
// Cards that share an order share a row on the board: scenes in different plot
// lines that happen at the same point of the book.

export interface CardTarget {
  /** Destination chapter; null for the off-page group. */
  chapter: Id | null;
  /** Destination plot line (the card's new primary plot line). */
  plotLine: Id;
  /** Place the card in a new row just before this card's row; null or omitted puts it last. */
  beforeCardId?: Id | null;
  /** Place the card in a new row just after this card's row. */
  afterCardId?: Id | null;
  /** Place the card in this card's row, beside it. */
  besideCardId?: Id | null;
}

/** Cards of one chapter (or the off-page group) in scene order. */
export function chapterCards(story: Story, chapter: Id | null): Card[] {
  const chapterIds = new Set(story.chapters.map((c) => c.id));
  return Object.values(story.cards)
    .filter((c) => (chapter === null ? c.chapter === null || !chapterIds.has(c.chapter) : c.chapter === chapter))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** Rows of one chapter (or the off-page group): cards that share an order, in scene order. */
export function chapterRows(story: Story, chapter: Id | null): Card[][] {
  const rows: Card[][] = [];
  for (const card of chapterCards(story, chapter)) {
    const last = rows[rows.length - 1];
    if (last && last[0]!.order === card.order) last.push(card);
    else rows.push([card]);
  }
  return rows;
}

/** Moves a card to a new chapter, plot line and scene position. Returns false if nothing changed. */
export function moveCard(story: Story, cardId: Id, target: CardTarget, now = new Date().toISOString()): boolean {
  const card = story.cards[cardId];
  if (!card) return false;

  const sourceChapter = card.chapter;
  const before = summarize(story);

  if (card.plotLine !== target.plotLine) {
    // Moving into a secondary plot line makes it primary, so drop its echo there.
    card.alsoIn = card.alsoIn.filter((p) => p !== target.plotLine);
    card.plotLine = target.plotLine;
  }

  // Find the reference row while the card is still in place, so a drop next
  // to the card itself (for example to change only its plot line) keeps its row.
  const rows = chapterRows(story, target.chapter);
  const relative = target.besideCardId ?? target.beforeCardId ?? target.afterCardId ?? null;
  const rowIndex = relative ? rows.findIndex((row) => row.some((c) => c.id === relative)) : -1;
  for (const row of rows) {
    const i = row.findIndex((c) => c.id === cardId);
    if (i !== -1) row.splice(i, 1);
  }

  if (rowIndex === -1) rows.push([card]);
  else if (target.besideCardId) rows[rowIndex]!.push(card);
  else if (target.beforeCardId) rows.splice(rowIndex, 0, [card]);
  else rows.splice(rowIndex + 1, 0, [card]);
  card.chapter = target.chapter;
  // A scene told in a chapter no longer happens in the background of one.
  if (target.chapter !== null) delete card.during;
  renumber(rows);

  if (sourceChapter !== target.chapter) {
    renumber(chapterRows(story, sourceChapter));
  }

  // Stamp every card whose chapter, plot line or order changed.
  const after = summarize(story);
  let changed = false;
  for (const [id, was] of before) {
    if (after.get(id) !== was) {
      story.cards[id]!.modified = now;
      changed = true;
    }
  }
  return changed;
}

/** Moves an item within a list (plot lines, chapters) to just before another one, or to the end. */
export function moveInList<T extends { id: Id }>(list: T[], id: Id, beforeId: Id | null): boolean {
  const from = list.findIndex((x) => x.id === id);
  if (from === -1 || id === beforeId) return false;
  const original = list.map((x) => x.id).join("\n");
  const [item] = list.splice(from, 1);
  let to = beforeId === null ? -1 : list.findIndex((x) => x.id === beforeId);
  if (to === -1) to = list.length;
  list.splice(to, 0, item!);
  return list.map((x) => x.id).join("\n") !== original;
}

/** Numbers rows 1, 2, 3, ...; every card in a row gets its row's number. Empty rows disappear. */
function renumber(rows: Card[][]): void {
  let order = 0;
  for (const row of rows) {
    if (row.length === 0) continue;
    order++;
    for (const card of row) card.order = order;
  }
}

function summarize(story: Story): Map<Id, string> {
  return new Map(Object.values(story.cards).map((c) => [c.id, `${c.chapter}|${c.plotLine}|${c.order}`]));
}
