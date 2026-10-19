import { newId } from "./defaults";
import { Act, Chapter, Id, Story } from "./types";

// Chapter numbers and acts. A chapter's number is its place in the story,
// counted through every act; the title is the writer's own and can be empty.
// A chapter can show a label instead of a number ("Prologue"), and then does
// not take a number. Acts group runs of chapters and are numbered in the
// order they first appear: Act I, Act II, ...

/** The number each chapter shows, by id; chapters with their own label have none. */
export function chapterNumbers(story: Story): Map<Id, number> {
  const numbers = new Map<Id, number>();
  let n = 0;
  for (const chapter of story.chapters) {
    if (chapter.label?.trim()) continue;
    numbers.set(chapter.id, ++n);
  }
  return numbers;
}

/** "Chapter 3", or the chapter's own label such as "Prologue". */
export function chapterHeading(story: Story, chapter: Chapter, numbers = chapterNumbers(story)): string {
  return chapter.label?.trim() || `Chapter ${numbers.get(chapter.id) ?? "?"}`;
}

/** "Chapter 3: The Pier", or just "Chapter 3" without a title. */
export function chapterTitle(story: Story, chapter: Chapter | undefined, numbers = chapterNumbers(story)): string {
  if (!chapter) return "Off-page";
  const heading = chapterHeading(story, chapter, numbers);
  return chapter.name.trim() ? `${heading}: ${chapter.name.trim()}` : heading;
}

/** A chapter's full title by id; "Off-page" for null or a chapter that is gone. */
export function chapterTitleOf(story: Story, chapterId: Id | null): string {
  return chapterTitle(story, story.chapters.find((c) => c.id === chapterId));
}

/** True when the story has acts and shows them; with acts switched off they are kept but hidden. */
export function actsShown(story: Story): boolean {
  return story.actsEnabled !== false && story.acts.length > 0;
}

/** Acts in reading order: by their first chapter; acts with no chapters come last, as listed. */
export function orderedActs(story: Story): Act[] {
  const first = new Map<Id, number>();
  story.chapters.forEach((c, i) => {
    if (c.act && !first.has(c.act)) first.set(c.act, i);
  });
  return story.acts
    .map((act, i) => ({ act, at: first.get(act.id) ?? story.chapters.length + i }))
    .sort((a, b) => a.at - b.at)
    .map((x) => x.act);
}

export function romanNumeral(n: number): string {
  if (n <= 0 || n >= 4000) return String(n);
  const values: [number, string][] = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
    [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let out = "";
  for (const [value, numeral] of values) {
    while (n >= value) {
      out += numeral;
      n -= value;
    }
  }
  return out;
}

/** "Act II". */
export function actHeading(story: Story, act: Act): string {
  return `Act ${romanNumeral(orderedActs(story).indexOf(act) + 1)}`;
}

/** "Act II: The Letters", or just "Act II". */
export function actTitle(story: Story, act: Act | undefined): string {
  if (!act) return "";
  return act.title?.trim() ? `${actHeading(story, act)}: ${act.title.trim()}` : actHeading(story, act);
}

export function actOf(story: Story, chapterId: Id | null): Act | undefined {
  const chapter = story.chapters.find((c) => c.id === chapterId);
  return chapter?.act ? story.acts.find((a) => a.id === chapter.act) : undefined;
}

/**
 * Starts a new act at a chapter. The chapter, and the chapters after it that
 * were in the same act (or in no act), move to the new act; the chapters
 * before it keep theirs.
 */
export function startActAt(story: Story, chapterId: Id, title = ""): Id | null {
  const index = story.chapters.findIndex((c) => c.id === chapterId);
  if (index === -1) return null;
  const previous = story.chapters[index]!.act;
  const id = newId("a");
  const act: Act = { id };
  if (title.trim()) act.title = title.trim();
  story.acts.push(act);
  for (let i = index; i < story.chapters.length && story.chapters[i]!.act === previous; i++) story.chapters[i]!.act = id;
  return id;
}

/** Puts a chapter in an act, or in none with undefined. */
export function setChapterAct(story: Story, chapterId: Id, actId: Id | undefined): boolean {
  const chapter = story.chapters.find((c) => c.id === chapterId);
  if (!chapter || chapter.act === actId) return false;
  if (actId && !story.acts.some((a) => a.id === actId)) return false;
  if (actId) chapter.act = actId;
  else delete chapter.act;
  return true;
}

/** Deletes an act. Its chapters stay, in no act. */
export function deleteAct(story: Story, actId: Id): boolean {
  if (!story.acts.some((a) => a.id === actId)) return false;
  story.acts = story.acts.filter((a) => a.id !== actId);
  for (const chapter of story.chapters) if (chapter.act === actId) delete chapter.act;
  return true;
}

export function chaptersInAct(story: Story, actId: Id): Chapter[] {
  return story.chapters.filter((c) => c.act === actId);
}

/**
 * Splits an old chapter name such as "Chapter 3: The Pier" into its title,
 * for stories saved before numbers and titles were separate. Names that are
 * not of that form are titles already.
 */
export function titleFromOldName(name: string): string {
  const match = /^\s*(?:chapter|ch\.?)\s*(?:\d+|[ivxlcdm]+)\b\s*(?:[:.\-–—]\s*)?(.*)$/i.exec(name);
  return match ? match[1]!.trim() : name;
}

/** One row of the acts-and-chapters list in setup: an act's start, or a chapter. */
export type OutlineEntry = { kind: "act"; id: Id } | { kind: "chapter"; id: Id };

/**
 * The story's chapters with each act's start marked just before its first
 * chapter. Acts with no chapters come at the end. Chapters before the first
 * marker belong to no act.
 */
export function outlineEntries(story: Story): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  const shown = new Set<Id>();
  let current: Id | undefined;
  for (const chapter of story.chapters) {
    const act = chapter.act && story.acts.some((a) => a.id === chapter.act) ? chapter.act : undefined;
    if (act && act !== current && !shown.has(act)) {
      entries.push({ kind: "act", id: act });
      shown.add(act);
    }
    current = act;
    entries.push({ kind: "chapter", id: chapter.id });
  }
  for (const act of story.acts) if (!shown.has(act.id)) entries.push({ kind: "act", id: act.id });
  return entries;
}

/**
 * Applies a reordered acts-and-chapters list: chapters take its order, and
 * each chapter belongs to the act whose start is nearest above it.
 */
export function applyOutline(story: Story, entries: OutlineEntry[]): boolean {
  const before = JSON.stringify([story.chapters, story.acts]);
  const byId = new Map(story.chapters.map((c) => [c.id, c]));
  const chapters: Chapter[] = [];
  let act: Id | undefined;
  for (const entry of entries) {
    if (entry.kind === "act") {
      act = story.acts.some((a) => a.id === entry.id) ? entry.id : act;
      continue;
    }
    const chapter = byId.get(entry.id);
    if (!chapter) continue;
    byId.delete(entry.id);
    if (act) chapter.act = act;
    else delete chapter.act;
    chapters.push(chapter);
  }
  // Chapters the list left out keep their place at the end.
  story.chapters = [...chapters, ...byId.values()];
  return JSON.stringify([story.chapters, story.acts]) !== before;
}

/** Moves one row of the acts-and-chapters list to a new index. */
export function moveOutlineEntry(story: Story, from: number, to: number): boolean {
  const entries = outlineEntries(story);
  if (from === to || from < 0 || to < 0 || from >= entries.length || to >= entries.length) return false;
  const [entry] = entries.splice(from, 1);
  entries.splice(to, 0, entry!);
  return applyOutline(story, entries);
}
