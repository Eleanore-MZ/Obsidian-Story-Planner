import { cardMoment, formatDateRange, formatStoryDate } from "../model/calendar";
import { referenceDate, timeSorted } from "../model/storyTime";
import { actsShown, actTitle, chapterNumbers, chapterTitle } from "../model/chapters";
import { isUntitled } from "../model/defaults";
import { duringChapter } from "../model/edits";
import { fieldsFor, orgMembers, orgTree } from "../model/entities";
import { eventOf } from "../model/events";
import { cardsInReadingOrder } from "../model/search";
import { Act, Card, Chapter, Character, CustomValue, Entity, Organization, Story, StoryEvent, StoryInfo } from "../model/types";
import { escapeText, safeMarkdown } from "./storyFile";

// The composed outline, in four parts: the story (what it is), its
// characters, its organizations, and its plot: the plot lines, then acts,
// their chapters, the events in each chapter and each chapter's scenes in
// board order, with the off-page events that happen during a chapter listed
// under it as its background. The Outline tab shows it, and "Export outline"
// writes it as a Markdown note of its own.

/** A run of a chapter's scenes in one event (or in none), in board order. */
export interface OutlineGroup {
  event: StoryEvent | null;
  cards: Card[];
}

export interface OutlineChapter {
  /** Null for the off-page events that happen during no chapter. */
  chapter: Chapter | null;
  heading: string;
  synopsis: string;
  cards: Card[];
  /** The scenes, in runs by event. */
  groups: OutlineGroup[];
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

/** One line of the story's contents, as the Contents side view lists it. */
export interface ContentsEntry {
  label: string;
  /** How far in it is listed. */
  depth: number;
  /** Where it is on the Outline tab (its `data-anchor`). */
  anchor: string;
  /** The Outline tab's folded sections that must open to show it. */
  unfold: string[];
  chapterId?: string;
  eventId?: string;
}

/**
 * The story's contents, in the Outline tab's order: Story, Characters and
 * Organizations with their members, Plot with its plot lines, then the acts,
 * chapters and the events in each chapter (each event where it first shows).
 */
export function outlineContents(story: Story): ContentsEntry[] {
  const out: ContentsEntry[] = [{ label: "Story", depth: 0, anchor: "story", unfold: [] }];
  out.push({ label: "Characters", depth: 0, anchor: "characters", unfold: [] });
  for (const c of story.characters) out.push({ label: c.name || "Unnamed", depth: 1, anchor: `entity:${c.id}`, unfold: ["characters"] });
  out.push({ label: "Organizations", depth: 0, anchor: "organizations", unfold: [] });
  for (const { org, depth } of orgTree(story)) out.push({ label: org.name || "Unnamed", depth: 1 + depth, anchor: `entity:${org.id}`, unfold: ["organizations"] });
  out.push({ label: "Plot", depth: 0, anchor: "plot", unfold: [] });
  out.push({ label: "Plot lines", depth: 1, anchor: "plot-lines", unfold: ["plot"] });
  for (const p of story.plotLines) out.push({ label: p.name || "Unnamed", depth: 2, anchor: `plotline:${p.id}`, unfold: ["plot", "plot-lines"] });
  const seen = new Set<string>();
  for (const part of composeOutline(story)) {
    const above = ["plot"];
    if (part.act) {
      out.push({ label: part.heading, depth: 1, anchor: `act:${part.act.id}`, unfold: [...above] });
      above.push(`act:${part.act.id}`);
    }
    for (const chapter of part.chapters) {
      const key = `chapter:${chapter.chapter?.id ?? "off"}`;
      out.push({ label: chapter.heading, depth: above.length, anchor: key, unfold: [...above], ...(chapter.chapter ? { chapterId: chapter.chapter.id } : {}) });
      for (const group of chapter.groups) {
        if (!group.event || seen.has(group.event.id)) continue;
        seen.add(group.event.id);
        out.push({ label: group.event.title || "Untitled event", depth: above.length + 1, anchor: `event:${group.event.id}`, unfold: [...above, key], eventId: group.event.id });
      }
    }
  }
  return out;
}

/** The front matter that marks a note as an exported outline, so a later export may replace it. */
export const OUTLINE_MARKER = "storyplanner: outline";

/** The story's general information, labelled, in the order the outline shows it. */
export const INFO_LABELS: [keyof StoryInfo, string][] = [
  ["logline", "Logline"],
  ["genre", "Genre"],
  ["premise", "Premise"],
  ["themes", "Themes"],
  ["notes", "Notes"],
];

/** A chapter's scenes in runs by event: a new run starts wherever the event changes. */
export function groupByEvent(story: Story, cards: Card[]): OutlineGroup[] {
  const groups: OutlineGroup[] = [];
  for (const card of cards) {
    const event = eventOf(story, card) ?? null;
    const last = groups[groups.length - 1];
    if (last && last.event?.id === event?.id) last.cards.push(card);
    else groups.push({ event, cards: [card] });
  }
  return groups;
}

/** A year, month or day of the plot in story-time order, with its scenes and the shorter spans inside it. */
export interface TimeOutlineSpan {
  /** Stable key, for folding: the date it covers. */
  key: string;
  level: "year" | "month" | "day";
  /** The date at this precision, in the story's date format. */
  heading: string;
  /** Scenes dated only to this span (a year-only date in a year), in runs by event. */
  groups: OutlineGroup[];
  spans: TimeOutlineSpan[];
}

export interface TimeOutline {
  spans: TimeOutlineSpan[];
  /** Scenes with no date, in reading order. */
  undated: OutlineGroup[];
}

/** Adds a card to runs by event: to the last run when it is the same event, else as a new run. */
function addToGroups(story: Story, groups: OutlineGroup[], card: Card): void {
  const event = eventOf(story, card) ?? null;
  const last = groups[groups.length - 1];
  if (last && last.event?.id === event?.id) last.cards.push(card);
  else groups.push({ event, cards: [card] });
}

/**
 * The plot in story-time order: years, months inside them and days inside
 * those, each with its scenes (off-page ones too) in the order they happen,
 * in runs by event; scenes with no date come last, in reading order.
 */
export function composeTimeOutline(story: Story): TimeOutline {
  const all = Object.values(story.cards);
  const spans: TimeOutlineSpan[] = [];
  const child = (list: TimeOutlineSpan[], key: string, level: TimeOutlineSpan["level"], heading: string) => {
    let span = list[list.length - 1];
    if (!span || span.key !== key) {
      span = { key, level, heading, groups: [], spans: [] };
      list.push(span);
    }
    return span;
  };
  for (const card of timeSorted(story, all.filter((c) => c.date))) {
    const d = referenceDate(story, card)!;
    const base = { calendar: d.calendar, year: d.year, ...(d.era ? { era: d.era } : {}) };
    const yearKey = `${d.calendar}:${d.era ?? ""}:${d.year}`;
    let span = child(spans, yearKey, "year", formatStoryDate(story, base));
    if (d.month !== undefined) {
      span = child(span.spans, `${yearKey}:${d.month}`, "month", formatStoryDate(story, { ...base, month: d.month }));
      if (d.day !== undefined) span = child(span.spans, `${yearKey}:${d.month}:${d.day}`, "day", formatStoryDate(story, { ...base, month: d.month, day: d.day }));
    }
    addToGroups(story, span.groups, card);
  }
  return { spans, undated: groupByEvent(story, cardsInReadingOrder(story).filter((c) => !c.date)) };
}

/** Which scenes happen at the same moment as this one (the ones its grip can reorder it among), as a key. */
export function timeSlot(story: Story, card: Card): string {
  const m = cardMoment(story, card);
  return m ? `${m.key}:${m.precision}` : "undated";
}

/** The plot as parts (acts, or one part without acts) of chapters of scenes. */
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
    const inChapter = cards.filter((c) => c.chapter === chapter.id);
    part.chapters.push({
      chapter,
      heading: chapterTitle(story, chapter, numbers),
      synopsis: chapter.summary?.trim() ?? "",
      cards: inChapter,
      groups: groupByEvent(story, inChapter),
      background: cards.filter((c) => duringChapter(story, c) === chapter.id),
    });
  }
  const offPage = cards.filter((c) => (c.chapter === null || !chapterIds.has(c.chapter)) && !duringChapter(story, c));
  if (offPage.length > 0) {
    parts.push({
      act: null,
      heading: "",
      synopsis: "",
      chapters: [{ chapter: null, heading: "Off-page", synopsis: "", cards: offPage, groups: groupByEvent(story, offPage), background: [] }],
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

/** A custom field's value as text. */
export function fieldText(story: Story, value: CustomValue): string {
  return typeof value === "string" ? value : formatDateRange(story, value, undefined);
}

/** The facts about a character the outline lists: aliases, role, organizations, birth and death, the story's own fields. */
export function characterFacts(story: Story, c: Character): [string, string][] {
  const facts: [string, string][] = [];
  if (c.aliases?.length) facts.push(["Aliases", c.aliases.join(", ")]);
  if (c.role?.trim()) facts.push(["Role", c.role.trim()]);
  const orgs = (c.orgs ?? [])
    .map((m) => {
      const org = story.organizations.find((o) => o.id === m.id);
      return org ? (m.rank ? `${org.name} (${m.rank})` : org.name) : null;
    })
    .filter((x): x is string => !!x);
  if (orgs.length > 0) facts.push(["Organizations", orgs.join(", ")]);
  if (c.born) facts.push(["Born", formatDateRange(story, c.born, undefined)]);
  if (c.died) facts.push(["Died", formatDateRange(story, c.died, undefined)]);
  return [...facts, ...customFacts(story, "character", c)];
}

/** The facts about an organization: what it is part of, its members, the story's own fields. */
export function organizationFacts(story: Story, o: Organization): [string, string][] {
  const facts: [string, string][] = [];
  const parent = o.parent ? story.organizations.find((x) => x.id === o.parent) : undefined;
  if (parent) facts.push(["Part of", parent.name]);
  const members = orgMembers(story, o.id)
    .map(({ characterId, membership }) => {
      const c = story.characters.find((x) => x.id === characterId);
      return c ? (membership.rank ? `${c.name} (${membership.rank})` : c.name) : null;
    })
    .filter((x): x is string => !!x);
  if (members.length > 0) facts.push(["Members", members.join(", ")]);
  return [...facts, ...customFacts(story, "organization", o)];
}

function customFacts(story: Story, kind: "character" | "organization", e: Entity): [string, string][] {
  return fieldsFor(story, kind)
    .filter((f) => e.fields?.[f.id] !== undefined)
    .map((f): [string, string] => [f.name, fieldText(story, e.fields![f.id]!)]);
}

/**
 * The outline as Markdown, in four parts: "## Story" (logline, genre,
 * premise, themes, notes), "## Characters" and "## Organizations" (one
 * heading each, their facts, then their summary), and "## Plot": the plot
 * lines with their synopses, then "### Act I: Title" and its synopsis,
 * "#### Chapter 1: Title" and its synopsis, the chapter's events as headings
 * one level down with their synopsis (the first time each appears), and the
 * scenes, then the chapter's background. Without acts, chapters are "###".
 * Parts with nothing in them are left out. Names are escaped; synopses and
 * summaries keep their own Markdown (emphasis, lists) but nothing in them
 * becomes a tag, link, embed or comment in the note.
 */
/**
 * A text the writer wrote, as safe Markdown lines: blank lines stay (one at a
 * time), and a line followed by another in the same block ends in two spaces,
 * so it stays its own line with strict line breaks on.
 */
export function markdownLines(text: string): string[] {
  const lines = safeMarkdown(text.trim().replace(/\n\s*\n(\s*\n)+/g, "\n\n")).split("\n").map((line) => line.trimEnd());
  // Code blocks keep their lines as they are, without the two spaces.
  let inCode = false;
  return lines.map((line, i) => {
    const fence = /^\s{0,3}(`{3,}|~{3,})/.test(line);
    const code = inCode || fence;
    if (fence) inCode = !inCode;
    const next = lines[i + 1];
    const nextFence = next !== undefined && /^\s{0,3}(`{3,}|~{3,})/.test(next);
    return !code && line && next && !nextFence ? `${line}  ` : line;
  });
}

/** The scene's chapter, as the story-time outline labels it: its title, or "Off-page". */
export function sceneChapterLabel(story: Story, card: Card): string {
  const chapter = story.chapters.find((c) => c.id === card.chapter);
  return chapter ? chapterTitle(story, chapter, chapterNumbers(story)) : "Off-page";
}

/** The plot's order in the outline: chapter by chapter, or the order things happen in. */
export type OutlineAxis = "chapters" | "time";

export function outlineMarkdown(story: Story, axis: OutlineAxis = "chapters"): string {
  const out: string[] = ["---", OUTLINE_MARKER, "---", "", `# ${escapeText(story.title)}`, ""];
  const paragraph = (text: string) => {
    out.push(...markdownLines(text));
    out.push("");
  };
  const facts = (list: [string, string][]) => {
    if (list.length === 0) return;
    list.forEach(([label, value], i) => out.push(`**${escapeText(label)}:** ${escapeText(value)}${i < list.length - 1 ? "  " : ""}`));
    out.push("");
  };

  // 1. The story.
  const info = INFO_LABELS.filter(([key]) => story.info?.[key]?.trim());
  if (info.length > 0) {
    out.push("## Story", "");
    for (const [key, label] of info) {
      const text = story.info![key]!.trim();
      if (text.includes("\n")) {
        out.push(`**${label}:**  `);
        paragraph(text);
      } else {
        out.push(`**${label}:** ${escapeText(text)}`, "");
      }
    }
  }

  // 2. Characters, 3. organizations.
  if (story.characters.length > 0) {
    out.push("## Characters", "");
    for (const c of story.characters) {
      out.push(`### ${escapeText(c.name)}`, "");
      facts(characterFacts(story, c));
      if (c.summary?.trim()) paragraph(c.summary.trim());
    }
  }
  if (story.organizations.length > 0) {
    out.push("## Organizations", "");
    for (const { org } of orgTree(story)) {
      out.push(`### ${escapeText(org.name)}`, "");
      facts(organizationFacts(story, org));
      if (org.summary?.trim()) paragraph(org.summary.trim());
    }
  }

  // 4. The plot.
  out.push("## Plot", "");
  const lines = story.plotLines.filter((p) => p.synopsis?.trim());
  if (lines.length > 0) {
    out.push("### Plot lines", "");
    for (const p of lines) {
      out.push(`**${escapeText(p.name)}**  `);
      paragraph(p.synopsis!.trim());
    }
  }
  const withActs = actsShown(story);
  const seen = new Set<string>();
  const writeCard = (card: Card) => {
    const { title, plotLine } = outlineCardLine(story, card);
    // In story time, each scene says which chapter it is in.
    const where = [plotLine, axis === "time" ? sceneChapterLabel(story, card) : ""].filter(Boolean).join(" · ");
    const label = [title ? `**${escapeText(title)}**` : "", where ? `(${escapeText(where)})` : ""].filter(Boolean).join(" ");
    if (label) out.push(`${label}  `);
    if (card.synopsis.trim()) paragraph(card.synopsis.trim());
    else out.push("");
  };
  const writeGroups = (groups: OutlineGroup[], level: string) =>
    groups.forEach((group, i) => {
      if (!group.event && i > 0) out.push(`${level} Other scenes`, "");
      if (group.event) {
        const parent = group.event.parent ? story.events.find((e) => e.id === group.event!.parent) : undefined;
        const name = [parent?.title, group.event.title || "Untitled event"].filter(Boolean).join(" › ");
        out.push(`${level} ${escapeText(name)}`, "");
        if (!seen.has(group.event.id) && group.event.synopsis?.trim()) paragraph(group.event.synopsis.trim());
        seen.add(group.event.id);
      }
      for (const card of group.cards) writeCard(card);
    });
  if (axis === "time") {
    // Years at ###, months and days a level down each; events one level below their span.
    const time = composeTimeOutline(story);
    const writeSpan = (span: TimeOutlineSpan, depth: number) => {
      const level = "#".repeat(Math.min(6, 3 + depth));
      out.push(`${level} ${escapeText(span.heading)}`, "");
      writeGroups(span.groups, "#".repeat(Math.min(6, 4 + depth)));
      for (const inner of span.spans) writeSpan(inner, depth + 1);
    };
    for (const span of time.spans) writeSpan(span, 0);
    if (time.undated.length > 0) {
      out.push("### Undated", "");
      writeGroups(time.undated, "####");
    }
    return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
  }
  for (const part of composeOutline(story)) {
    if (part.act) {
      out.push(`### ${escapeText(part.heading)}`, "");
      if (part.synopsis) paragraph(part.synopsis);
    }
    for (const chapter of part.chapters) {
      // Off-page, and chapters in no act, stand beside the acts.
      const level = withActs && part.act ? "####" : "###";
      out.push(`${level} ${escapeText(chapter.heading)}`, "");
      if (chapter.synopsis) paragraph(chapter.synopsis);
      chapter.groups.forEach((group, i) => {
        // Scenes in no event after an event's get a heading of their own, so they do not read as part of it.
        if (!group.event && i > 0) out.push(`${level}# Other scenes`, "");
        if (group.event) {
          const parent = group.event.parent ? story.events.find((e) => e.id === group.event!.parent) : undefined;
          const name = [parent?.title, group.event.title || "Untitled event"].filter(Boolean).join(" › ");
          out.push(`${level}# ${escapeText(name)}`, "");
          if (!seen.has(group.event.id) && group.event.synopsis?.trim()) paragraph(group.event.synopsis.trim());
          seen.add(group.event.id);
        }
        for (const card of group.cards) writeCard(card);
      });
      if (chapter.background.length > 0) {
        out.push(`${level}# Background`, "");
        for (const card of chapter.background) writeCard(card);
      }
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
