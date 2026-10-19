import { cardMoment, dateInZone, effectiveZone, precisionOf } from "./calendar";
import { Card, Id, Story, StoryDate } from "./types";

// Story order: where cards fall in the story's own time, as opposed to the
// reading order of chapters and scenes. Pure, for the story-time view.

/** A card's date seen in the reference zone, which is what the axis uses. */
export function referenceDate(story: Story, card: Card): StoryDate | undefined {
  if (!card.date) return undefined;
  const zone = effectiveZone(story, card).zone?.id;
  const precision = precisionOf(card.date);
  const shifted = (precision === "time" || precision === "dayPart") && zone && zone !== story.referenceZone;
  const date = shifted ? dateInZone(story, card.date, zone, story.referenceZone) : { ...card.date };
  delete date.zone;
  delete date.approximate;
  return date;
}

/** Story order: by moment, less precise first, then the writer's own order, then reading order. */
export function timeSorted(story: Story, cards: Card[]): Card[] {
  const reading = readingOrder(story);
  const rank = { year: 0, month: 1, day: 2, dayPart: 3, time: 4 } as const;
  const keyed = cards.map((card) => ({ card, moment: cardMoment(story, card)! }));
  keyed.sort(
    (x, y) =>
      x.moment.key - y.moment.key ||
      rank[x.moment.precision] - rank[y.moment.precision] ||
      (x.card.timeOrder ?? 0) - (y.card.timeOrder ?? 0) ||
      (reading.get(x.card.id) ?? 0) - (reading.get(y.card.id) ?? 0),
  );
  return keyed.map((k) => k.card);
}

/** Each card's place in reading order: chapter by chapter, off-page last. */
export function readingOrder(story: Story): Map<Id, number> {
  const chapterIndex = new Map(story.chapters.map((c, i) => [c.id, i]));
  const sorted = Object.values(story.cards).sort(
    (a, b) =>
      (chapterIndex.get(a.chapter ?? "") ?? story.chapters.length) - (chapterIndex.get(b.chapter ?? "") ?? story.chapters.length) ||
      a.order - b.order ||
      a.id.localeCompare(b.id),
  );
  return new Map(sorted.map((c, i) => [c.id, i]));
}

/**
 * Moves a card before or after another that happens at the same moment, by
 * renumbering the writer's own order (`timeOrder`) among the cards at that
 * moment. Returns false when the two cards are not at the same moment, since
 * dates, not manual order, separate those.
 */
export function reorderInTime(story: Story, cardId: Id, targetId: Id, after: boolean, now = new Date().toISOString()): boolean {
  const card = story.cards[cardId];
  const target = story.cards[targetId];
  if (!card || !target || card === target || !card.date || !target.date) return false;
  const a = cardMoment(story, card)!;
  const b = cardMoment(story, target)!;
  if (a.key !== b.key || a.precision !== b.precision) return false;
  const same = timeSorted(
    story,
    Object.values(story.cards).filter((c) => {
      if (!c.date || c === card) return false;
      const m = cardMoment(story, c)!;
      return m.key === b.key && m.precision === b.precision;
    }),
  );
  same.splice(same.indexOf(target) + (after ? 1 : 0), 0, card);
  same.forEach((c, i) => {
    if (c.timeOrder !== i + 1) {
      c.timeOrder = i + 1;
      c.modified = now;
    }
  });
  return true;
}
