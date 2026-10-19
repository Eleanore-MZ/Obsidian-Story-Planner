import { describe, expect, it } from "vitest";
import { createCard, createEmptyStory, PALETTE } from "../src/model/defaults";
import { chapterRows } from "../src/model/moves";
import { blankCalendar } from "../src/model/defaults";
import { momentOf } from "../src/model/calendar";
import {
  moveIndex,
  movedIndex,
  addLocation,
  addPlotLine,
  addTag,
  addZone,
  applyCalendar,
  cardsWithBadDates,
  deleteChapter,
  deleteCharacter,
  deletePlotLine,
  deleteLocation,
  deleteTag,
  deleteZone,
  locationAndInside,
  locationPath,
  locationTree,
  nestLocation,
  shiftLocation,
  mergeCharacters,
  setReferenceZone,
  shiftInList,
} from "../src/model/setup";
import { CardCharacter, Story } from "../src/model/types";

const NOW = "2026-10-18T23:30:00.000Z";

function story(): Story {
  const s = createEmptyStory("Setup");
  s.plotLines = [
    { id: "p1", name: "A", color: "#000" },
    { id: "p2", name: "B", color: "#111" },
  ];
  s.chapters = [
    { id: "c1", name: "One" },
    { id: "c2", name: "Two" },
  ];
  s.characters = [
    { id: "tom", name: "Tom", color: "#222" },
    { id: "thomas", name: "Thomas", color: "#333", description: "An old friend" },
  ];
  const add = (id: string, chapter: string, order: number, plotLine: string, alsoIn: string[] = [], characters: CardCharacter[] = []) =>
    (s.cards[id] = { ...createCard({ title: id, plotLine, chapter, order, alsoIn, characters }), id });
  add("a", "c1", 1, "p1", ["p2"], [{ id: "tom", role: "mentioned", note: "Writes" }]);
  add("b", "c1", 2, "p2", [], [{ id: "thomas", role: "pov" }]);
  add("c", "c1", 2, "p1", [], [{ id: "tom", role: "present" }, { id: "thomas", role: "mentioned", note: "Arrives" }]);
  add("d", "c2", 1, "p2");
  return s;
}

const rows = (s: Story, chapter: string | null) =>
  chapterRows(s, chapter)
    .map((row) => row.map((c) => c.id).join("+"))
    .join(" ");

describe("plot lines", () => {
  it("moves a deleted plot line's cards to another one and drops its echoes", () => {
    const s = story();
    expect(deletePlotLine(s, "p2", "p1", NOW)).toBe(true);
    expect(s.plotLines.map((p) => p.id)).toEqual(["p1"]);
    expect(s.cards.b!.plotLine).toBe("p1");
    expect(s.cards.d!.plotLine).toBe("p1");
    expect(s.cards.a!.alsoIn).toEqual([]);
  });

  it("can delete the cards with it, closing the gaps in scene order", () => {
    const s = story();
    deletePlotLine(s, "p1", null, NOW);
    expect(Object.keys(s.cards).sort()).toEqual(["b", "d"]);
    expect(s.cards.b!.order).toBe(1);
  });

  it("never deletes the last plot line", () => {
    const s = story();
    deletePlotLine(s, "p2", "p1", NOW);
    expect(deletePlotLine(s, "p1", null, NOW)).toBe(false);
  });

  it("gives a new plot line a colour no other plot line uses", () => {
    const s = story();
    s.plotLines[0]!.color = PALETTE[0]!;
    s.plotLines[1]!.color = PALETTE[1]!;
    const id = addPlotLine(s, "C");
    expect(s.plotLines.find((p) => p.id === id)!.color).toBe(PALETTE[2]);
  });

  it("reorders one step at a time", () => {
    const s = story();
    expect(shiftInList(s.plotLines, "p2", -1)).toBe(true);
    expect(s.plotLines.map((p) => p.id)).toEqual(["p2", "p1"]);
    expect(shiftInList(s.plotLines, "p2", -1)).toBe(false);
  });
});

