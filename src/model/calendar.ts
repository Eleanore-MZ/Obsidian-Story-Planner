import { Calendar, Story, StoryDate } from "./types";

// Display helpers for story dates. Date arithmetic (sort keys, time zone
// conversion) arrives with the story-time phase; this file only formats.

export function findCalendar(story: Story, id: string): Calendar | undefined {
  return story.calendars.find((c) => c.id === id);
}

/** Formats a date at its own precision, e.g. "1531", "December 1531", "4 December 1531, Dawn". */
export function formatStoryDate(story: Story, date: StoryDate): string {
  const calendar = findCalendar(story, date.calendar);
  const parts: string[] = [];

  if (date.month !== undefined) {
    const monthName = calendar?.months[date.month - 1]?.name ?? `Month ${date.month}`;
    parts.push(date.day !== undefined ? `${date.day} ${monthName}` : monthName);
  }
  parts.push(String(date.year));

  const era = date.era ? calendar?.eras?.find((e) => e.id === date.era)?.name : undefined;
  let text = parts.join(" ");
  if (era) text += ` ${era}`;

  if (date.dayPart !== undefined) {
    const part = calendar?.dayParts?.find((p) => p.id === date.dayPart);
    text += `, ${part?.name ?? date.dayPart}`;
  } else if (date.minutes !== undefined) {
    const perHour = calendar?.minutesPerHour ?? 60;
    const hours = Math.floor(date.minutes / perHour);
    const minutes = date.minutes % perHour;
    text += `, ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }

  if (date.zone) {
    const zone = story.zones.find((z) => z.id === date.zone);
    if (zone) text += ` (${zone.name})`;
  }

  return date.approximate ? `around ${text}` : text;
}
