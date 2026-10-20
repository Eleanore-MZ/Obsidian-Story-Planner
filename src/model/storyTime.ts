import { cardMoment, dateInZone, dateSpan, effectiveZone, mainCalendar, precisionOf } from "./calendar";
import { locationAndInside } from "./setup";
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

/** A card's end date seen in the reference zone, like referenceDate. */
export function referenceEndDate(story: Story, card: Card): StoryDate | undefined {
  if (!card.endDate) return undefined;
  return referenceDate(story, { ...card, date: card.endDate });
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

/**
 * Puts a card after every other card at its moment, for a card just added
 * there: it takes the next `timeOrder` when the others have one.
 */
export function placeLastInTime(story: Story, cardId: Id): void {
  const card = story.cards[cardId];
  if (!card?.date) return;
  const m = cardMoment(story, card)!;
  const orders = Object.values(story.cards)
    .filter((c) => c !== card && c.date && c.timeOrder !== undefined)
    .filter((c) => {
      const o = cardMoment(story, c)!;
      return o.key === m.key && o.precision === m.precision;
    })
    .map((c) => c.timeOrder!);
  if (orders.length > 0) card.timeOrder = Math.max(...orders) + 1;
}

/**
 * The stretch of time a card covers on the story's line of minutes, for
 * spotting clashes: a clock time covers its hour, a part of the day its
 * hours, and a card with an end date runs to the end of that date. A card
 * known only to the day (or less) with no end date covers no definite
 * stretch, since a day has room for a journey, so it never clashes.
 */
export function cardInterval(story: Story, card: Card): [number, number] | undefined {
  if (!card.date) return undefined;
  const calendar = mainCalendar(story);
  const start = referenceDate(story, card)!;
  const precision = precisionOf(card.date);
  if (card.endDate) {
    const zone = effectiveZone(story, card).zone?.id;
    const endPrecision = precisionOf(card.endDate);
    const shifted = (endPrecision === "time" || endPrecision === "dayPart") && zone && zone !== story.referenceZone;
    const end = shifted ? dateInZone(story, card.endDate, zone, story.referenceZone) : { ...card.endDate };
    delete end.zone;
    if (start.day === undefined || end.day === undefined) return undefined;
    return [dateSpan(calendar, start)[0], dateSpan(calendar, end)[1]];
  }
  if (precision !== "time" && precision !== "dayPart") return undefined;
  if (precision === "time") {
    const startKey = dateSpan(calendar, { ...start, minutes: start.minutes ?? 0 })[0];
    return [startKey, startKey + calendar.minutesPerHour];
  }
  return dateSpan(calendar, start);
}

export interface Clash {
  characterId: Id;
  /** Two cards with this character whose times overlap in places that are not one inside the other. */
  cards: [Id, Id];
}

/**
 * Finds characters who are in two places at once: two of their cards
 * overlap in time while their locations differ, after converting to the
 * reference zone. A place inside another (a room in a house) is not a
 * different place. Advisory only, since a story may mean it (a twin, a lie).
 * A mentioned character is not there, so mentions never clash.
 */
export function findClashes(story: Story): Clash[] {
  const clashes: Clash[] = [];
  const placed = Object.values(story.cards)
    .filter((c) => c.location && story.locations.some((l) => l.id === c.location))
    .map((card) => ({ card, interval: cardInterval(story, card) }))
    .filter((x): x is { card: Card; interval: [number, number] } => !!x.interval)
    .sort((a, b) => a.interval[0] - b.interval[0] || a.card.id.localeCompare(b.card.id));
  const inside = new Map<Id, Set<Id>>();
  const within = (id: Id) => inside.get(id) ?? inside.set(id, locationAndInside(story, id)).get(id)!;
  for (const character of story.characters) {
    const theirs = placed.filter(({ card }) => card.characters.some((c) => c.id === character.id && c.role !== "mentioned"));
    for (let i = 0; i < theirs.length; i++) {
      for (let j = i + 1; j < theirs.length; j++) {
        const a = theirs[i]!;
        const b = theirs[j]!;
        if (b.interval[0] >= a.interval[1]) break;
        const la = a.card.location!;
        const lb = b.card.location!;
        if (within(la).has(lb) || within(lb).has(la)) continue;
        clashes.push({ characterId: character.id, cards: [a.card.id, b.card.id] });
      }
    }
  }
  return clashes;
}
