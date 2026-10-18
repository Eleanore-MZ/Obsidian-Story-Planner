import { Card, Id, Story } from "./types";

// Pure edits behind drag and drop. They change the story in place, keep scene
// orders as 1, 2, 3, ... within each chapter, and stamp every card whose
// position changed, so a sync conflict keeps the most recent arrangement.

export interface CardTarget {
  /** Destination chapter; null for the off-page group. */
  chapter: Id | null;
  /** Destination plot line (the card's new primary plot line). */
  plotLine: Id;
  /** Place the card just before this card; null or omitted puts it last. */
  beforeCardId?: Id | null;
}

/** Cards of one chapter (or the off-page group) in scene order. */
export function chapterCards(story: Story, chapter: Id | null): Card[] {
  const chapterIds = new Set(story.chapters.map((c) => c.id));
  return Object.values(story.cards)
    .filter((c) => (chapter === null ? c.chapter === null || !chapterIds.has(c.chapter) : c.chapter === chapter))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** Moves a card to a new chapter, plot line and scene position. Returns false if nothing changed. */
export function moveCard(story: Story, cardId: Id, target: CardTarget, now = new Date().toISOString()): boolean {
  const card = story.cards[cardId];
  if (!card || target.beforeCardId === cardId) return false;

  const sourceChapter = card.chapter;
  const before = summarize(story);

  if (card.plotLine !== target.plotLine) {
    // Moving into a secondary plot line makes it primary, so drop its echo there.
    card.alsoIn = card.alsoIn.filter((p) => p !== target.plotLine);
    card.plotLine = target.plotLine;
  }

  const siblings = chapterCards(story, target.chapter).filter((c) => c.id !== cardId);
  let index = target.beforeCardId ? siblings.findIndex((c) => c.id === target.beforeCardId) : -1;
  if (index === -1) index = siblings.length;
  siblings.splice(index, 0, card);
  card.chapter = target.chapter;
  renumber(siblings);

  if (sourceChapter !== target.chapter) {
    renumber(chapterCards(story, sourceChapter));
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

function renumber(cards: Card[]): void {
  cards.forEach((c, i) => (c.order = i + 1));
}

function summarize(story: Story): Map<Id, string> {
  return new Map(Object.values(story.cards).map((c) => [c.id, `${c.chapter}|${c.plotLine}|${c.order}`]));
}
