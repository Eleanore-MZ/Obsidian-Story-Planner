import { actOf, actTitle, chapterTitleOf } from "./chapters";
import { noteName } from "./links";
import { locationPath } from "./setup";
import { Card, Story } from "./types";

// Board search: which cards match what the writer typed. Every word must
// appear somewhere on the card, ignoring case and accents, so "mara pier"
// finds Mara's scenes on the pier.

/** Lower case without accents, so "Ilse" matches "ilsé". */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Everything a search looks at on a card, folded. */
export function searchText(story: Story, card: Card): string {
  const parts = [card.title, card.synopsis];
  parts.push(story.plotLines.find((p) => p.id === card.plotLine)?.name ?? "");
  parts.push(chapterTitleOf(story, card.chapter), actTitle(story, actOf(story, card.chapter)));
  for (const entry of card.characters) {
    parts.push(story.characters.find((c) => c.id === entry.id)?.name ?? "", entry.note ?? "");
  }
  if (card.location && story.locations.some((l) => l.id === card.location)) parts.push(locationPath(story, card.location));
  if (story.tagsEnabled) for (const id of card.tags) parts.push(story.tags.find((t) => t.id === id)?.name ?? "");
  for (const path of card.notes) parts.push(noteName(path));
  return fold(parts.join("\n"));
}

/** The words of a query, folded; empty when there is nothing to search for. */
export function queryTerms(query: string): string[] {
  return fold(query).split(/\s+/).filter(Boolean);
}

export function cardMatches(story: Story, card: Card, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const text = searchText(story, card);
  return terms.every((term) => text.includes(term));
}

/** Cards in reading order: by chapter, then scene order, then plot line; off-page events last. */
export function cardsInReadingOrder(story: Story): Card[] {
  const chapter = new Map(story.chapters.map((c, i) => [c.id, i]));
  const lane = new Map(story.plotLines.map((p, i) => [p.id, i]));
  const chapterOf = (c: Card) => (c.chapter !== null && chapter.has(c.chapter) ? chapter.get(c.chapter)! : story.chapters.length);
  return Object.values(story.cards).sort(
    (a, b) =>
      chapterOf(a) - chapterOf(b) ||
      a.order - b.order ||
      (lane.get(a.plotLine) ?? Infinity) - (lane.get(b.plotLine) ?? Infinity) ||
      a.id.localeCompare(b.id),
  );
}

/** The cards matching a query, in reading order. */
export function searchCards(story: Story, query: string): Card[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  return cardsInReadingOrder(story).filter((card) => cardMatches(story, card, terms));
}
