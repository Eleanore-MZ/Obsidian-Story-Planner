import { formatStoryDate } from "../model/calendar";
import { linkTarget, noteName } from "../model/links";
import { cleanCardShows } from "../model/cardShows";
import { Card, Chapter, STORY_SCHEMA_VERSION, Story, StoryDate, StorySetup } from "../model/types";
import { actsShown, actTitle, chapterNumbers, chapterTitle, titleFromOldName } from "../model/chapters";

// A story note has three parts:
//
//   1. Frontmatter with `storyplanner: story`, which is how the plugin finds stories.
//   2. A readable outline, regenerated from the data on every save. It is output
//      only and is never parsed ("edit in the board, read anywhere").
//   3. The data block at the end, inside an Obsidian comment so it is hidden in
//      reading view: one JSON line for the setup, then one JSON line per card.
//      One card per line keeps diffs readable and lets sync merges of edits to
//      different cards land on different lines.

export const FRONTMATTER_KEY = "storyplanner";
export const FRONTMATTER_VALUE = "story";
export const VERSION_KEY = "storyplanner-version";
const DATA_MARKER = "storyplanner-data";
const DATA_OPEN = `%%\n${DATA_MARKER}\n`;
const DATA_CLOSE = "\n%%";

export type ParseResult =
  | { ok: true; story: Story; frontmatter: string[]; outline: string; warnings: string[] }
  | { ok: false; error: string };

/** True when the note's frontmatter marks it as a story. Cheap; does not parse the data. */
export function isStoryText(text: string): boolean {
  const fm = splitFrontmatter(normalizeNewlines(text)).frontmatter;
  return fm !== null && fm.some((line) => isMarkerLine(line));
}

export function serializeStory(story: Story, existingFrontmatter: string[] = []): string {
  const kept = existingFrontmatter.filter(
    (line) => !line.startsWith(`${FRONTMATTER_KEY}:`) && !line.startsWith(`${VERSION_KEY}:`),
  );
  const frontmatter = [
    `${FRONTMATTER_KEY}: ${FRONTMATTER_VALUE}`,
    `${VERSION_KEY}: ${STORY_SCHEMA_VERSION}`,
    ...kept,
  ];
  return `---\n${frontmatter.join("\n")}\n---\n\n${renderOutline(story)}\n${renderDataBlock(story)}\n`;
}

export function parseStory(text: string): ParseResult {
  const normalized = normalizeNewlines(text);
  const { frontmatter, body } = splitFrontmatter(normalized);
  if (frontmatter === null || !frontmatter.some(isMarkerLine)) {
    return { ok: false, error: "This note is not marked as a story (missing `storyplanner: story` in its properties)." };
  }

  const start = body.lastIndexOf(DATA_OPEN);
  if (start === -1) {
    return { ok: false, error: "The story's data block is missing." };
  }
  const dataStart = start + DATA_OPEN.length;
  const end = body.indexOf(DATA_CLOSE, dataStart - 1);
  if (end === -1) {
    return { ok: false, error: "The story's data block is not closed." };
  }

  const lines = body
    .slice(dataStart, end)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) {
    return { ok: false, error: "The story's data block is empty." };
  }

  const warnings: string[] = [];
  let setupRaw: unknown;
  try {
    setupRaw = JSON.parse(lines[0]!);
  } catch {
    return { ok: false, error: "The story's setup line could not be read." };
  }
  const setup = readSetup(setupRaw);
  if (typeof setup === "string") return { ok: false, error: setup };

  const cards: Record<string, Card> = {};
  for (let i = 1; i < lines.length; i++) {
    let raw: unknown;
    try {
      raw = JSON.parse(lines[i]!);
    } catch {
      return { ok: false, error: `Card line ${i} of the data block could not be read.` };
    }
    const card = readCard(raw);
    if (card === null) {
      return { ok: false, error: `Card line ${i} of the data block is not a valid card.` };
    }
    const existing = cards[card.id];
    if (existing) {
      // Two versions of one card can survive a sync merge; keep the newer one.
      warnings.push(`Card "${card.title}" appeared twice; kept the most recently edited version.`);
      if (existing.modified >= card.modified) continue;
    }
    cards[card.id] = card;
  }

  return {
    ok: true,
    story: { ...setup, cards },
    frontmatter,
    outline: body.slice(0, start).trim(),
    warnings,
  };
}