describe("chapters", () => {
  it("merges a deleted chapter's scenes onto the end of another, keeping shared rows", () => {
    const s = story();
    expect(deleteChapter(s, "c1", "c2", NOW)).toBe(true);
    expect(rows(s, "c2")).toBe("d a b+c");
  });

  it("can move them off-page or delete them", () => {
    const s = story();
    deleteChapter(s, "c2", "off-page", NOW);
    expect(s.cards.d!.chapter).toBeNull();
    const t = story();
    deleteChapter(t, "c1", null, NOW);
    expect(Object.keys(t.cards)).toEqual(["d"]);
  });

  it("never deletes the last chapter", () => {
    const s = story();
    deleteChapter(s, "c2", "c1", NOW);
    expect(deleteChapter(s, "c1", null, NOW)).toBe(false);
  });
});

describe("characters", () => {
  it("deletes a character from the story and its cards", () => {
    const s = story();
    deleteCharacter(s, "tom", NOW);
    expect(s.characters.map((c) => c.id)).toEqual(["thomas"]);
    expect(s.cards.a!.characters).toEqual([]);
  });

  it("merges duplicates, keeping the stronger role and both notes", () => {
    const s = story();
    expect(mergeCharacters(s, "thomas", "tom", NOW)).toBe(true);
    expect(s.characters.map((c) => c.id)).toEqual(["tom"]);
    expect(s.characters[0]!.description).toBe("An old friend");
    expect(s.cards.b!.characters).toEqual([{ id: "tom", role: "pov" }]);
    expect(s.cards.c!.characters).toEqual([{ id: "tom", role: "present", note: "Arrives" }]);
    expect(s.cards.a!.characters).toEqual([{ id: "tom", role: "mentioned", note: "Writes" }]);
  });
});

describe("calendar and zones", () => {
  it("finds dates a changed calendar can no longer show", () => {
    const s = story();
    s.cards.a!.date = { calendar: "main", year: 1531, month: 12, day: 31 };
    s.cards.b!.date = { calendar: "main", year: 1531, month: 2, day: 3 };
    expect(cardsWithBadDates(s)).toEqual([]);
    s.calendars[0]!.months.pop();
    expect(cardsWithBadDates(s).map((c) => c.id)).toEqual(["a"]);
  });

  it("applies a preset, keeping the calendar id and dropping parts of the day it lacks", () => {
    const s = story();
    s.cards.a!.date = { calendar: "main", year: 1531, month: 1, day: 2, dayPart: "dawn" };
    applyCalendar(s, { ...blankCalendar(), id: "other" }, NOW);
    expect(s.calendars[0]!.id).toBe("main");
    expect(s.cards.a!.date).toEqual({ calendar: "main", year: 1531, month: 1, day: 2 });
    expect(s.cards.a!.modified).toBe(NOW);
  });

  it("makes the first zone the reference and re-measures offsets when the reference changes", () => {
    const s = story();
    const harbour = addZone(s, "Harbour", 999);
    const east = addZone(s, "East", 180);
    expect(s.referenceZone).toBe(harbour);
    expect(s.zones.map((z) => z.offsetMinutes)).toEqual([0, 180]);
    const date = { calendar: "main", year: 1531, month: 1, day: 1, minutes: 600, zone: east };
    const before = momentOf(s, date).key - momentOf(s, { ...date, zone: harbour }).key;
    setReferenceZone(s, east);
    expect(s.zones.map((z) => z.offsetMinutes)).toEqual([-180, 0]);
    expect(momentOf(s, date).key - momentOf(s, { ...date, zone: harbour }).key).toBe(before);
  });

  it("deletes a zone from dates, places and characters, passing on the reference", () => {
    const s = story();
    const harbour = addZone(s, "Harbour");
    const east = addZone(s, "East", 180);
    s.cards.a!.date = { calendar: "main", year: 1531, zone: harbour };
    s.characters[0]!.zone = harbour;
    s.locations = [{ id: "l", name: "Pier", zone: harbour }];
    deleteZone(s, harbour, NOW);
    expect(s.referenceZone).toBe(east);
    expect(s.zones).toEqual([{ id: east, name: "East", offsetMinutes: 0 }]);
    expect(s.cards.a!.date).toEqual({ calendar: "main", year: 1531 });
    expect(s.characters[0]!.zone).toBeUndefined();
    expect(s.locations[0]!.zone).toBeUndefined();
    deleteZone(s, east, NOW);
    expect(s.referenceZone).toBeUndefined();
  });
});

