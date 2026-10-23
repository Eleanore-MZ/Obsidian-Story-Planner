import { compareDates } from "./calendar";
import { newId } from "./defaults";
import { cardsInReadingOrder } from "./search";
import { freeColor, plotLineColor } from "./setup";
import { referenceDate, referenceEndDate, timeSorted } from "./storyTime";
import { Card, Id, Story, StoryDate, StoryEvent } from "./types";

// Events: things that happen across several scenes. A card is part of at most
// one event; an event can be part of one arc (an event one level up). Events
// keep the writer's order in the story's list.

export function addEvent(story: Story, title: string, parent?: Id): Id {
  const event: StoryEvent = { id: newId("e"), title: title.trim(), color: freeColor(story.events) };
  if (parent && canBeParent(story, parent, event.id)) event.parent = parent;
  story.events.push(event);
  return event.id;
}

/** True when `parent` can hold `childId`: an event that is not itself inside another, and not the event itself. */
export function canBeParent(story: Story, parent: Id, childId: Id): boolean {
  const p = story.events.find((e) => e.id === parent);
  if (!p || p.id === childId || p.parent) return false;
  // An event that holds others cannot go inside another: one level only.
  return !story.events.some((e) => e.parent === childId);
}

/** Puts an event inside an arc, or takes it out with undefined. */
export function setEventParent(story: Story, id: Id, parent: Id | undefined): boolean {
  const event = story.events.find((e) => e.id === id);
  if (!event || event.parent === parent) return false;
  if (parent && !canBeParent(story, parent, id)) return false;
  if (parent) event.parent = parent;
  else delete event.parent;
  return true;
}

/** Deletes an event: its cards belong to no event, and the events inside it move up a level. */
export function deleteEvent(story: Story, id: Id, now = new Date().toISOString()): boolean {
  if (!story.events.some((e) => e.id === id)) return false;
  story.events = story.events.filter((e) => e.id !== id);
  for (const e of story.events) if (e.parent === id) delete e.parent;
  for (const card of Object.values(story.cards)) {
    if (card.event === id) {
      delete card.event;
      card.modified = now;
    }
  }
  return true;
}

/** Puts a card in an event, or takes it out of its event with undefined. */
export function setCardEvent(story: Story, cardId: Id, eventId: Id | undefined, now = new Date().toISOString()): boolean {
  const card = story.cards[cardId];
  if (!card || card.event === eventId) return false;
  if (eventId && !story.events.some((e) => e.id === eventId)) return false;
  if (eventId) card.event = eventId;
  else delete card.event;
  card.modified = now;
  return true;
}

/** The event a card is in, if it still exists. */
export function eventOf(story: Story, card: Card): StoryEvent | undefined {
  return card.event ? story.events.find((e) => e.id === card.event) : undefined;
}

/** A card's events from the outside in: its arc (if any), then its event. */
export function eventPath(story: Story, card: Card): StoryEvent[] {
  const event = eventOf(story, card);
  if (!event) return [];
  const parent = event.parent ? story.events.find((e) => e.id === event.parent) : undefined;
  return parent ? [parent, event] : [event];
}

/** An event's cards in story order: dated ones by their dates, then undated ones in reading order. With `inside`, the cards of the events in it too. */
export function eventCards(story: Story, id: Id, inside = false): Card[] {
  const ids = new Set([id, ...(inside ? story.events.filter((e) => e.parent === id).map((e) => e.id) : [])]);
  const cards = cardsInReadingOrder(story).filter((c) => c.event && ids.has(c.event));
  return [...timeSorted(story, cards.filter((c) => c.date)), ...cards.filter((c) => !c.date)];
}

/** Events as a tree, in the writer's order: each top-level event (an arc, when it holds others) with the events in it. */
export function eventTree(story: Story): { event: StoryEvent; children: StoryEvent[] }[] {
  const ids = new Set(story.events.map((e) => e.id));
  return story.events
    .filter((e) => !e.parent || !ids.has(e.parent))
    .map((event) => ({ event, children: story.events.filter((e) => e.parent === event.id) }));
}