/**
 * True when the outline in the note differs from what the plugin would generate,
 * meaning someone edited it by hand. The view warns before overwriting it.
 */
export function outlineWasEdited(parsed: Extract<ParseResult, { ok: true }>): boolean {
  return parsed.outline !== renderOutline(parsed.story).trim();
}

// ---------------------------------------------------------------------------
// Outline

export function renderOutline(story: Story): string {
  const out: string[] = [];
  out.push(`# ${escapeText(story.title)}`);
  out.push("");
  out.push("> [!info] Story Planner");
  out.push("> This note is a Story Planner board. Open it as a board to edit it. The outline below is regenerated on every save, so edits made here as text will be replaced.");
  out.push("");

  const plotLineName = new Map(story.plotLines.map((p) => [p.id, p.name]));
  // Characters and places with a note of their own are written as links to it,
  // so the note shows the story in its backlinks.
  const characterName = new Map(story.characters.map((c) => [c.id, named(c.name, c.note)]));
  const locationName = new Map(story.locations.map((l) => [l.id, named(l.name, l.note)]));
  const tagName = new Map(story.tags.map((t) => [t.id, t.name]));
  const cards = Object.values(story.cards);
  const chapterIds = new Set(story.chapters.map((c) => c.id));

  const renderCard = (card: Card) => {
    const details = [plotLineName.get(card.plotLine) ?? "Unknown plot line"];
    if (card.date) details.push(formatStoryDate(story, card.date));
    const parts = details.map(escapeText);
    if (card.location) parts.push(locationName.get(card.location) ?? "Unknown place");
    out.push(`**${escapeText(card.title.trim() || "Untitled")}** (${parts.join(", ")})`);
    const people = card.characters
      .map((c) => characterName.get(c.id))
      .filter((n): n is string => n !== undefined);
    if (people.length > 0) out.push(`Characters: ${people.join(", ")}`);
    // Scene tags are written as plain words, never as Obsidian #tags.
    const tags = story.tagsEnabled ? card.tags.map((t) => tagName.get(t)).filter((n): n is string => n !== undefined) : [];
    if (tags.length > 0) out.push(`Scene tags: ${tags.map(escapeText).join(", ")}`);
    if (card.synopsis.trim()) {
      out.push(...card.synopsis.trim().split(/\n+/).map(escapeLine));
    }
    if (card.notes.length > 0) {
      out.push(`Notes: ${card.notes.map((n) => noteLink(n, noteName(n))).join(", ")}`);
    }
    out.push("");
  };

  // Cards that share an order share a row on the board, read left to right by plot line.
  const lane = new Map(story.plotLines.map((p, i) => [p.id, i]));
  const laneOf = (c: Card) => lane.get(c.plotLine) ?? story.plotLines.length;
  const byOrder = (a: Card, b: Card) => a.order - b.order || laneOf(a) - laneOf(b) || a.id.localeCompare(b.id);

  // With acts, each act is a heading and its chapters sit one level below it.
  const numbers = chapterNumbers(story);
  const showActs = actsShown(story);
  const chapterLevel = showActs ? "###" : "##";
  let currentAct: string | undefined;
  for (const chapter of story.chapters) {
    const act = showActs && chapter.act ? story.acts.find((a) => a.id === chapter.act) : undefined;
    if (act && act.id !== currentAct) {
      out.push(`## ${escapeText(actTitle(story, act))}`);
      out.push("");
      if (act.summary?.trim()) {
        out.push(escapeLine(act.summary.trim()));
        out.push("");
      }
    }
    currentAct = act?.id;
    out.push(`${chapterLevel} ${escapeText(chapterTitle(story, chapter, numbers))}`);
    out.push("");
    if (chapter.summary?.trim()) {
      out.push(escapeLine(chapter.summary.trim()));
      out.push("");
    }
    cards.filter((c) => c.chapter === chapter.id).sort(byOrder).forEach(renderCard);
  }

  const offPage = cards.filter((c) => c.chapter === null || !chapterIds.has(c.chapter)).sort(byOrder);
  if (offPage.length > 0) {
    out.push("## Off-page");
    out.push("");
    offPage.forEach(renderCard);
  }

  return out.join("\n").trimEnd() + "\n";
}