describe("locations", () => {
  function places() {
    const s = story();
    const city = addLocation(s, "City");
    const house = addLocation(s, "House", city);
    const room = addLocation(s, "Room", house);
    const port = addLocation(s, "Port");
    return { s, city, house, room, port };
  }

  it("lists a nested tree with depths and paths", () => {
    const { s, room, city } = places();
    expect(locationTree(s).map((t) => `${"-".repeat(t.depth)}${t.location.name}`)).toEqual(["City", "-House", "--Room", "Port"]);
    expect(locationPath(s, room)).toBe("City › House › Room");
    expect([...locationAndInside(s, city)].length).toBe(3);
  });

  it("indents, outdents and reorders among siblings", () => {
    const { s, port, house } = places();
    expect(nestLocation(s, port, true)).toBe(true);
    expect(locationTree(s).at(-1)).toMatchObject({ location: { name: "Port" }, depth: 1 });
    expect(nestLocation(s, port, false)).toBe(true);
    expect(locationTree(s).at(-1)).toMatchObject({ depth: 0 });
    expect(shiftLocation(s, port, -1)).toBe(true);
    expect(locationTree(s)[0]!.location.name).toBe("Port");
    expect(shiftLocation(s, house, -1)).toBe(false);
  });

  it("deletes a location, moving what was inside it up and freeing its cards", () => {
    const { s, house, room, city } = places();
    s.cards.a!.location = house;
    deleteLocation(s, house, NOW);
    expect(s.locations.find((l) => l.id === room)!.parent).toBe(city);
    expect(s.cards.a!.location).toBeUndefined();
  });

  it("survives a loop of parents", () => {
    const s = story();
    s.locations = [
      { id: "a", name: "A", parent: "b" },
      { id: "b", name: "B", parent: "a" },
    ];
    expect(locationTree(s).length).toBe(2);
    expect(locationPath(s, "a")).toBe("B › A");
  });
});

describe("tags", () => {
  it("deletes a tag from every card", () => {
    const s = story();
    const tag = addTag(s, "clue");
    s.cards.a!.tags = [tag];
    deleteTag(s, tag, NOW);
    expect(s.tags).toEqual([]);
    expect(s.cards.a!.tags).toEqual([]);
  });
});

describe("moving an item to a new place in a list", () => {
  it("moves down and up, and refuses moves that change nothing or go out of range", () => {
    const list = ["a", "b", "c", "d"];
    expect(moveIndex(list, 0, 2)).toBe(true);
    expect(list).toEqual(["b", "c", "a", "d"]);
    expect(moveIndex(list, 3, 0)).toBe(true);
    expect(list).toEqual(["d", "b", "c", "a"]);
    expect(moveIndex(list, 1, 1)).toBe(false);
    expect(moveIndex(list, 1, 4)).toBe(false);
    expect(list).toEqual(["d", "b", "c", "a"]);
  });

  it("follows another item through the move, such as the month with the leap day", () => {
    // Moving index 0 to 2 in [a, b, c, d] gives [b, c, a, d].
    expect([0, 1, 2, 3].map((k) => movedIndex(k, 0, 2))).toEqual([2, 0, 1, 3]);
    // Moving index 3 to 1 in [a, b, c, d] gives [a, d, b, c].
    expect([0, 1, 2, 3].map((k) => movedIndex(k, 3, 1))).toEqual([0, 2, 3, 1]);
  });
});
