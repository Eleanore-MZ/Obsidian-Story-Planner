import { newId, PALETTE } from "./defaults";
import { chapterRows } from "./moves";
import { dateProblem } from "./calendar";
import { Calendar, Card, CardCharacter, CharacterRole, Id, Location, PlotLine, Story } from "./types";

// Pure edits behind the story setup panel: plot lines, chapters and
// characters. Deleting something that cards depend on always says what
// happens to those cards, so nothing is lost by accident.

export function addPlotLine(story: Story, name: string): Id {
  const id = newId("p");
  story.plotLines.push({ id, name, color: freeColor(story.plotLines) });
  return id;
}

export function addCategory(story: Story, name: string): Id {
  const id = newId("pc");
  story.plotLineCategories.push({ id, name, color: freeColor(story.plotLineCategories) });
  return id;
}

/** Deletes a category. Its plot lines stay, without a category, and keep their own colours. */
export function deleteCategory(story: Story, id: Id): boolean {
  if (!story.plotLineCategories.some((c) => c.id === id)) return false;
  story.plotLineCategories = story.plotLineCategories.filter((c) => c.id !== id);
  for (const plotLine of story.plotLines) if (plotLine.category === id) delete plotLine.category;
  return true;
}

/** Puts a plot line in a category, or takes it out with undefined. */
export function setPlotLineCategory(story: Story, plotLineId: Id, category: Id | undefined): boolean {
  const plotLine = story.plotLines.find((p) => p.id === plotLineId);
  if (!plotLine || plotLine.category === category) return false;
  if (category && !story.plotLineCategories.some((c) => c.id === category)) return false;
  if (category) plotLine.category = category;
  else delete plotLine.category;
  return true;
}

export function plotLinesInCategory(story: Story, id: Id): PlotLine[] {
  return story.plotLines.filter((p) => p.category === id);
}

/**
 * The colour a plot line is drawn in: its category's when the story colours
 * by category and the plot line has one, otherwise its own.
 */
export function plotLineColor(story: Story, plotLine: PlotLine | undefined): string | undefined {
  if (!plotLine) return undefined;
  if (story.colorByCategory && plotLine.category) {
    const category = story.plotLineCategories.find((c) => c.id === plotLine.category);
    if (category) return category.color;
  }
  return plotLine.color;
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

/** Moves the item at `from` so it ends up at index `to`, for drag reordering. */
export function moveIndex<T>(list: T[], from: number, to: number): boolean {
  if (from === to || from < 0 || from >= list.length || to < 0 || to >= list.length) return false;
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item!);
  return true;
}

/** Where the item that was at `index` is after moving the item at `from` to `to`. */
export function movedIndex(index: number, from: number, to: number): number {
  if (index === from) return to;
  if (from < to && index > from && index <= to) return index - 1;
  if (to < from && index >= to && index < from) return index + 1;
  return index;
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

// ---------------------------------------------------------------------------
// Calendar and time zones

/** Cards whose date or end date the calendar can no longer show, e.g. after a month was removed. */
export function cardsWithBadDates(story: Story): Card[] {
  const calendar = story.calendars[0];
  if (!calendar) return [];
  return Object.values(story.cards).filter(
    (c) => (c.date && dateProblem(calendar, c.date)) || (c.endDate && dateProblem(calendar, c.endDate)),
  );
}

export function cardsWithDates(story: Story): Card[] {
  return Object.values(story.cards).filter((c) => c.date);
}

/**
 * Replaces the story's calendar with a fresh copy of a preset. Dates keep
 * their components; eras and parts of the day that the new calendar lacks
 * are taken off the dates, as the calendar no longer knows them.
 */
export function applyCalendar(story: Story, calendar: Calendar, now = new Date().toISOString()): boolean {
  const id = story.calendars[0]?.id ?? calendar.id;
  story.calendars = [{ ...calendar, id }, ...story.calendars.slice(1)];
  const eras = new Set((calendar.eras ?? []).map((e) => e.id));
  const parts = new Set((calendar.dayParts ?? []).map((p) => p.id));
  for (const card of Object.values(story.cards)) {
    for (const date of [card.date, card.endDate]) {
      if (!date) continue;
      if (date.era !== undefined && !eras.has(date.era)) {
        delete date.era;
        card.modified = now;
      }
      if (date.dayPart !== undefined && !parts.has(date.dayPart)) {
        delete date.dayPart;
        card.modified = now;
      }
    }
  }
  return true;
}

/** Adds a time zone. The story's first zone becomes the reference zone, with no offset. */
export function addZone(story: Story, name: string, offsetMinutes = 0): Id {
  const id = newId("z");
  const first = story.zones.length === 0;
  story.zones.push({ id, name, offsetMinutes: first ? 0 : offsetMinutes });
  if (first) story.referenceZone = id;
  return id;
}

/**
 * Makes another zone the reference. Every offset is re-measured from it, so
 * no event moves relative to another; only the numbers shown change.
 */
export function setReferenceZone(story: Story, zoneId: Id): boolean {
  const zone = story.zones.find((z) => z.id === zoneId);
  if (!zone || story.referenceZone === zoneId) return false;
  const shift = zone.offsetMinutes;
  for (const z of story.zones) z.offsetMinutes -= shift;
  story.referenceZone = zoneId;
  return true;
}

/** Zones still in use: on card dates, locations and characters. */
export function zoneUses(story: Story, zoneId: Id): number {
  const onCards = Object.values(story.cards).filter((c) => c.date?.zone === zoneId || c.endDate?.zone === zoneId).length;
  return (
    onCards + story.locations.filter((l) => l.zone === zoneId).length + story.characters.filter((c) => c.zone === zoneId).length
  );
}

/**
 * Deletes a zone and takes it off dates, locations and characters, which
 * then fall back to the next zone in line. The reference zone passes to the
 * first remaining zone.
 */
export function deleteZone(story: Story, zoneId: Id, now = new Date().toISOString()): boolean {
  if (!story.zones.some((z) => z.id === zoneId)) return false;
  if (story.referenceZone === zoneId) {
    const next = story.zones.find((z) => z.id !== zoneId);
    if (next) setReferenceZone(story, next.id);
  }
  for (const card of Object.values(story.cards)) {
    for (const date of [card.date, card.endDate]) {
      if (date?.zone === zoneId) {
        delete date.zone;
        card.modified = now;
      }
    }
  }
  for (const place of story.locations) if (place.zone === zoneId) delete place.zone;
  for (const character of story.characters) if (character.zone === zoneId) delete character.zone;
  story.zones = story.zones.filter((z) => z.id !== zoneId);
  if (story.zones.length === 0) delete story.referenceZone;
  return true;
}

// ---------------------------------------------------------------------------
// Locations: a nested list, e.g. a room inside a house inside a city

export function addLocation(story: Story, name: string, parent?: Id): Id {
  const id = newId("l");
  story.locations.push(parent ? { id, name, parent } : { id, name });
  return id;
}

/** Locations in list order with their depth, parents before children; a broken parent counts as none. */
export function locationTree(story: Story): { location: Location; depth: number }[] {
  const ids = new Set(story.locations.map((l) => l.id));
  const children = new Map<Id | undefined, Location[]>();
  for (const location of story.locations) {
    const parent = location.parent && ids.has(location.parent) && location.parent !== location.id ? location.parent : undefined;
    children.set(parent, [...(children.get(parent) ?? []), location]);
  }
  const out: { location: Location; depth: number }[] = [];
  const seen = new Set<Id>();
  const walk = (parent: Id | undefined, depth: number) => {
    for (const location of children.get(parent) ?? []) {
      if (seen.has(location.id)) continue;
      seen.add(location.id);
      out.push({ location, depth });
      walk(location.id, depth + 1);
    }
  };
  walk(undefined, 0);
  // Anything caught in a loop of parents still shows, at the top level.
  for (const location of story.locations) if (!seen.has(location.id)) out.push({ location, depth: 0 });
  return out;
}

/** A location and every location inside it. */
export function locationAndInside(story: Story, id: Id): Set<Id> {
  const inside = new Set<Id>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const l of story.locations) {
      if (l.parent && inside.has(l.parent) && !inside.has(l.id)) {
        inside.add(l.id);
        grew = true;
      }
    }
  }
  return inside;
}

