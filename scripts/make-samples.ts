// Regenerates the sample stories in test-vault/Stories with `npm run samples`.
// Ids and timestamps are fixed so the output only changes when the format does.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serializeStory } from "../src/format/storyFile";
import { createEmptyStory } from "../src/model/defaults";
import { Calendar, Card, Story } from "../src/model/types";

const OUT = join("test-vault", "Stories");
const STAMP = "2026-10-18T00:00:00.000Z";

function card(fields: Partial<Card> & Pick<Card, "id" | "title" | "plotLine" | "chapter" | "order">): Card {
  return { synopsis: "", alsoIn: [], characters: [], status: "outlined", tags: [], notes: [], modified: STAMP, ...fields };
}

function addCards(story: Story, cards: Card[]): void {
  for (const c of cards) story.cards[c.id] = c;
}

/** A small, plain story: two plot lines, three chapters. */
function smallStory(): Story {
  const s = createEmptyStory("A Small Story");
  s.plotLines = [
    { id: "p1", name: "The move", color: "#4a90d9" },
    { id: "p2", name: "Old friends", color: "#5cb85c" },
  ];
  s.chapters = [
    { id: "c1", name: "Chapter 1" },
    { id: "c2", name: "Chapter 2" },
    { id: "c3", name: "Chapter 3" },
  ];
  addCards(s, [
    card({ id: "k01", title: "Boxes everywhere", plotLine: "p1", chapter: "c1", order: 1, synopsis: "June packs up the flat she has lived in for ten years." }),
    card({ id: "k02", title: "A letter from Tom", plotLine: "p2", chapter: "c1", order: 2, synopsis: "An old friend writes for the first time in years." }),
    card({ id: "k03", title: "The new street", plotLine: "p1", chapter: "c2", order: 1 }),
    card({ id: "k04", title: "Coffee with Tom", plotLine: "p2", chapter: "c2", order: 2, alsoIn: ["p1"], synopsis: "Tom turns out to live two streets away." }),
    card({ id: "k05", title: "Unpacked", plotLine: "p1", chapter: "c3", order: 1, status: "idea" }),
  ]);
  return s;
}

/** An invented calendar with unusual months, a short week and named times of day. */
function harbourCalendar(): Calendar {
  return {
    id: "main",
    name: "Harbour reckoning",
    months: [
      { name: "Thaw", days: 40 },
      { name: "Sowing", days: 40 },
      { name: "Highsun", days: 45 },
      { name: "Reaping", days: 40 },
      { name: "Frost", days: 35 },
      { name: "Deepdark", days: 30 },
      { name: "Turning", days: 5 },
    ],
    leap: { everyYears: 3, monthIndex: 6, extraDays: 1 },
    eras: [{ id: "af", name: "AF" }],
    weekdays: ["Moonday", "Tideday", "Marketday", "Restday", "Fireday"],
    weekAnchor: { year: 1531, month: 1, day: 1, weekdayIndex: 2 },
    hoursPerDay: 20,
    minutesPerHour: 50,
    dayParts: [
      { id: "dawn", name: "Dawn", startHour: 4, endHour: 6 },
      { id: "day", name: "Day", startHour: 6, endHour: 13 },
      { id: "dusk", name: "Dusk", startHour: 13, endHour: 15 },
      { id: "night", name: "Night", startHour: 15, endHour: 20 },
    ],
  };
}

