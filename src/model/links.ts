import { formatDateRange } from "./calendar";
import { locationPath } from "./setup";
import { Card, Id, Story } from "./types";

// Links from cards, characters and places to ordinary notes in the vault.
// Links live only in the story; the linked notes are never written to.
// Paths are vault paths such as "Drafts/The pier.md".

/** Links a note to a card. */
export function addCardNote(story: Story, cardId: Id, path: string, now = new Date().toISOString()): boolean {
  const card = story.cards[cardId];
  if (!card || card.notes.includes(path)) return false;
  card.notes = [...card.notes, path];
  card.modified = now;
  return true;
}

/** Unlinks a note from a card. The note itself is left alone. */
export function removeCardNote(story: Story, cardId: Id, path: string, now = new Date().toISOString()): boolean {
  const card = story.cards[cardId];
  if (!card || !card.notes.includes(path)) return false;
  card.notes = card.notes.filter((n) => n !== path);
  card.modified = now;
  return true;
}

/** Sets or clears the note of a character or a place. */
export function setEntityNote(story: Story, kind: "character" | "location", id: Id, path: string | undefined): boolean {
  const list: { id: Id; note?: string }[] = kind === "character" ? story.characters : story.locations;
  const entity = list.find((e) => e.id === id);
  if (!entity || entity.note === path) return false;
  if (path) entity.note = path;
  else delete entity.note;
  return true;
}

/** Every note path the story links to. */
export function linkedPaths(story: Story): Set<string> {
  const paths = new Set<string>();
  for (const card of Object.values(story.cards)) for (const n of card.notes) paths.add(n);
  for (const e of [...story.characters, ...story.locations]) if (e.note) paths.add(e.note);
  return paths;
}

/**
 * Follows a note or folder that was renamed or moved: every link to the old
 * path, or to a note inside the old folder, now points at the new one.
 */
export function renameLinkedPath(story: Story, oldPath: string, newPath: string, now = new Date().toISOString()): boolean {
  const moved = (path: string): string | null => {
    if (path === oldPath) return newPath;
    if (path.startsWith(oldPath + "/")) return newPath + path.slice(oldPath.length);
    return null;
  };
  let changed = false;
  for (const card of Object.values(story.cards)) {
    if (!card.notes.some((n) => moved(n) !== null)) continue;
    card.notes = [...new Set(card.notes.map((n) => moved(n) ?? n))];
    card.modified = now;
    changed = true;
  }
  for (const e of [...story.characters, ...story.locations]) {
    const next = e.note && moved(e.note);
    if (next) {
      e.note = next;
      changed = true;
    }
  }
  return changed;
}

/** The note's name as Obsidian shows it: the file name without folder or extension. */
export function noteName(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.md$/, "");
}

/** A file name for a note made from a card: the title, without characters a file name cannot hold. */
export function noteFileName(title: string): string {
  const name = title.replace(/[\\/:*?"<>|#^[\]%]/g, "").replace(/\s+/g, " ").trim();
  return name || "Untitled scene";
}

/** Used when no template note is set. */
export const DEFAULT_NOTE_TEMPLATE = `# {{title}}

{{synopsis}}

- Story: {{story}}
- Plot line: {{plotLine}}
- Chapter: {{chapter}}
- When: {{date}}
- Where: {{location}}
- Characters: {{characters}}
`;

/** The template placeholders, filled from a card. */
export function noteValues(story: Story, card: Card): Record<string, string> {
  const chapter = story.chapters.find((c) => c.id === card.chapter);
  const names = card.characters
    .map((c) => story.characters.find((x) => x.id === c.id)?.name)
    .filter((n): n is string => !!n);
  return {
    title: card.title,
    synopsis: card.synopsis.trim(),
    story: story.title,
    plotLine: story.plotLines.find((p) => p.id === card.plotLine)?.name ?? "",
    chapter: chapter?.name ?? "Off-page",
    date: card.date ? formatDateRange(story, card.date, card.endDate) : "",
    location: card.location && story.locations.some((l) => l.id === card.location) ? locationPath(story, card.location) : "",
    characters: names.join(", "),
    written: card.written ? "written" : "not written",
    // The name templates used before cards were simply written or not.
    status: card.written ? "written" : "not written",
  };
}

/**
 * Fills {{placeholders}} in a template. Unknown placeholders are left as
 * they are, so a template written for another plugin is not damaged.
 */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, key: string) => (key in values ? values[key]! : whole));
}

/**
 * The target of a wikilink to a note, or null when the path cannot be written
 * safely as a link (it could break out of the link or open a %% comment).
 */
export function linkTarget(path: string): string | null {
  const target = path.replace(/\.md$/, "");
  return /[[\]|#^\n]|%%/.test(target) ? null : target;
}
