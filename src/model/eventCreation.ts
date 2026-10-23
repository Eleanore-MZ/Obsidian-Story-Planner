import { addCardAt, setCardDate } from "./edits";
import { addEvent, setCardEvent } from "./events";
import { placeLastInTime } from "./storyTime";
import { Id, Story, StoryDate } from "./types";

/** Where a new event goes: a plot line, and a chapter (Main) or a date (story time). */
export interface NewEventPlace {
  plotLine?: Id;
  /** The chapter its first scene is in; null for an off-page scene. */
  chapter?: Id | null;
  /** When its first scene happens, in story time. */
  date?: StoryDate;
}

/**
 * Makes an event with one first, untitled scene, so it shows on the board at
 * once: as its card while events are shown, as the event marker on the scene
 * otherwise. The scene goes in the plot line and chapter asked for (the first
 * of each when none is), or at the date asked for, off-page. The event has no
 * title yet; it is written in its page.
 */
export function createEvent(story: Story, place: NewEventPlace = {}, now = new Date().toISOString()): { eventId: Id; cardId: Id } | null {
  const plotLine = story.plotLines.find((p) => p.id === place.plotLine)?.id ?? story.plotLines[0]?.id;
  if (!plotLine) return null;
  const eventId = addEvent(story, "");
  const event = story.events.find((e) => e.id === eventId)!;
  if (place.plotLine === plotLine) event.plotLine = plotLine;
  let chapter: Id | null;
  if (place.date) chapter = null;
  else if (place.chapter === null) chapter = null;
  else chapter = story.chapters.find((c) => c.id === place.chapter)?.id ?? story.chapters[0]?.id ?? null;
  const cardId = addCardAt(story, { chapter, plotLine }, "", now);
  if (place.date) {
    setCardDate(story, cardId, "date", { ...place.date }, now);
    placeLastInTime(story, cardId, now);
  }
  setCardEvent(story, cardId, eventId, now);
  return { eventId, cardId };
}