/** Exercises custom calendars, time zones, nested locations, characters, tags and off-page events. */
function harbourStory(): Story {
  const s = createEmptyStory("The Glass Harbour");
  s.calendars = [harbourCalendar()];
  s.zones = [
    { id: "z1", name: "Harbour Time", offsetMinutes: 0 },
    { id: "z2", name: "Eastern Provinces", offsetMinutes: 150 },
  ];
  s.referenceZone = "z1";
  s.locations = [
    { id: "l1", name: "Glass Harbour", zone: "z1" },
    { id: "l2", name: "The pier", parent: "l1" },
    { id: "l3", name: "Harbourmaster's office", parent: "l1" },
    { id: "l4", name: "Eastern Provinces", zone: "z2" },
    { id: "l5", name: "Vell Manor", parent: "l4" },
  ];
  s.characters = [
    { id: "x1", name: "Mara", color: "#9b59b6", description: "Harbour watch investigator." },
    { id: "x2", name: "Ilse", color: "#1abc9c", description: "Courier from the east.", zone: "z2" },
    { id: "x3", name: "Harbourmaster Oren", color: "#7f8c8d" },
  ];
  s.plotLines = [
    { id: "p1", name: "Investigation", color: "#4a90d9" },
    { id: "p2", name: "Mara and Ilse", color: "#d9534f", characters: ["x1", "x2"] },
    { id: "p3", name: "The eastern letters", color: "#f0ad4e" },
  ];
  s.chapters = [
    { id: "c1", name: "Chapter 1: The Pier" },
    { id: "c2", name: "Chapter 2: Letters" },
  ];
  s.tags = [
    { id: "g1", name: "clue", color: "#e67e22" },
    { id: "g2", name: "red herring", color: "#7f8c8d" },
  ];
  const date = (month: number, day: number, extra: object = {}) => ({ calendar: "main", era: "af", year: 1531, month, day, ...extra });
  addCards(s, [
    card({
      id: "k01", title: "Body found at the pier", plotLine: "p1", chapter: "c1", order: 1,
      synopsis: "Mara is called out before dawn and finds the harbourmaster's body at the end of the pier.",
      date: date(5, 4, { dayPart: "dawn" }), location: "l2", tags: ["g1"],
      characters: [{ id: "x1", role: "pov", note: "Notices the missing ring." }, { id: "x3", role: "mentioned" }],
    }),
    card({
      id: "k02", title: "Ilse arrives", plotLine: "p2", chapter: "c1", order: 2, alsoIn: ["p3"],
      synopsis: "A courier from the east asks for the harbourmaster by name.",
      date: date(5, 4, { dayPart: "dusk" }), location: "l1", relationshipState: "strangers",
      characters: [{ id: "x2", role: "pov", note: "Lies about why she came." }, { id: "x1", role: "present" }],
    }),
    card({
      id: "k03", title: "The office ledger", plotLine: "p1", chapter: "c2", order: 1,
      synopsis: "A page has been cut from the harbourmaster's ledger.",
      date: date(5, 5, { minutes: 6 * 50 + 25 }), location: "l3", tags: ["g1", "g2"],
      characters: [{ id: "x1", role: "pov", note: "Finds the cut page." }],
    }),
    card({
      id: "k04", title: "A letter is sealed at Vell Manor", plotLine: "p3", chapter: "c2", order: 2,
      date: date(5, 3, { dayPart: "night", zone: "z2", approximate: true }), location: "l5",
      characters: [{ id: "x2", role: "present", note: "Receives the letter." }],
    }),
    card({
      id: "k05", title: "The harbourmaster's last meeting", plotLine: "p1", chapter: null, order: 1,
      synopsis: "Off-page: Oren meets someone on the pier the night before he dies.",
      date: date(5, 3, { dayPart: "night" }), location: "l2",
      characters: [{ id: "x3", role: "present", note: "Hands over the ring." }],
    }),
  ]);
  return s;
}

/** A large generated story for checking performance: 8 plot lines, 40 chapters, 320 cards. */
function largeStory(): Story {
  const s = createEmptyStory("Large Story (performance test)");
  const colors = ["#4a90d9", "#d9534f", "#5cb85c", "#f0ad4e", "#9b59b6", "#1abc9c", "#e67e22", "#7f8c8d"];
  s.plotLines = colors.map((color, i) => ({ id: `p${i + 1}`, name: `Plot line ${i + 1}`, color }));
  s.chapters = Array.from({ length: 40 }, (_, i) => ({ id: `c${String(i + 1).padStart(2, "0")}`, name: `Chapter ${i + 1}` }));
  let n = 0;
  for (const chapter of s.chapters) {
    for (let scene = 1; scene <= 8; scene++) {
      n++;
      const plotLine = s.plotLines[(n * 3) % s.plotLines.length]!.id;
      addCards(s, [
        card({
          id: `k${String(n).padStart(4, "0")}`, title: `Scene ${n}`, plotLine, chapter: chapter.id, order: scene,
          synopsis: "A short synopsis of a few sentences, roughly the length a real card would have. Something happens, and it matters later.",
          alsoIn: n % 7 === 0 ? [s.plotLines[(n * 3 + 1) % s.plotLines.length]!.id] : [],
        }),
      ]);
    }
  }
  return s;
}

mkdirSync(OUT, { recursive: true });
for (const story of [smallStory(), harbourStory(), largeStory()]) {
  const path = join(OUT, `${story.title}.md`);
  writeFileSync(path, serializeStory(story));
  console.log(`wrote ${path}`);
}
