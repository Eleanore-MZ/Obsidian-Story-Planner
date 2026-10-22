import { compareDates } from "./calendar";
import { addCharacterByName, deleteCard, setCardDate, setCardDuring, setCardLocation, setCardTag, updateCard, updateCardCharacter } from "./edits";
import { CardTarget, moveCard } from "./moves";
import { cardsInReadingOrder } from "./search";
import { setCardOrg } from "./entities";
import { setCardEvent } from "./events";
import { Card, CharacterRole, Id, OrgRole, Story, StoryDate } from "./types";

// Edits to several selected cards at once. Each is one change to the story,
// so the board records it as one undo step. Cards are taken in reading order,
// so moving them keeps them in the order they had.

/** The selected cards that still exist, in reading order. */
export function selectedCards(story: Story, ids: Iterable<Id>): Card[] {
  const wanted = new Set(ids);
  return cardsInReadingOrder(story).filter((c) => wanted.has(c.id));
}

/** What the selected cards share for one field: the common value, or "mixed". */
export function common<T>(cards: Card[], value: (card: Card) => T): T | "mixed" {
  if (cards.length === 0) return "mixed";
  const first = JSON.stringify(value(cards[0]!));
  return cards.every((c) => JSON.stringify(value(c)) === first) ? value(cards[0]!) : "mixed";
}

/** Whether all, some or none of the cards have a tag. */
export function tagState(cards: Card[], tag: Id): "all" | "some" | "none" {
  const n = cards.filter((c) => c.tags.includes(tag)).length;
  return n === 0 ? "none" : n === cards.length ? "all" : "some";
}

/** Puts a tag on every card, or takes it off every card. */
export function setTagOnCards(story: Story, ids: Iterable<Id>, tag: Id, on: boolean, now = new Date().toISOString()): boolean {
  let changed = false;
  for (const card of selectedCards(story, ids)) changed = setCardTag(story, card.id, tag, on, now) || changed;
  return changed;
}

/** Moves the cards to the end of a chapter (or off-page, for null), keeping their order and plot lines. */
export function moveCardsToChapter(story: Story, ids: Iterable<Id>, chapter: Id | null, now = new Date().toISOString()): boolean {
  let changed = false;
  for (const card of selectedCards(story, ids)) {
    if (card.chapter === chapter) continue;
    changed = moveCard(story, card.id, { chapter, plotLine: card.plotLine }, now) || changed;
  }
  return changed;
}

/** Moves the cards to a plot line, each staying in its own row. */
export function moveCardsToPlotLine(story: Story, ids: Iterable<Id>, plotLine: Id, now = new Date().toISOString()): boolean {
  let changed = false;
  for (const card of selectedCards(story, ids)) {
    if (card.plotLine === plotLine) continue;
    changed = moveCard(story, card.id, { chapter: card.chapter, plotLine, besideCardId: card.id }, now) || changed;
  }
  return changed;
}

/** Gives every card the same date; an end date that would come before it is taken off. */
export function setDateOnCards(story: Story, ids: Iterable<Id>, date: StoryDate | undefined, now = new Date().toISOString()): boolean {
  let changed = false;
  for (const card of selectedCards(story, ids)) {
    changed = setCardDate(story, card.id, "date", date && { ...date }, now) || changed;
    const c = story.cards[card.id]!;
    if (date && c.endDate && compareDates(story, c.endDate, date) < 0) {
      delete c.endDate;
      changed = true;
    }
  }
  return changed;
}

export function setWrittenOnCards(story: Story, ids: Iterable<Id>, written: boolean, now = new Date().toISOString()): boolean {
  let changed = false;
  for (const card of selectedCards(story, ids)) changed = updateCard(story, card.id, { written }, now) || changed;
  return changed;
}

export function setLocationOnCards(story: Story, ids: Iterable<Id>, location: Id | undefined, now = new Date().toISOString()): boolean {
  let changed = false;
  for (const card of selectedCards(story, ids)) changed = setCardLocation(story, card.id, location, now) || changed;
  return changed;
}

/** Adds a character, by name, to every card; a new name becomes one new character. */
export function addCharacterToCards(story: Story, ids: Iterable<Id>, name: string, now = new Date().toISOString()): boolean {
  let changed = false;
  for (const card of selectedCards(story, ids)) changed = addCharacterByName(story, card.id, name, "present", now) || changed;
  return changed;
}

export function deleteCards(story: Story, ids: Iterable<Id>, now = new Date().toISOString()): boolean {
  let changed = false;
  for (const card of selectedCards(story, ids)) changed = deleteCard(story, card.id, now) || changed;
  return changed;
}

/** The role after this one when a role is clicked: present, then point of view, then mentioned, then present again. */
export function nextRole(role: CharacterRole | "mixed"): CharacterRole {
  return role === "present" ? "pov" : role === "pov" ? "mentioned" : "present";
}

/** Every character on any of the cards, with their role there, or "mixed" when the cards differ, and whether all the cards have them. */
export function characterRoles(story: Story, cards: Card[]): { id: Id; role: CharacterRole | "mixed"; onAll: boolean }[] {
  return story.characters
    .map((c) => {
      const entries = cards.map((card) => card.characters.find((e) => e.id === c.id)).filter((e): e is NonNullable<typeof e> => !!e);
      if (entries.length === 0) return null;
      const role = entries.every((e) => e.role === entries[0]!.role) ? entries[0]!.role : "mixed";
      return { id: c.id, role, onAll: entries.length === cards.length };
    })
    .filter((x): x is { id: Id; role: CharacterRole | "mixed"; onAll: boolean } => x !== null);
}

