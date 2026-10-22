import { describe, expect, it } from "vitest";
import { parseStory, serializeStory } from "../src/format/storyFile";
import { createCard, createEmptyStory } from "../src/model/defaults";
import {
  addCustomField,
  addOrganization,
  addOrgByName,
  ageAt,
  cardsWithOrg,
  characterAppearances,
  deleteCustomField,
  deleteOrganization,
  nextOrgRole,
  orgAppearances,
  orgMembers,
  orgRoles,
  orgTree,
  setCardOrg,
  setMembership,
  setOrgParent,
} from "../src/model/entities";
import {
  addEvent,
  canBeParent,
  deleteEvent,
  emptyEvents,
  eventCards,
  eventPath,
  eventSpan,
  eventTree,
  moveEvent,
  setCardEvent,
  setEventParent,
} from "../src/model/events";
import { Story, StoryDate } from "../src/model/types";

const NOW = "2026-10-22T00:00:00.000Z";
const d = (year: number, month?: number, day?: number): StoryDate => ({ calendar: "main", year, month, day });

function story(): Story {
  const s = createEmptyStory("Entities");
  s.calendars[0]!.id = "main";
  s.plotLines = [
    { id: "p1", name: "A", color: "#000" },
    { id: "p2", name: "B", color: "#111" },
  ];
  s.chapters = [
    { id: "c1", name: "One" },
    { id: "c2", name: "Two" },
  ];
  s.characters = [
    { id: "mara", name: "Mara", color: "#a00" },
    { id: "ilse", name: "Ilse", color: "#0a0" },
  ];
  const add = (id: string, chapter: string | null, order: number, fields: Record<string, unknown> = {}) =>
    (s.cards[id] = { ...createCard({ title: id, plotLine: "p1", chapter, order, ...fields }), id });
  add("k1", "c1", 1, { characters: [{ id: "mara", role: "pov" }], date: d(1531, 2, 1) });
  add("k2", "c1", 2, { characters: [{ id: "mara", role: "mentioned" }, { id: "ilse", role: "present" }], plotLine: "p2", date: d(1531, 1, 5) });
  add("k3", "c2", 1, { characters: [{ id: "ilse", role: "pov" }], endDate: d(1531, 3, 9), date: d(1531, 3, 1) });
  add("k4", null, 1);
  return s;
}

describe("organizations", () => {
  it("nests, never inside themselves, and lists as a tree", () => {
    const s = story();
    const guild = addOrganization(s, "Guild");
    const branch = addOrganization(s, "Harbour branch", guild);
    const cell = addOrganization(s, "Night cell", branch);
    expect(setOrgParent(s, guild, cell)).toBe(false);
    expect(orgTree(s).map(({ org, depth }) => `${depth}:${org.name}`)).toEqual(["0:Guild", "1:Harbour branch", "2:Night cell"]);
    deleteOrganization(s, branch, NOW);
    expect(s.organizations.find((o) => o.id === cell)!.parent).toBe(guild);
  });

  it("take part in scenes, involved or mentioned, and are cleaned up when deleted", () => {
    const s = story();
    const guild = addOrganization(s, "Guild");
    expect(addOrgByName(s, "k1", "guild", NOW)).toBe(true);
    expect(s.cards.k1!.orgs).toEqual([{ id: guild, role: "involved" }]);
    addOrgByName(s, "k2", "The Watch", NOW);
    expect(s.organizations.map((o) => o.name)).toEqual(["Guild", "The Watch"]);
    setCardOrg(s, "k2", guild, "mentioned", NOW);
    expect(orgRoles(s, [s.cards.k1!, s.cards.k2!]).find((r) => r.id === guild)).toEqual({ id: guild, role: "mixed", onAll: true });
    expect([nextOrgRole("involved"), nextOrgRole("mentioned"), nextOrgRole("mixed")]).toEqual(["mentioned", "involved", "involved"]);
    expect(orgAppearances(s, guild).roles).toEqual({ involved: 1, mentioned: 1 });
    deleteOrganization(s, guild, NOW);
    expect(s.cards.k1!.orgs).toBeUndefined();
  });

  it("have members, through the characters' memberships, with ranks and dates", () => {
    const s = story();
    const guild = addOrganization(s, "Guild");
    setMembership(s, "mara", guild, { rank: "Captain", from: d(1529) });
    setMembership(s, "mara", guild, { rank: "" });
    expect(s.characters[0]!.orgs).toEqual([{ id: guild, from: d(1529) }]);
    setMembership(s, "ilse", guild, {});
    expect(orgMembers(s, guild).map((m) => m.characterId)).toEqual(["mara", "ilse"]);
    // Scenes with the organization, or with its members.
    expect(cardsWithOrg(s, guild).map((c) => c.id)).toEqual([]);
    expect(cardsWithOrg(s, guild, true).map((c) => c.id)).toEqual(["k1", "k2", "k3"]);
    setMembership(s, "ilse", guild, null);
    expect(s.characters[1]!.orgs).toBeUndefined();
  });
});

describe("profiles", () => {
  it("count a character's scenes by role, in reading order, with their plot lines", () => {
    const a = characterAppearances(story(), "mara");
    expect(a.cards.map((c) => c.id)).toEqual(["k1", "k2"]);
    expect([a.first?.id, a.last?.id]).toEqual(["k1", "k2"]);
    expect(a.roles).toEqual({ pov: 1, mentioned: 1 });
    expect(a.plotLines).toEqual([
      { id: "p1", count: 1 },
      { id: "p2", count: 1 },
    ]);
  });

  it("work out an age in whole years of the story's calendar", () => {
    const s = story();
    expect(ageAt(s, d(1500, 6, 10), d(1531, 6, 9))).toBe(30);
    expect(ageAt(s, d(1500, 6, 10), d(1531, 6, 10))).toBe(31);
    expect(ageAt(s, d(1500), d(1531, 1, 1))).toBe(31);
    expect(ageAt(s, d(1540), d(1531))).toBeUndefined();
  });

  it("have the story's own fields; deleting one deletes its values", () => {
    const s = story();
    const motto = addCustomField(s, "Motto", "text", "both");
    s.characters[0]!.fields = { [motto]: "Never twice" };
    deleteCustomField(s, motto);
    expect(s.customFields).toEqual([]);
    expect(s.characters[0]!.fields).toBeUndefined();
  });
});