/**
 * When an event happens: the writer's own start and end when set, otherwise
 * the earliest start and the latest end among its cards (and, for an arc,
 * the cards of the events in it).
 */
export function eventSpan(story: Story, id: Id): { start?: StoryDate; end?: StoryDate } {
  const event = story.events.find((e) => e.id === id);
  if (!event) return {};
  let start = event.start;
  let end = event.end;
  for (const card of eventCards(story, id, true)) {
    const from = referenceDate(story, card);
    const to = referenceEndDate(story, card) ?? from;
    if (!event.start && from && (!start || compareDates(story, from, start) < 0)) start = from;
    if (!event.end && to && (!end || compareDates(story, to, end) > 0)) end = to;
  }
  return { ...(start ? { start } : {}), ...(end ? { end } : {}) };
}

/**
 * Moves an event in the list, before another (or to the end with null), and
 * into that one's arc; with `into`, it goes inside that event instead, last.
 */
export function moveEvent(story: Story, id: Id, beforeId: Id | null, into?: Id): boolean {
  const event = story.events.find((e) => e.id === id);
  if (!event || beforeId === id) return false;
  const before = JSON.stringify(story.events);
  const parent = into ?? (beforeId ? story.events.find((e) => e.id === beforeId)?.parent : undefined);
  if (parent !== event.parent) {
    if (parent && !canBeParent(story, parent, id)) return false;
    if (parent) event.parent = parent;
    else delete event.parent;
  }
  const rest = story.events.filter((e) => e.id !== id);
  let at = beforeId && !into ? rest.findIndex((e) => e.id === beforeId) : -1;
  if (into) {
    // After the last event already inside it, or right after it.
    const inside = rest.map((e, i) => (e.parent === into ? i : -1)).filter((i) => i !== -1);
    at = (inside.length > 0 ? inside[inside.length - 1]! : rest.findIndex((e) => e.id === into)) + 1;
  }
  if (at === -1) rest.push(event);
  else rest.splice(at, 0, event);
  story.events = rest;
  return JSON.stringify(story.events) !== before;
}

/** The plot line an event lives in: the writer's choice, or the one most of its scenes are in, or the first. */
export function eventPlotLine(story: Story, id: Id): Id | undefined {
  const event = story.events.find((e) => e.id === id);
  if (!event) return undefined;
  if (event.plotLine && story.plotLines.some((p) => p.id === event.plotLine)) return event.plotLine;
  const counts = new Map<Id, number>();
  for (const card of eventCards(story, id, true)) counts.set(card.plotLine, (counts.get(card.plotLine) ?? 0) + 1);
  // The most scenes; on a tie, the plot line further left.
  let best: Id | undefined;
  for (const p of story.plotLines) if ((counts.get(p.id) ?? 0) > (best ? counts.get(best)! : 0)) best = p.id;
  return best ?? story.plotLines[0]?.id;
}

/** Sets the plot line an event lives in; a plot line that is already its automatic one clears the choice. */
export function setEventPlotLine(story: Story, id: Id, plotLine: Id): boolean {
  const event = story.events.find((e) => e.id === id);
  if (!event || !story.plotLines.some((p) => p.id === plotLine)) return false;
  if (eventPlotLine(story, id) === plotLine) return false;
  event.plotLine = plotLine;
  return true;
}

/** An event's colour: its main plot line's. */
export function eventColor(story: Story, id: Id): string {
  const plotLine = story.plotLines.find((p) => p.id === eventPlotLine(story, id));
  return plotLineColor(story, plotLine) ?? plotLine?.color ?? "var(--interactive-accent)";
}

/**
 * Whether the board shows an event's scenes in its place, while it shows
 * events: the arrow on an event's card adds it to the expanded ones, the
 * marker on one of its scenes takes it out again, and switching to events
 * starts with none expanded.
 */
export function toggleExpanded(expanded: readonly Id[], id: Id): Id[] {
  return expanded.includes(id) ? expanded.filter((x) => x !== id) : [...expanded, id];
}

/** Events with no cards of their own (and, for an arc, none in its events either). */
export function emptyEvents(story: Story): StoryEvent[] {
  return story.events.filter((e) => eventCards(story, e.id, true).length === 0);
}
