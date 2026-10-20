import { compareDates } from "./calendar";
import { addCharacterByName, deleteCard, setCardDate, setCardLocation, setCardTag, updateCard, updateCardCharacter } from "./edits";
import { moveCard } from "./moves";
import { cardsInReadingOrder } from "./search";
import { Card, CharacterRole, Id, Story, StoryDate } from "./types";

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