describe("events", () => {
  it("nest one level, in arcs", () => {
    const s = story();
    const arc = addEvent(s, "The siege");
    const battle = addEvent(s, "The battle", arc);
    const night = addEvent(s, "The night after");
    expect(canBeParent(s, battle, night)).toBe(false); // battle is inside an arc
    expect(setEventParent(s, arc, night)).toBe(false); // arc holds an event
    expect(setEventParent(s, night, arc)).toBe(true);
    expect(eventTree(s).map(({ event, children }) => `${event.title}>${children.map((c) => c.title).join(",")}`)).toEqual([
      "The siege>The battle,The night after",
    ]);
  });

  it("hold cards, one event per card, in story order, and span their cards' dates", () => {
    const s = story();
    const arc = addEvent(s, "Arc");
    const e = addEvent(s, "Event", arc);
    setCardEvent(s, "k1", e, NOW);
    setCardEvent(s, "k2", e, NOW);
    setCardEvent(s, "k3", arc, NOW);
    expect(eventCards(s, e).map((c) => c.id)).toEqual(["k2", "k1"]);
    expect(eventCards(s, arc, true).map((c) => c.id)).toEqual(["k2", "k1", "k3"]);
    expect(eventPath(s, s.cards.k1!).map((x) => x.title)).toEqual(["Arc", "Event"]);
    expect(eventSpan(s, e)).toEqual({ start: d(1531, 1, 5), end: d(1531, 2, 1) });
    expect(eventSpan(s, arc)).toEqual({ start: d(1531, 1, 5), end: d(1531, 3, 9) });
    // The writer's own start wins.
    s.events.find((x) => x.id === e)!.start = d(1530);
    expect(eventSpan(s, e).start).toEqual(d(1530));
    const empty = addEvent(s, "Later");
    expect(emptyEvents(s).map((x) => x.id)).toEqual([empty]);
    deleteEvent(s, arc, NOW);
    expect(s.cards.k3!.event).toBeUndefined();
    expect(s.events.find((x) => x.id === e)!.parent).toBeUndefined();
  });

  it("move in the list and into arcs", () => {
    const s = story();
    const a = addEvent(s, "A");
    const b = addEvent(s, "B");
    const c = addEvent(s, "C");
    moveEvent(s, c, a);
    expect(s.events.map((e) => e.title)).toEqual(["C", "A", "B"]);
    moveEvent(s, b, null, c);
    expect(s.events.map((e) => `${e.title}${e.parent ? "<" : ""}`)).toEqual(["C", "B<", "A"]);
  });
});

describe("the story file, version 3", () => {
  it("keeps characters, organizations and events each on a line of their own, and opens version 2 stories", () => {
    const s = story();
    const guild = addOrganization(s, "Guild");
    setMembership(s, "mara", guild, { rank: "Captain", from: d(1529) });
    s.characters[0]!.aliases = ["The Watchwoman"];
    s.characters[0]!.born = d(1500, 6, 10);
    const motto = addCustomField(s, "Motto", "choice", "character");
    s.customFields[0]!.options = ["Never twice"];
    s.characters[0]!.fields = { [motto]: "Never twice" };
    setCardOrg(s, "k1", guild, "mentioned", NOW);
    const e = addEvent(s, "The siege");
    setCardEvent(s, "k1", e, NOW);
    s.plotLines[0]!.synopsis = "The investigation.";
    s.info = { logline: "A death at the harbour.", genre: "Mystery" };
    const text = serializeStory(s);
    const lines = text.slice(text.indexOf("storyplanner-data")).split("\n");
    expect(lines.filter((l) => l.startsWith('{"kind":"character"'))).toHaveLength(2);
    expect(lines.filter((l) => l.startsWith('{"kind":"organization"'))).toHaveLength(1);
    expect(lines.filter((l) => l.startsWith('{"kind":"event"'))).toHaveLength(1);
    expect(lines[1]).not.toContain('"characters"');
    const parsed = parseStory(text);
    expect(parsed.ok && parsed.story).toEqual(s);

    // A version 2 story: characters in the setup line, no organizations or events.
    const old = text
      .replace('"schema":3', '"schema":2')
      .replace(/\n\{"kind":"(organization|event)"[^\n]*/g, "")
      .replace(/\n\{"kind":"character"[^\n]*/g, "")
      .replace('"plotLines":', '"characters":[{"id":"mara","name":"Mara","color":"#a00"}],"plotLines":');
    const opened = parseStory(old);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.story.characters.map((c) => c.name)).toEqual(["Mara"]);
    expect(opened.story.organizations).toEqual([]);
    expect(opened.story.events).toEqual([]);
    expect(serializeStory(opened.story)).toContain('{"kind":"character","id":"mara"');
  });

  it("refuses a line of a kind it does not know, rather than guess", () => {
    const saved = serializeStory(story());
    const end = saved.lastIndexOf("\n%%");
    const text = `${saved.slice(0, end)}\n{"kind":"spaceship","id":"x"}${saved.slice(end)}`;
    const parsed = parseStory(text);
    expect(parsed.ok).toBe(false);
  });
});
