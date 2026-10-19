// Regenerates the sample stories in test-vault/Stories with `npm run samples`.
// Ids and timestamps are fixed so the output only changes when the format does.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { serializeStory } from "../src/format/storyFile";
import { dayFromNumber, dayNumber } from "../src/model/calendar";
import { createEmptyStory } from "../src/model/defaults";
import { Calendar, Card, CardCharacter, Story, StoryDate } from "../src/model/types";

const OUT = join("test-vault", "Stories");
const STAMP = "2026-10-18T00:00:00.000Z";

function card(fields: Partial<Card> & Pick<Card, "id" | "title" | "plotLine" | "chapter" | "order">): Card {
  return { synopsis: "", alsoIn: [], characters: [], written: false, tags: [], notes: [], modified: STAMP, ...fields };
}

function addCards(story: Story, cards: Card[]): void {
  for (const c of cards) story.cards[c.id] = c;
}

/** A small story on the Gregorian-style calendar: two plot lines, three chapters, a few characters. */
function smallStory(): Story {
  const s = createEmptyStory("A Small Story");
  s.characters = [
    { id: "x1", name: "June", color: "#4a90d9", description: "Moving out after ten years in the same flat." },
    { id: "x2", name: "Tom", color: "#5cb85c", description: "An old friend from school." },
    { id: "x3", name: "Mrs Alder", color: "#e67e22", description: "June's new neighbour." },
  ];
  s.locations = [
    { id: "l1", name: "The old flat" },
    { id: "l2", name: "Linden Street" },
    { id: "l3", name: "Number 14", parent: "l2" },
    { id: "l4", name: "The corner café", parent: "l2" },
  ];
  s.plotLines = [
    { id: "p1", name: "The move", color: "#4a90d9" },
    { id: "p2", name: "Old friends", color: "#5cb85c" },
  ];
  // Numbered chapters without titles, as many drafts start.
  s.chapters = [
    { id: "c1", name: "" },
    { id: "c2", name: "" },
    { id: "c3", name: "" },
  ];
  const date = (month: number, day: number, extra: object = {}) => ({ calendar: "main", year: 2024, month, day, ...extra });
  addCards(s, [
    card({
      id: "k01", title: "Boxes everywhere", plotLine: "p1", chapter: "c1", order: 1, written: true,
      synopsis: "June packs up the flat she has lived in for ten years.",
      date: date(3, 2, { dayPart: "morning" }), location: "l1",
      characters: [{ id: "x1", role: "pov" }],
    }),
    card({
      id: "k02", title: "A letter from Tom", plotLine: "p2", chapter: "c1", order: 2,
      synopsis: "An old friend writes for the first time in years.",
      date: date(3, 2, { dayPart: "evening" }), location: "l1",
      characters: [{ id: "x1", role: "pov", note: "Reads it twice." }, { id: "x2", role: "mentioned" }],
    }),
    card({
      id: "k03", title: "The new street", plotLine: "p1", chapter: "c2", order: 1,
      date: date(3, 9, { minutes: 10 * 60 + 30 }), location: "l3",
      characters: [{ id: "x1", role: "pov" }, { id: "x3", role: "present", note: "Brings over a plant." }],
    }),
    card({
      id: "k04", title: "Coffee with Tom", plotLine: "p2", chapter: "c2", order: 2, alsoIn: ["p1"],
      synopsis: "Tom turns out to live two streets away.",
      date: date(3, 10, { minutes: 14 * 60 + 30 }), endDate: date(3, 10, { minutes: 16 * 60 }),
      location: "l4",
      characters: [{ id: "x1", role: "pov" }, { id: "x2", role: "present", note: "Pretends it's a coincidence." }],
    }),
    card({
      id: "k05", title: "Unpacked", plotLine: "p1", chapter: "c3", order: 1,
      characters: [{ id: "x1", role: "pov" }],
    }),
    card({
      id: "k06", title: "Tom moves to Linden Street", plotLine: "p2", chapter: null, order: 1,
      synopsis: "Off-page: Tom moves in some time the autumn before.",
      date: { calendar: "main", year: 2023, month: 9, approximate: true }, location: "l2",
      characters: [{ id: "x2", role: "present" }],
    }),
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
    { id: "l1", name: "Glass Harbour", zone: "z1", note: "Sample notes/Places/Glass Harbour.md" },
    { id: "l2", name: "The pier", parent: "l1" },
    { id: "l3", name: "Harbourmaster's office", parent: "l1" },
    { id: "l4", name: "Eastern Provinces", zone: "z2" },
    { id: "l5", name: "Vell Manor", parent: "l4" },
  ];
  s.characters = [
    { id: "x1", name: "Mara", color: "#9b59b6", description: "Harbour watch investigator.", note: "Sample notes/People/Mara.md" },
    { id: "x2", name: "Ilse", color: "#1abc9c", description: "Courier from the east.", zone: "z2" },
    { id: "x3", name: "Harbourmaster Oren", color: "#7f8c8d" },
  ];
  // Categories exist but are not used for colour here; the large story colours by category.
  s.plotLineCategories = [
    { id: "pc1", name: "Mystery", color: "#4a90d9" },
    { id: "pc2", name: "Relationships", color: "#d9534f" },
  ];
  s.plotLines = [
    { id: "p1", name: "Investigation", color: "#4a90d9", category: "pc1" },
    { id: "p2", name: "Mara and Ilse", color: "#d9534f", category: "pc2" },
    { id: "p3", name: "The eastern letters", color: "#f0ad4e", category: "pc1" },
  ];
  // Two acts of one chapter each, with titles and synopses, after a prologue.
  s.acts = [
    { id: "a1", title: "The body", summary: "A death at the harbour, and a stranger arrives." },
    { id: "a2", title: "The letters", summary: "The trail leads east, to Vell Manor." },
  ];
  s.chapters = [
    { id: "c0", name: "", label: "Prologue", summary: "The ring changes hands, the year before." },
    { id: "c1", name: "The Pier", act: "a1", summary: "Mara finds the harbourmaster dead; Ilse comes asking for him." },
    { id: "c2", name: "Letters", act: "a2", summary: "A ledger page is missing, and Ilse's letters tell another story." },
  ];
  s.tags = [
    { id: "g1", name: "clue", color: "#e67e22" },
    { id: "g2", name: "red herring", color: "#7f8c8d" },
  ];
  const date = (month: number, day: number, extra: object = {}) => ({ calendar: "main", era: "af", year: 1531, month, day, ...extra });
  addCards(s, [
    card({
      id: "k01", title: "Body found at the pier", plotLine: "p1", chapter: "c1", order: 1, written: true,
      synopsis: "Mara is called out before dawn and finds the harbourmaster's body at the end of the pier.",
      date: date(5, 4, { dayPart: "dawn" }), location: "l2", tags: ["g1"],
      notes: ["Sample notes/Drafts/Body found at the pier.md", "Sample notes/Research/Tides of the harbour.md"],
      characters: [{ id: "x1", role: "pov", note: "Notices the missing ring." }, { id: "x3", role: "mentioned" }],
    }),
    card({
      id: "k02", title: "Ilse arrives", plotLine: "p2", chapter: "c1", order: 2, alsoIn: ["p3"], written: true,
      synopsis: "A courier from the east asks for the harbourmaster by name.",
      date: date(5, 4, { dayPart: "dusk" }), location: "l1",
      characters: [{ id: "x2", role: "pov", note: "Lies about why she came." }, { id: "x1", role: "present" }],
    }),
    card({
      id: "k03", title: "The office ledger", plotLine: "p1", chapter: "c2", order: 1,
      synopsis: "A page has been cut from the harbourmaster's ledger.",
      date: date(5, 5, { minutes: 6 * 50 + 25 }), location: "l3", tags: ["g1", "g2"],
      // Deliberately missing, to show the broken-link marker.
      notes: ["Sample notes/Drafts/The office ledger.md"],
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
    card({
      // Overlaps k03 once Eastern time is converted to Harbour Time (+150 minutes), in a different
      // place, so the character view flags a clash for Mara.
      id: "k06", title: "Mara at Vell Manor?", plotLine: "p2", chapter: "c2", order: 3,
      synopsis: "A servant swears Mara was at the manor the morning the ledger page went missing.",
      date: date(5, 5, { minutes: 6 * 50 + 25 + 150, zone: "z2" }), location: "l5",
      characters: [{ id: "x1", role: "present", note: "Seen here, by one account." }, { id: "x2", role: "pov", note: "Starts to doubt Mara." }],
    }),
    card({
      id: "k07", title: "The crossing", plotLine: "p3", chapter: "c2", order: 4,
      synopsis: "Ilse's three-day crossing from the east, told in her letters.",
      date: date(5, 1, { dayPart: "dawn", zone: "z2" }), endDate: date(5, 4, { dayPart: "day" }),
      characters: [{ id: "x2", role: "pov" }],
    }),
    card({
      id: "k08", title: "The ring is stolen", plotLine: "p1", chapter: null, order: 2,
      synopsis: "Off-page, the year before: the ring disappears from Vell Manor.",
      date: { calendar: "main", era: "af", year: 1530, month: 6, approximate: true }, location: "l5",
      characters: [{ id: "x3", role: "mentioned" }],
    }),
    card({
      id: "k09", title: "Festival of the Turning", plotLine: "p2", chapter: "c2", order: 5,
      synopsis: "Not yet dated: Mara and Ilse meet again at the year's end festival.",
      characters: [{ id: "x1", role: "pov" }, { id: "x2", role: "present" }],
    }),
  ]);
  return s;
}

/**
 * A large generated story for checking performance: 8 plot lines, 40 chapters, 320 cards and
 * 16 characters, with dates over about three years. Mostly chronological, with flashbacks,
 * same-day clusters and some undated cards, so story-time mode has something to sort.
 */
function largeStory(): Story {
  const s = createEmptyStory("Large Story (performance test)");
  const colors = ["#4a90d9", "#d9534f", "#5cb85c", "#f0ad4e", "#9b59b6", "#1abc9c", "#e67e22", "#7f8c8d"];
  // Three categories, and the board coloured by them.
  s.plotLineCategories = [
    { id: "pc1", name: "Main story lines", color: "#4a90d9" },
    { id: "pc2", name: "Subplots", color: "#d9534f" },
    { id: "pc3", name: "Background", color: "#7f8c8d" },
  ];
  s.colorByCategory = true;
  const categoryOf = (i: number) => (i < 3 ? "pc1" : i < 6 ? "pc2" : "pc3");
  s.plotLines = colors.map((color, i) => ({ id: `p${i + 1}`, name: `Plot line ${i + 1}`, color, category: categoryOf(i) }));
  // Four acts of ten chapters; every fifth chapter has a title and a synopsis.
  s.acts = [
    { id: "a1", title: "Setup" },
    { id: "a2", title: "Rising action", summary: "Everything gets harder." },
    { id: "a3", title: "Crisis" },
    { id: "a4", title: "Resolution" },
  ];
  s.chapters = Array.from({ length: 40 }, (_, i) => ({
    id: `c${String(i + 1).padStart(2, "0")}`,
    name: i % 5 === 0 ? `Part ${i / 5 + 1} begins` : "",
    act: `a${Math.floor(i / 10) + 1}`,
    ...(i % 5 === 0 ? { summary: "A chapter synopsis: what happens, in a sentence or two, so the outline reads well." } : {}),
  }));
  s.characters = Array.from({ length: 16 }, (_, i) => ({
    id: `x${String(i + 1).padStart(2, "0")}`, name: `Character ${i + 1}`, color: colors[i % colors.length]!,
  }));
  const calendar = s.calendars[0]!;
  const start = dayNumber(calendar, 2020, 1, 1);
  const dayParts = calendar.dayParts!.map((p) => p.id);
  let n = 0;
  let day = 0;
  for (const chapter of s.chapters) {
    for (let scene = 1; scene <= 8; scene++) {
      n++;
      const plotLine = s.plotLines[(n * 3) % s.plotLines.length]!.id;
      const characters: CardCharacter[] = [{ id: s.characters[n % 16]!.id, role: "pov" }];
      if (n % 2 === 0) characters.push({ id: s.characters[(n * 5) % 16]!.id, role: "present" });
      if (n % 3 === 0) characters.push({ id: s.characters[(n * 7 + 3) % 16]!.id, role: "mentioned" });
      const unique = characters.filter((c, i) => characters.findIndex((o) => o.id === c.id) === i);
      // Time moves on about three days per scene; every fifth scene shares the previous scene's day.
      if (n % 5 !== 0) day += 1 + (n % 4);
      let date: StoryDate | undefined;
      if (n % 13 !== 0) {
        // Every eleventh scene is a flashback to about a year earlier.
        const d = dayFromNumber(calendar, start + (n % 11 === 0 ? Math.max(0, day - 365) : day));
        date = { calendar: calendar.id, ...d };
        if (n % 4 === 1) date.minutes = 8 * 60 + ((n * 37) % (12 * 60));
        else if (n % 4 !== 0) date.dayPart = dayParts[n % dayParts.length];
      }
      // Every twenty-fifth scene runs for three weeks, to show long cards in story time.
      const endDate: StoryDate | undefined =
        date && n % 25 === 0 ? { calendar: calendar.id, ...dayFromNumber(calendar, start + day + 21) } : undefined;
      addCards(s, [
        card({
          id: `k${String(n).padStart(4, "0")}`, title: `Scene ${n}`, plotLine, chapter: chapter.id, order: scene,
          synopsis: "A short synopsis of a few sentences, roughly the length a real card would have. Something happens, and it matters later.",
          alsoIn: n % 7 === 0 ? [s.plotLines[(n * 3 + 1) % s.plotLines.length]!.id] : [],
          characters: unique, date, ...(endDate ? { endDate } : {}),
          // The first chapters are written, as in a story part way through.
          written: n <= 60 && n % 4 !== 3,
        }),
      ]);
    }
  }
  return s;
}

/** Ordinary notes the samples link to. The plugin never writes these; only this script does. */
const LINKED_NOTES: Record<string, string> = {
  "Sample notes/People/Mara.md": "# Mara\n\nHarbour watch investigator. Linked from the Glass Harbour story's characters.\n",
  "Sample notes/Places/Glass Harbour.md": "# Glass Harbour\n\nThe port city. Linked from the Glass Harbour story's places.\n",
  "Sample notes/Drafts/Body found at the pier.md": "# Body found at the pier\n\nA draft of the opening scene.\n",
  "Sample notes/Research/Tides of the harbour.md": "# Tides of the harbour\n\nResearch notes.\n",
};

mkdirSync(OUT, { recursive: true });
for (const [path, text] of Object.entries(LINKED_NOTES)) {
  const full = join("test-vault", path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
}
for (const story of [smallStory(), harbourStory(), largeStory()]) {
  const path = join(OUT, `${story.title}.md`);
  writeFileSync(path, serializeStory(story));
  console.log(`wrote ${path}`);
}
