import { Story } from "./types";

// What cards on the board show besides their title. The plugin settings hold
// the defaults; a story can set its own for any of them, kept in its note.

export type CardShow = "chapter" | "date" | "synopsis" | "tags" | "characters" | "place" | "written" | "notes";

export const CARD_SHOW_LABELS: Record<CardShow, string> = {
  chapter: "Chapter (in story time and the character views)",
  date: "Date and time",
  synopsis: "Synopsis",
  tags: "Scene tags",
  characters: "Characters",
  place: "Place",
  written: "Written box",
  notes: "Linked notes",
};

export const DEFAULT_CARD_SHOWS: Record<CardShow, boolean> = {
  chapter: true,
  date: true,
  synopsis: true,
  tags: true,
  characters: false,
  place: true,
  written: true,
  notes: true,
};

/** Whether a story's cards show something: the story's own choice, else the plugin's default. */
export function cardShows(story: Story | null | undefined, defaults: Partial<Record<CardShow, boolean>> | undefined, what: CardShow): boolean {
  return story?.cardShows?.[what] ?? defaults?.[what] ?? DEFAULT_CARD_SHOWS[what];
}

/** A story's own choices as stored: only known keys with true or false. */
export function cleanCardShows(raw: unknown): Partial<Record<CardShow, boolean>> | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const out: Partial<Record<CardShow, boolean>> = {};
  for (const key of Object.keys(DEFAULT_CARD_SHOWS) as CardShow[]) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === "boolean") out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
