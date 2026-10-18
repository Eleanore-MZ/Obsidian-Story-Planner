import { newId, PALETTE } from "./defaults";
import { chapterRows } from "./moves";
import { Card, CardCharacter, CharacterRole, Id, Story } from "./types";

// Pure edits behind the story setup panel: plot lines, chapters and
// characters. Deleting something that cards depend on always says what
// happens to those cards, so nothing is lost by accident.

export function addPlotLine(story: Story, name: string): Id {
  const id = newId("p");
  story.plotLines.push({ id, name, color: freeColor(story.plotLines) });
  return id;
}

export function addChapter(story: Story, name: string): Id {
  const id = newId("c");
  story.chapters.push({ id, name });
  return id;
}

export function addCharacter(story: Story, name: string): Id {
  const id = newId("x");
  story.characters.push({ id, name, color: freeColor(story.characters) });
  return id;
}

/** The first palette colour nobody uses yet, or the next one in turn when all are taken. */
export function freeColor(used: { color: string }[]): string {
  const taken = new Set(used.map((u) => u.color.toLowerCase()));
  return PALETTE.find((c) => !taken.has(c.toLowerCase())) ?? PALETTE[used.length % PALETTE.length]!;
}

/** Moves an item one place up (-1) or down (+1) in its list. */
export function shiftInList<T extends { id: Id }>(list: T[], id: Id, by: -1 | 1): boolean {
  const from = list.findIndex((x) => x.id === id);
  const to = from + by;
  if (from === -1 || to < 0 || to >= list.length) return false;
  [list[from], list[to]] = [list[to]!, list[from]!];
  return true;
}

/** Cards whose primary plot line is this one; echoes are not counted. */
export function cardsInPlotLine(story: Story, plotLineId: Id): Card[] {
  return Object.values(story.cards).filter((c) => c.plotLine === plotLineId);
}

export function cardsInChapter(story: Story, chapterId: Id): Card[] {
  return Object.values(story.cards).filter((c) => c.chapter === chapterId);
}

export function cardsWithCharacter(story: Story, characterId: Id): Card[] {
  return Object.values(story.cards).filter((c) => c.characters.some((e) => e.id === characterId));
}

/**
 * Deletes a plot line. Its cards move to `moveTo`, keeping their place in
 * the scene order, or are deleted with it when `moveTo` is null. Echoes in
 * the deleted plot line simply disappear. The last plot line cannot go.
 */
export function deletePlotLine(story: Story, plotLineId: Id, moveTo: Id | null, now = new Date().toISOString()): boolean {
  if (story.plotLines.length <= 1 || !story.plotLines.some((p) => p.id === plotLineId)) return false;
  if (moveTo === plotLineId || (moveTo !== null && !story.plotLines.some((p) => p.id === moveTo))) return false;
  for (const card of Object.values(story.cards)) {
    if (card.plotLine === plotLineId) {
      if (moveTo === null) {
        delete story.cards[card.id];
        continue;
      }
      card.plotLine = moveTo;
      card.alsoIn = card.alsoIn.filter((p) => p !== moveTo);
      card.modified = now;
    }
    if (card.alsoIn.includes(plotLineId)) {
      card.alsoIn = card.alsoIn.filter((p) => p !== plotLineId);
      card.modified = now;
    }
  }
  story.plotLines = story.plotLines.filter((p) => p.id !== plotLineId);
  if (moveTo === null) renumberAll(story, now);
  return true;
}

/**
 * Deletes a chapter. Its scenes move to the end of `moveTo` (a chapter id,
 * or "off-page"), keeping their order and shared rows, or are deleted with it
 * when `moveTo` is null. The last chapter cannot go.
 */
export function deleteChapter(
  story: Story,
  chapterId: Id,
  moveTo: Id | "off-page" | null,
  now = new Date().toISOString(),
): boolean {
  if (story.chapters.length <= 1 || !story.chapters.some((c) => c.id === chapterId)) return false;
  if (moveTo === chapterId || (moveTo !== null && moveTo !== "off-page" && !story.chapters.some((c) => c.id === moveTo))) {
    return false;
  }
  const rows = chapterRows(story, chapterId);
  if (moveTo === null) {
    for (const row of rows) for (const card of row) delete story.cards[card.id];
  } else {
    const target = moveTo === "off-page" ? null : moveTo;
    let order = chapterRows(story, target).length;
    for (const row of rows) {
      order++;
      for (const card of row) {
        card.chapter = target;
        card.order = order;
        card.modified = now;
      }
    }
  }
  story.chapters = story.chapters.filter((c) => c.id !== chapterId);
  return true;
}

/** Deletes a character and takes them out of every card. */
export function deleteCharacter(story: Story, characterId: Id, now = new Date().toISOString()): boolean {
  if (!story.characters.some((c) => c.id === characterId)) return false;
  for (const card of cardsWithCharacter(story, characterId)) {
    card.characters = card.characters.filter((e) => e.id !== characterId);
    card.modified = now;
  }
  for (const plotLine of story.plotLines) {
    if (plotLine.characters) plotLine.characters = plotLine.characters.filter((c) => c !== characterId);
  }
  story.characters = story.characters.filter((c) => c.id !== characterId);
  return true;
}

const ROLE_WEIGHT: Record<CharacterRole, number> = { pov: 3, present: 2, mentioned: 1 };

/**
 * Merges one character into another, for duplicates such as "Tom" and
 * "Thomas". Where a card has both, it keeps the stronger role and both notes.
 */
export function mergeCharacters(story: Story, fromId: Id, intoId: Id, now = new Date().toISOString()): boolean {
  const from = story.characters.find((c) => c.id === fromId);
  const into = story.characters.find((c) => c.id === intoId);
  if (!from || !into || fromId === intoId) return false;
  for (const card of cardsWithCharacter(story, fromId)) {
    const moved = card.characters.find((e) => e.id === fromId)!;
    const kept = card.characters.find((e) => e.id === intoId);
    if (kept) {
      if (ROLE_WEIGHT[moved.role] > ROLE_WEIGHT[kept.role]) kept.role = moved.role;
      kept.note = joinNotes(kept.note, moved.note);
      if (!kept.note) delete kept.note;
      card.characters = card.characters.filter((e) => e !== moved);
    } else {
      moved.id = intoId;
    }
    card.modified = now;
  }
  for (const plotLine of story.plotLines) {
    if (!plotLine.characters?.includes(fromId)) continue;
    plotLine.characters = [...new Set(plotLine.characters.map((c) => (c === fromId ? intoId : c)))];
  }
  if (!into.description && from.description) into.description = from.description;
  story.characters = story.characters.filter((c) => c.id !== fromId);
  return true;
}

function joinNotes(a: CardCharacter["note"], b: CardCharacter["note"]): string | undefined {
  return [a, b].filter((n): n is string => !!n && n.trim() !== "").join("; ") || undefined;
}

/** Closes gaps in scene order in every chapter, after cards were deleted. */
function renumberAll(story: Story, now: string): void {
  const groups: (Id | null)[] = [...story.chapters.map((c) => c.id), null];
  for (const chapter of groups) {
    chapterRows(story, chapter).forEach((row, i) => {
      for (const card of row) {
        if (card.order !== i + 1) {
          card.order = i + 1;
          card.modified = now;
        }
      }
    });
  }
}
