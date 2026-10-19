import { formatDateRange } from "../model/calendar";
import { noteName } from "../model/links";
import { cardsInReadingOrder } from "../model/search";
import { locationPath } from "../model/setup";
import { timeSorted } from "../model/storyTime";
import { Card, CharacterRole, Story } from "../model/types";
import { escapeLine, escapeText } from "./storyFile";

// Exports of a story to other formats. Each is written to a new file the
// writer names; the story note itself is never changed by an export.

export type ExportFormat = "markdown" | "csv" | "json";
export type ExportOrder = "reading" | "time";

export const EXPORT_EXTENSIONS: Record<ExportFormat, string> = { markdown: "md", csv: "csv", json: "json" };

const ROLE_NAMES: Record<CharacterRole, string> = { pov: "point of view", present: "present", mentioned: "mentioned" };

/** The facts about a card, as plain text, shared by the Markdown and CSV exports. */
function facts(story: Story, card: Card) {
  const chapter = story.chapters.find((c) => c.id === card.chapter);
  const characters = card.characters
    .map((entry) => {
      const name = story.characters.find((c) => c.id === entry.id)?.name;
      return name ? { name, role: ROLE_NAMES[entry.role], note: entry.note ?? "" } : null;
    })
    .filter((c): c is { name: string; role: string; note: string } => c !== null);
  return {
    chapter: chapter?.name ?? "Off-page",
    plotLine: story.plotLines.find((p) => p.id === card.plotLine)?.name ?? "",
    alsoIn: card.alsoIn.map((id) => story.plotLines.find((p) => p.id === id)?.name).filter((n): n is string => !!n),
    date: card.date ? formatDateRange(story, card.date, card.endDate) : "",
    place: card.location && story.locations.some((l) => l.id === card.location) ? locationPath(story, card.location) : "",
    characters,
    tags: story.tagsEnabled ? card.tags.map((id) => story.tags.find((t) => t.id === id)?.name).filter((n): n is string => !!n) : [],
    relationship: card.relationshipState?.trim() ?? "",
    notes: card.notes.map(noteName),
  };
}

/**
 * The story as a clean Markdown document: chapters and scenes in reading
 * order, or scenes in the order they happen. Text is escaped, so nothing in a
 * card turns into a tag, link or comment in the exported note.
 */
export function exportMarkdown(story: Story, order: ExportOrder): string {
  const out: string[] = [`# ${escapeText(story.title)}`, ""];

  const writeCard = (card: Card, showChapter: boolean) => {
    const f = facts(story, card);
    out.push(`### ${escapeText(card.title)}`, "");
    const details = [f.plotLine, showChapter ? f.chapter : "", order === "reading" ? f.date : "", f.place].filter(Boolean);
    if (details.length > 0) out.push(`*${details.map(escapeText).join(" · ")}*`, "");
    if (f.characters.length > 0) {
      const people = f.characters.map((c) => `${c.name} (${c.role}${c.note ? `: ${c.note}` : ""})`);
      out.push(`**Characters:** ${people.map(escapeText).join(", ")}`, "");
    }
    if (f.tags.length > 0) out.push(`**Story tags:** ${f.tags.map(escapeText).join(", ")}`, "");
    if (f.relationship) out.push(`**Relationship:** ${escapeText(f.relationship)}`, "");
    if (card.synopsis.trim()) {
      for (const line of card.synopsis.trim().split(/\n+/)) out.push(escapeLine(line));
      out.push("");
    }
  };

  if (order === "reading") {
    const cards = cardsInReadingOrder(story);
    const chapterIds = new Set(story.chapters.map((c) => c.id));
    for (const chapter of story.chapters) {
      out.push(`## ${escapeText(chapter.name)}`, "");
      if (chapter.summary?.trim()) out.push(escapeLine(chapter.summary.trim()), "");
      for (const card of cards.filter((c) => c.chapter === chapter.id)) writeCard(card, false);
    }
    const offPage = cards.filter((c) => c.chapter === null || !chapterIds.has(c.chapter));
    if (offPage.length > 0) {
      out.push("## Off-page", "");
      for (const card of offPage) writeCard(card, false);
    }
  } else {
    const all = Object.values(story.cards);
    const dated = timeSorted(story, all.filter((c) => c.date));
    let heading = "";
    for (const card of dated) {
      // One heading per distinct date, so scenes on the same day sit together.
      const when = facts(story, card).date;
      if (when !== heading) {
        out.push(`## ${escapeText(when)}`, "");
        heading = when;
      }
      writeCard(card, true);
    }
    const undated = cardsInReadingOrder(story).filter((c) => !c.date);
    if (undated.length > 0) {
      out.push("## Undated", "");
      for (const card of undated) writeCard(card, true);
    }
  }
  return out.join("\n").trimEnd() + "\n";
}

const CSV_COLUMNS = [
  "Chapter",
  "Scene",
  "Title",
  "Plot line",
  "Also in",
  "Status",
  "When",
  "Where",
  "Characters",
  "Story tags",
  "Relationship",
  "Synopsis",
  "Linked notes",
] as const;

/**
 * One row per card, for spreadsheets. Cells that a spreadsheet would read as
 * a formula are prefixed with an apostrophe, and the file starts with a byte
 * order mark so Excel reads it as UTF-8.
 */
export function exportCsv(story: Story, order: ExportOrder): string {
  const cards = order === "reading" ? cardsInReadingOrder(story) : sortedByTime(story);
  const rows: string[][] = [[...CSV_COLUMNS]];
  for (const card of cards) {
    const f = facts(story, card);
    rows.push([
      f.chapter,
      String(card.order),
      card.title,
      f.plotLine,
      f.alsoIn.join("; "),
      card.status,
      f.date,
      f.place,
      f.characters.map((c) => `${c.name} (${c.role})`).join("; "),
      f.tags.join("; "),
      f.relationship,
      card.synopsis.trim(),
      f.notes.join("; "),
    ]);
  }
  return "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Dated cards in story order, then undated ones in reading order. */
function sortedByTime(story: Story): Card[] {
  const all = Object.values(story.cards);
  return [...timeSorted(story, all.filter((c) => c.date)), ...cardsInReadingOrder(story).filter((c) => !c.date)];
}

export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The whole story as data, for backups or other tools. */
export function exportJson(story: Story): string {
  return JSON.stringify(story, null, 2) + "\n";
}

export function exportStory(story: Story, format: ExportFormat, order: ExportOrder): string {
  if (format === "csv") return exportCsv(story, order);
  if (format === "json") return exportJson(story);
  return exportMarkdown(story, order);
}
