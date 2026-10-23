import { describe, expect, it } from "vitest";
import { createEmptyStory } from "../src/model/defaults";
import { createEvent } from "../src/model/eventCreation";
import { addChapter, addPlotLine } from "../src/model/setup";
import { computeBoardLayout } from "../src/view/layout";

describe("making a new event", () => {
  it("starts it with a first scene in the first plot line and chapter, so the board shows it", () => {
    const story = createEmptyStory("Events");
    const made = createEvent(story)!;
    const event = story.events.find((e) => e.id === made.eventId)!;
    const card = story.cards[made.cardId]!;
    expect(event.title).toBe("");
    expect(card.event).toBe(event.id);
    expect(card.plotLine).toBe(story.plotLines[0]!.id);
    expect(card.chapter).toBe(story.chapters[0]!.id);
    // Shown as one event card while events are shown, and as its scene otherwise.
    const shown = computeBoardLayout(story, "vertical", false, new Set(), true, { expanded: new Set() }).items;
    expect(shown.some((p) => p.item.kind === "event-card" && (p.item as { eventId: string }).eventId === event.id)).toBe(true);
    const scenes = computeBoardLayout(story, "vertical", false, new Set(), true).items;
    expect(scenes.some((p) => p.item.kind === "card" && (p.item as { cardId: string }).cardId === card.id)).toBe(true);
  });

  it("goes in the plot line and chapter it was made in", () => {
    const story = createEmptyStory("Events");
    const p2 = addPlotLine(story, "Second");
    const c2 = addChapter(story, "Two");
    const made = createEvent(story, { plotLine: p2, chapter: c2 })!;
    expect(story.cards[made.cardId]!.plotLine).toBe(p2);
    expect(story.cards[made.cardId]!.chapter).toBe(c2);
    expect(story.events.find((e) => e.id === made.eventId)!.plotLine).toBe(p2);
  });

  it("puts its first scene at the date it was made at, in story time", () => {
    const story = createEmptyStory("Events");
    const date = { calendar: "main", year: 1531, month: 4, day: 9 };
    const made = createEvent(story, { plotLine: story.plotLines[0]!.id, date })!;
    expect(story.cards[made.cardId]!.date).toEqual(date);
    expect(story.cards[made.cardId]!.chapter).toBeNull();
  });

  it("makes nothing in a story with no plot lines", () => {
    const story = createEmptyStory("Events");
    story.plotLines = [];
    expect(createEvent(story)).toBeNull();
    expect(story.events).toHaveLength(0);
  });
});