/** Gives a character one role on every card that has them. */
export function setRoleOnCards(story: Story, ids: Iterable<Id>, characterId: Id, role: CharacterRole, now = new Date().toISOString()): boolean {
  let changed = false;
  for (const card of selectedCards(story, ids)) changed = updateCardCharacter(story, card.id, characterId, { role }, now) || changed;
  return changed;
}

/**
 * Several selected cards dropped on the board together, where `anchorId` (the
 * card held) was dropped at `target`. Every card goes to the target's plot
 * line, unless they move to another chapter: then each keeps its own plot
 * line. Which of them go to the drop's place:
 *
 * - Dropped in another chapter than the held card's: all of them join that
 *   chapter (or the off-page group). A selection with both off-page events and
 *   scenes is the exception: only the off-page events join it, and the scenes
 *   keep their chapters.
 * - Dropped before or after a card in the held card's own chapter: the
 *   selected cards in that chapter move there as a block; the rest keep theirs.
 * - Dropped beside a card or in an empty cell of its own row: no card changes
 *   chapter or row, only plot line.
 *
 * The cards that move to the drop's place go there one after another, in
 * reading order. With `background`, off-page events joining a chapter stay
 * off-page and happen during it instead. One change, so one undo step.
 */
export function moveCardsTo(
  story: Story,
  ids: Iterable<Id>,
  anchorId: Id,
  target: CardTarget,
  background = false,
  now = new Date().toISOString(),
): boolean {
  const cards = selectedCards(story, ids);
  const anchor = story.cards[anchorId];
  if (!anchor || cards.length === 0) return false;
  const chapterIds = new Set(story.chapters.map((c) => c.id));
  const offPage = (c: Card) => c.chapter === null || !chapterIds.has(c.chapter);
  const mixed = cards.some(offPage) && cards.some((c) => !offPage(c));
  const relative = target.beforeCardId ?? target.afterCardId ?? null;
  // Into another chapter, the cards keep their own plot lines; within one, they take the dropped-in plot line.
  const toChapter = target.chapter !== anchor.chapter;
  const laneOf = (card: Card) => (toChapter ? card.plotLine : target.plotLine);

  let joiners: Card[];
  if (toChapter) joiners = mixed ? cards.filter(offPage) : cards;
  else if (relative) joiners = cards.filter((c) => c.chapter === target.chapter);
  else joiners = [];
  // In the background, only off-page events go to the chapter, and they stay off-page.
  const during = background && target.chapter !== null ? target.chapter : null;
  if (during) joiners = joiners.filter(offPage);
  const joining = new Set(joiners.map((c) => c.id));

  let changed = false;
  // The rest change plot line only, each keeping its row.
  for (const card of cards) {
    if (joining.has(card.id) || card.plotLine === laneOf(card)) continue;
    changed = moveCard(story, card.id, { chapter: card.chapter, plotLine: laneOf(card), besideCardId: card.id }, now) || changed;
  }
  // The others go to the drop's place one after another. Dropping before or after a selected card places them by the
  // first unselected card instead, or at the chapter's end.
  let previous: Id | null = null;
  const place = (card: Card): CardTarget => {
    const chapter = during ? null : target.chapter;
    const plotLine = laneOf(card);
    if (previous) return { chapter, plotLine, afterCardId: previous };
    if (during) return { chapter, plotLine };
    const ref = target.beforeCardId ?? target.afterCardId ?? target.besideCardId;
    if (ref && joining.has(ref)) return { chapter, plotLine };
    return { ...target, chapter, plotLine };
  };
  for (const card of joiners) {
    changed = moveCard(story, card.id, place(card), now) || changed;
    if (during) changed = setCardDuring(story, card.id, during, now) || changed;
    else if (story.cards[card.id]!.chapter !== null && story.cards[card.id]!.during) {
      delete story.cards[card.id]!.during;
      changed = true;
    }
    previous = card.id;
  }
  return changed;
}

/** Puts an organization on every card (involved), or takes it off with null; or gives it one role on every card that has it. */
export function setOrgOnCards(story: Story, ids: Iterable<Id>, orgId: Id, role: OrgRole | null, onlyWhereItIs = false, now = new Date().toISOString()): boolean {
  let changed = false;
  for (const card of selectedCards(story, ids)) {
    const has = card.orgs?.some((o) => o.id === orgId);
    if (onlyWhereItIs && !has) continue;
    if (role === "involved" && has && !onlyWhereItIs) continue;
    changed = setCardOrg(story, card.id, orgId, role, now) || changed;
  }
  return changed;
}

/** Puts every card in an event, or in none with undefined. */
export function setEventOnCards(story: Story, ids: Iterable<Id>, eventId: Id | undefined, now = new Date().toISOString()): boolean {
  let changed = false;
  for (const card of selectedCards(story, ids)) changed = setCardEvent(story, card.id, eventId, now) || changed;
  return changed;
}