/** A name, linked to its note when it has one. The result is ready to write: already escaped. */
function named(name: string, note: string | undefined): string {
  return note ? noteLink(note, name) : escapeText(name);
}

/**
 * A wikilink to a note, showing `label`. Paths that cannot be written safely
 * as a link, and labels that would break one, fall back to escaped text.
 */
function noteLink(path: string, label: string): string {
  const target = linkTarget(path);
  if (target === null) return escapeText(label);
  const text = label.replace(/\s*\n\s*/g, " ").trim();
  if (!text || text === noteName(path) || /[[\]|#^]|%%/.test(text)) return `[[${target}]]`;
  return `[[${target}|${text}]]`;
}

const INLINE_SPECIAL = /[\\`*_[\]#%<>|~=^$]/g;

/**
 * Escapes text so Obsidian shows it literally. In particular this keeps story
 * tags and card text from turning into Obsidian #tags, [[links]] or %% comments.
 */
export function escapeText(text: string): string {
  return text.replace(/\s*\n\s*/g, " ").replace(INLINE_SPECIAL, (ch) => `\\${ch}`);
}

/** Like escapeText, but also stops a line from starting a list, quote or heading. */
export function escapeLine(line: string): string {
  return escapeText(line.trim())
    .replace(/^([-+])(\s)/, "\\$1$2")
    .replace(/^(\d+)\.(\s)/, "$1\\.$2");
}

// ---------------------------------------------------------------------------
// Data block

function renderDataBlock(story: Story): string {
  const { cards, ...setup } = story;
  const lines = [encodeLine(setup)];
  // Cards sorted by id, so moving a card never moves its line.
  for (const id of Object.keys(cards).sort()) {
    const { id: cardId, title, ...rest } = cards[id]!;
    // id and title first, so each line is easy to recognize in a diff.
    lines.push(encodeLine({ id: cardId, title, ...rest }));
  }
  return `${DATA_OPEN}${lines.join("\n")}${DATA_CLOSE}`;
}

/** JSON on one line, with % escaped so text can never close the surrounding %% comment. */
function encodeLine(value: unknown): string {
  return JSON.stringify(value).replace(/%/g, "\\u0025");
}

function readSetup(raw: unknown): StorySetup | string {
  if (!isObject(raw)) return "The story's setup line is not valid.";
  const schema = typeof raw.schema === "number" ? raw.schema : 0;
  if (schema > STORY_SCHEMA_VERSION) {
    return "This story was saved by a newer version of Story Planner. Update the plugin to open it.";
  }
  return {
    schema: STORY_SCHEMA_VERSION,
    title: typeof raw.title === "string" ? raw.title : "Untitled story",
    // Plot lines no longer name characters (that was the removed relationships feature).
    plotLines: arrayOf<Record<string, unknown>>(raw.plotLines).map(({ characters: _dropped, ...p }) => p) as unknown as StorySetup["plotLines"],
    // Stories saved before categories existed have none.
    plotLineCategories: arrayOf(raw.plotLineCategories),
    actsEnabled: raw.actsEnabled !== false,
    colorByCategory: raw.colorByCategory === true,
    acts: arrayOf(raw.acts),
    // Before version 2 a chapter's number was part of its name: "Chapter 3: The Pier".
    chapters: schema < 2 ? arrayOf<Chapter>(raw.chapters).map((c) => ({ ...c, name: titleFromOldName(String(c.name ?? "")) })) : arrayOf(raw.chapters),
    characters: arrayOf(raw.characters),
    locations: arrayOf(raw.locations),
    tags: arrayOf(raw.tags),
    // Scene tags can no longer be switched off; a story that had them off shows them again.
    tagsEnabled: true,
    calendars: arrayOf(raw.calendars),
    zones: arrayOf(raw.zones),
    referenceZone: typeof raw.referenceZone === "string" ? raw.referenceZone : undefined,
    ...(typeof raw.dateFormat === "string" && raw.dateFormat.trim() ? { dateFormat: raw.dateFormat } : {}),
    ...(typeof raw.timeFormat === "string" && raw.timeFormat.trim() ? { timeFormat: raw.timeFormat } : {}),
    ...(typeof raw.timeBlockMinutes === "number" && Number.isInteger(raw.timeBlockMinutes) && raw.timeBlockMinutes > 0
      ? { timeBlockMinutes: raw.timeBlockMinutes }
      : {}),
    ...(cleanCardShows(raw.cardShows) ? { cardShows: cleanCardShows(raw.cardShows) } : {}),
    ...(isStoredDate(raw.storyStart) ? { storyStart: withoutApproximate(raw.storyStart) } : {}),
    ...(isStoredDate(raw.storyEnd) ? { storyEnd: withoutApproximate(raw.storyEnd) } : {}),
  };
}

/** A date as stored: an object with a calendar and a whole year at least. */
function isStoredDate(raw: unknown): raw is StoryDate {
  return isObject(raw) && typeof raw.calendar === "string" && typeof raw.year === "number" && Number.isInteger(raw.year);
}

function withoutApproximate(date: StoryDate): StoryDate {
  const { approximate: _old, ...rest } = date as StoryDate & { approximate?: unknown };
  return rest;
}

function readCard(raw: unknown): Card | null {
  if (!isObject(raw)) return null;
  if (typeof raw.id !== "string" || typeof raw.title !== "string" || typeof raw.plotLine !== "string") {
    return null;
  }
  // Before cards were simply written or not, they had a status; drafted and
  // revised scenes count as written. The old field is not kept.
  // Relationship states belonged to a feature that has been removed; they are dropped.
  const { status, relationshipState: _dropped, during, date, endDate, ...rest } = raw as Partial<Card> & {
    status?: unknown;
    relationshipState?: unknown;
    during?: unknown;
  };
  // Dates were once marked approximate; the mark is dropped.
  const dates = {
    ...(isObject(date) ? { date: withoutApproximate(date as StoryDate) } : {}),
    ...(isObject(endDate) ? { endDate: withoutApproximate(endDate as StoryDate) } : {}),
  };
  // Only an off-page event happens during a chapter.
  const background = typeof during === "string" && typeof raw.chapter !== "string" ? { during } : {};
  return {
    ...rest,
    ...dates,
    ...background,
    id: raw.id,
    title: raw.title,
    plotLine: raw.plotLine,
    synopsis: typeof raw.synopsis === "string" ? raw.synopsis : "",
    alsoIn: arrayOf(raw.alsoIn),
    chapter: typeof raw.chapter === "string" ? raw.chapter : null,
    order: typeof raw.order === "number" ? raw.order : 0,
    characters: arrayOf(raw.characters),
    written: typeof raw.written === "boolean" ? raw.written : status === "drafted" || status === "revised",
    tags: arrayOf(raw.tags),
    notes: arrayOf(raw.notes),
    modified: typeof raw.modified === "string" ? raw.modified : "",
  };
}

// ---------------------------------------------------------------------------
// Helpers

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

function splitFrontmatter(text: string): { frontmatter: string[] | null; body: string } {
  if (!text.startsWith("---\n")) return { frontmatter: null, body: text };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { frontmatter: null, body: text };
  const after = text.indexOf("\n", end + 4);
  return {
    frontmatter: text.slice(4, end).split("\n").filter((l) => l.length > 0),
    body: after === -1 ? "" : text.slice(after + 1),
  };
}

function isMarkerLine(line: string): boolean {
  const match = /^storyplanner:\s*["']?([^"'\s]+)["']?\s*$/.exec(line);
  return match?.[1] === FRONTMATTER_VALUE;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function arrayOf<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}
