import { createCard, newId } from "./defaults";
import { CardTarget, chapterCards, moveCard } from "./moves";
import { freeColor } from "./setup";
import { Card, CardCharacter, CharacterRole, Id, Story, StoryDate } from "./types";

// Pure edits behind the card editor. Like moves.ts they change the story in
// place and stamp `modified` on the card they touch, and they stay free of
// Obsidian so they can be unit tested.

/** Creates a card at a board position and returns its id. Without a position it goes last in the chapter. */
export function addCardAt(story: Story, target: CardTarget, title = "New card", now = new Date().toISOString()): Id {
  const order = chapterCards(story, target.chapter).reduce((max, c) => Math.max(max, c.order), 0) + 1;
  const card = createCard({ title, plotLine: target.plotLine, chapter: target.chapter, order, modified: now });
  story.cards[card.id] = card;
  if (target.beforeCardId || target.afterCardId || target.besideCardId) moveCard(story, card.id, target, now);
  return card.id;
}

/** Applies plain field changes (title, synopsis, status, ...) to a card. Returns false if nothing changed. */
export function updateCard(
  story: Story,
  cardId: Id,
  fields: Partial<Pick<Card, "title" | "synopsis" | "status">>,
  now = new Date().toISOString(),
): boolean {
  const card = story.cards[cardId];
  if (!card) return false;
  let changed = false;
  for (const [key, value] of Object.entries(fields) as [keyof typeof fields, string][]) {
    if (value !== undefined && card[key] !== value) {
      (card as unknown as Record<string, unknown>)[key] = value;
      changed = true;
    }
  }
  if (changed) card.modified = now;
  return changed;
}

/** Shows or hides a card's echo in a secondary plot line. Its primary plot line cannot be an echo. */
export function setEcho(story: Story, cardId: Id, plotLine: Id, on: boolean, now = new Date().toISOString()): boolean {
  const card = story.cards[cardId];
  if (!card || plotLine === card.plotLine || card.alsoIn.includes(plotLine) === on) return false;
  card.alsoIn = on ? orderedLike(story.plotLines, [...card.alsoIn, plotLine]) : card.alsoIn.filter((p) => p !== plotLine);
  card.modified = now;
  return true;
}

/**
 * Adds a character to a card by name. An existing story character with that
 * name (ignoring case) is reused; otherwise a new one is added to the story.
 */
export function addCharacterByName(
  story: Story,
  cardId: Id,
  name: string,
  role: CharacterRole = "present",
  now = new Date().toISOString(),
): boolean {
  const card = story.cards[cardId];
  const trimmed = name.trim();
  if (!card || !trimmed) return false;
  let character = story.characters.find((c) => c.name.toLowerCase() === trimmed.toLowerCase());
  if (!character) {
    character = { id: newId("x"), name: trimmed, color: freeColor(story.characters) };
    story.characters.push(character);
  }
  if (card.characters.some((c) => c.id === character!.id)) return false;
  card.characters.push({ id: character.id, role });
  card.modified = now;
  return true;
}

/** Changes how a character takes part in a card, or what they do there. */
export function updateCardCharacter(
  story: Story,
  cardId: Id,
  characterId: Id,
  fields: Partial<Pick<CardCharacter, "role" | "note">>,
  now = new Date().toISOString(),
): boolean {
  const entry = story.cards[cardId]?.characters.find((c) => c.id === characterId);
  if (!entry) return false;
  let changed = false;
  if (fields.role !== undefined && fields.role !== entry.role) {
    entry.role = fields.role;
    changed = true;
  }
  if (fields.note !== undefined) {
    const note = fields.note.trim() || undefined;
    if (note !== entry.note) {
      if (note) entry.note = note;
      else delete entry.note;
      changed = true;
    }
  }
  if (changed) story.cards[cardId]!.modified = now;
  return changed;
}

/** Removes a character from a card. The character stays in the story. */
export function removeCardCharacter(story: Story, cardId: Id, characterId: Id, now = new Date().toISOString()): boolean {
  const card = story.cards[cardId];
  if (!card || !card.characters.some((c) => c.id === characterId)) return false;
  card.characters = card.characters.filter((c) => c.id !== characterId);
  card.modified = now;
  return true;
}

/** Deletes a card and closes the gap in its chapter's scene order. */
export function deleteCard(story: Story, cardId: Id, now = new Date().toISOString()): boolean {
  const card = story.cards[cardId];
  if (!card) return false;
  // Moving it to the end first lets moveCard renumber the rows it leaves behind.
  moveCard(story, cardId, { chapter: card.chapter, plotLine: card.plotLine }, now);
  delete story.cards[cardId];
  return true;
}

function orderedLike(plotLines: { id: Id }[], ids: Id[]): Id[] {
  const index = new Map(plotLines.map((p, i) => [p.id, i]));
  return [...ids].sort((a, b) => (index.get(a) ?? Infinity) - (index.get(b) ?? Infinity));
}

/**
 * Sets or clears a card's date or end date. Clearing the start date clears
 * the end date with it, since an end needs a start.
 */
export function setCardDate(
  story: Story,
  cardId: Id,
  which: "date" | "endDate",
  date: StoryDate | undefined,
  now = new Date().toISOString(),
): boolean {
  const card = story.cards[cardId];
  if (!card) return false;
  if (JSON.stringify(card[which]) === JSON.stringify(date)) return false;
  if (date) card[which] = date;
  else delete card[which];
  if (which === "date" && !date) delete card.endDate;
  card.modified = now;
  return true;
}
