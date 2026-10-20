import { actsShown, actTitle, chapterNumbers, chapterTitle } from "../model/chapters";
import { isUntitled } from "../model/defaults";
import { duringChapter } from "../model/edits";
import { cardsInReadingOrder } from "../model/search";
import { Act, Card, Chapter, Story } from "../model/types";
import { escapeLine, escapeText } from "./storyFile";

// The composed outline: acts, their chapters and each chapter's scenes in
// board order, with the off-page events that happen during a chapter listed
// under it as its background. The Outline tab shows it, and "Export outline"
// writes it as a Markdown note of its own.

export interface OutlineChapter {
  /** Null for the off-page events that happen during no chapter. */
  chapter: Chapter | null;
  heading: string;
  synopsis: string;
  cards: Card[];
  /** Off-page events that happen during this chapter. */
  background: Card[];
}

export interface OutlinePart {
  /** The act, when the story shows acts and these chapters are in one. */
  act: Act | null;
  heading: string;
  synopsis: string;
  chapters: OutlineChapter[];
}

/** The front matter that marks a note as an exported outline, so a later export may replace it. */
export const OUTLINE_MARKER = "storyplanner: outline";

/** The story as parts (acts, or one part without acts) of chapters of scenes. */
export function composeOutline(story: Story): OutlinePart[] {
  const cards = cardsInReadingOrder(story);
  const numbers = chapterNumbers(story);
  const withActs = actsShown(story);
  const chapterIds = new Set(story.chapters.map((c) => c.id));
  const parts: OutlinePart[] = [];
  for (const chapter of story.chapters) {
    const act = withActs && chapter.act ? (story.acts.find((a) => a.id === chapter.act) ?? null) : null;
    let part = parts[parts.length - 1];
    if (!part || part.act?.id !== act?.id) {
      part = { act, heading: act ? actTitle(story, act) : "", synopsis: act?.summary?.trim() ?? "", chapters: [] };
      parts.push(part);
    }
    part.chapters.push({
      chapter,
      heading: chapterTitle(story, chapter, numbers),
      synopsis: chapter.summary?.trim() ?? "",
      cards: cards.filter((c) => c.chapter === chapter.id),
      background: cards.filter((c) => duringChapter(story, c) === chapter.id),
    });
  }
  const offPage = cards.filter((c) => (c.chapter === null || !chapterIds.has(c.chapter)) && !duringChapter(story, c));
  if (offPage.length > 0) {
    parts.push({
      act: null,
      heading: "",
      synopsis: "",
      chapters: [{ chapter: null, heading: "Off-page", synopsis: "", cards: offPage, background: [] }],
    });
  }
  return parts;
}

/** What a card shows in the outline: its title and plot line, then its synopsis. */
export function outlineCardLine(story: Story, card: Card): { title: string; plotLine: string } {
  return {
    title: isUntitled(card.title) ? "" : card.title.trim(),
    plotLine: story.plotLines.find((p) => p.id === card.plotLine)?.name ?? "",
  };
}

/**
 * The outline as Markdown: "## Act I: Title" and its synopsis, "### Chapter 1:
 * Title" and its synopsis, then the chapter's scenes, and its background
 * under "#### Background". Without acts, chapters are "##". Text is escaped,
 * so nothing in the story becomes a tag, link or comment in the note.
 */
export function outlineMarkdown(story: Story): string {
  const out: string[] = ["---", OUTLINE_MARKER, "---", "", `# ${escapeText(story.title)}`, ""];
  const withActs = actsShown(story);
  const paragraph = (text: string) => {
    for (const line of text.split(/\n+/)) if (line.trim()) out.push(escapeLine(line));
    out.push("");
  };
  const writeCard = (card: Card) => {
    const { title, plotLine } = outlineCardLine(story, card);
    const label = [title ? `**${escapeText(title)}**` : "", plotLine ? `(${escapeText(plotLine)})` : ""].filter(Boolean).join(" ");
    if (label) out.push(label);
    if (card.synopsis.trim()) paragraph(card.synopsis.trim());
    else out.push("");
  };
  for (const part of composeOutline(story)) {
    if (part.act) {
      out.push(`## ${escapeText(part.heading)}`, "");
      if (part.synopsis) paragraph(part.synopsis);
    }
    for (const chapter of part.chapters) {
      // Off-page, and chapters in no act, stand beside the acts.
      const level = withActs && part.act ? "###" : "##";
      out.push(`${level} ${escapeText(chapter.heading)}`, "");
      if (chapter.synopsis) paragraph(chapter.synopsis);
      for (const card of chapter.cards) writeCard(card);
      if (chapter.background.length > 0) {
        out.push(`${level}# Background`, "");
        for (const card of chapter.background) writeCard(card);
      }
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