/** "Glass Harbour › The pier": a location's name with the places it sits in. */
export function locationPath(story: Story, id: Id): string {
  const names: string[] = [];
  const seen = new Set<Id>();
  for (let l = story.locations.find((x) => x.id === id); l && !seen.has(l.id); l = story.locations.find((x) => x.id === l!.parent)) {
    seen.add(l.id);
    names.unshift(l.name);
  }
  return names.join(" › ");
}

export function cardsAtLocation(story: Story, id: Id): Card[] {
  return Object.values(story.cards).filter((c) => c.location === id);
}

/** Moves a location one place up or down among the locations that share its parent. */
export function shiftLocation(story: Story, id: Id, by: -1 | 1): boolean {
  const location = story.locations.find((l) => l.id === id);
  if (!location) return false;
  const siblings = story.locations.filter((l) => l.parent === location.parent);
  const target = siblings[siblings.indexOf(location) + by];
  if (!target) return false;
  const a = story.locations.indexOf(location);
  const b = story.locations.indexOf(target);
  [story.locations[a], story.locations[b]] = [target, location];
  return true;
}

/** Puts a location inside the sibling just above it (indent), or beside its parent (outdent). */
export function nestLocation(story: Story, id: Id, inward: boolean): boolean {
  const location = story.locations.find((l) => l.id === id);
  if (!location) return false;
  if (inward) {
    const siblings = story.locations.filter((l) => l.parent === location.parent);
    const above = siblings[siblings.indexOf(location) - 1];
    if (!above) return false;
    location.parent = above.id;
    return true;
  }
  if (!location.parent) return false;
  const parent = story.locations.find((l) => l.id === location.parent);
  if (parent?.parent) location.parent = parent.parent;
  else delete location.parent;
  return true;
}

/** Deletes a location. Places inside it move up to its parent; cards there lose their location. */
export function deleteLocation(story: Story, id: Id, now = new Date().toISOString()): boolean {
  const location = story.locations.find((l) => l.id === id);
  if (!location) return false;
  for (const l of story.locations) {
    if (l.parent !== id) continue;
    if (location.parent) l.parent = location.parent;
    else delete l.parent;
  }
  for (const card of cardsAtLocation(story, id)) {
    delete card.location;
    card.modified = now;
  }
  story.locations = story.locations.filter((l) => l.id !== id);
  return true;
}

// ---------------------------------------------------------------------------
// Scene tags, kept apart from Obsidian's own #tags

export function addTag(story: Story, name: string): Id {
  const id = newId("g");
  story.tags.push({ id, name, color: freeColor(story.tags) });
  return id;
}

export function cardsWithTag(story: Story, id: Id): Card[] {
  return Object.values(story.cards).filter((c) => c.tags.includes(id));
}

export function deleteTag(story: Story, id: Id, now = new Date().toISOString()): boolean {
  if (!story.tags.some((t) => t.id === id)) return false;
  for (const card of cardsWithTag(story, id)) {
    card.tags = card.tags.filter((t) => t !== id);
    card.modified = now;
  }
  story.tags = story.tags.filter((t) => t.id !== id);
  return true;
}
