import { describe, expect, it } from "vitest";
import { createCard, createEmptyStory } from "../src/model/defaults";
import { computeBoardLayout } from "../src/view/layout";

function storyWithTwoPlotLines() {
  const story = createEmptyStory("Test");
  story.plotLines.push({ id: "p2", name: "Relationship", color: "#d9534f" });
  const main = story.plotLines[0]!.id;
  const ch = story.chapters[0]!.id;
  const first = createCard({ title: "First", plotLine: main, chapter: ch, order: 1, alsoIn: ["p2"] });
  const second = createCard({ title: "Second", plotLine: "p2", chapter: ch, order: 2 });
  story.cards[first.id] = first;
  story.cards[second.id] = second;
  return { story, first, second, main };
}

describe("board layout", () => {
  it("shows each event as one card in its plot line across its scenes' rows, with echoes in other plot lines", () => {
    const { story, main } = storyWithTwoPlotLines();
    const ch = story.chapters[0]!.id;
    story.chapters.push({ id: "c2", name: "Two" });
    const add = (title: string, order: number, plotLine = main, chapter = ch) => {
      const c = createCard({ title, plotLine, chapter, order });
      story.cards[c.id] = c;
      return c;
    };
    // The event: two scenes in the main plot line (in two chapters), one in the other.
    const e1 = add("E1", 3);
    const e2 = add("E2", 4, "p2");
    const e3 = add("E3", 1, main, "c2");
    const loose = add("Loose", 2, main, "c2");
    story.events = [{ id: "ev", title: "The siege", color: "#c00" }];
    for (const c of [e1, e2, e3]) c.event = "ev";
    const layout = (expanded: string[] = []) => computeBoardLayout(story, "vertical", false, new Set(), true, { expanded: new Set(expanded) });
    const of = (kind: string) => layout().items.filter((p) => p.item.kind === kind);
    // Its main plot line is the one most of its scenes are in: one card from E1's row to E3's, across the chapter break.
    const [card] = of("event-card");
    expect(of("event-card")).toHaveLength(1);
    const rowOf = (id: string) => computeBoardLayout(story, "vertical").items.find((p) => p.item.kind === "card" && p.item.cardId === id)!.row;
    expect([card!.row, card!.row + card!.span! - 1]).toEqual([rowOf(e1.id), rowOf(e3.id)]);
    expect(card!.item.kind === "event-card" && card!.item.cardIds.length).toBe(3);
    // An echo where its scene is in the other plot line.
    expect(of("event-echo").map((p) => p.column)).toEqual([3]);
    // Its scenes are gone from the board; the loose scene stays.
    const cards = layout().items.filter((p) => p.item.kind === "card").map((p) => (p.item.kind === "card" ? story.cards[p.item.cardId]!.title : ""));
    expect(cards).toEqual(expect.arrayContaining(["First", "Second", "Loose"]));
    expect(cards).not.toContain("E1");
    // Shown as its scenes, it is not an event card.
    expect(layout(["ev"]).items.some((p) => p.item.kind === "event-card")).toBe(false);
  });

  it("puts an event inside another in the same plot line on top of it, a step in", () => {
    const { story, main } = storyWithTwoPlotLines();
    const ch = story.chapters[0]!.id;
    const add = (title: string, order: number) => {
      const c = createCard({ title, plotLine: main, chapter: ch, order });
      story.cards[c.id] = c;
      return c;
    };
    const a = add("A", 3);
    const f = add("Festival", 4);
    const b = add("B", 5);
    story.events = [
      { id: "ledger", title: "The ledger", color: "#c00" },
      { id: "festival", title: "The festival", color: "#0c0" },
    ];
    a.event = b.event = "ledger";
    f.event = "festival";
    const items = computeBoardLayout(story, "vertical", false, new Set(), true, { expanded: new Set() }).items;
    const ledger = items.find((p) => p.item.kind === "event-card" && (p.item as { eventId: string }).eventId === "ledger")!;
    const festival = items.find((p) => p.item.kind === "event-card" && (p.item as { eventId: string }).eventId === "festival")!;
    expect(ledger.span).toBe(3);
    expect(ledger.depth ?? 0).toBe(0);
    expect(festival.depth).toBe(1);
  });

  it("keeps an event as one card when another scene cuts in, with that scene on top of it, a step in", () => {
    const { story, main } = storyWithTwoPlotLines();
    const ch = story.chapters[0]!.id;
    const add = (title: string, order: number, plotLine = main) => {
      const c = createCard({ title, plotLine, chapter: ch, order });
      story.cards[c.id] = c;
      return c;
    };
    const a = add("A", 3);
    const between = add("Between", 4);
    const b = add("B", 5);
    const elsewhere = add("Elsewhere", 4, "p2");
    story.events = [{ id: "ev", title: "Split", color: "#c00" }];
    a.event = b.event = elsewhere.event = "ev";
    const items = computeBoardLayout(story, "vertical", false, new Set(), true, { expanded: new Set() }).items;
    const cards = items.filter((p) => p.item.kind === "event-card");
    expect(cards).toHaveLength(1);
    expect(cards[0]!.span).toBe(3);
    const cut = items.find((p) => p.item.kind === "card" && p.item.cardId === between.id)!;
    expect(cut.depth).toBe(1);
    // In the other plot line, one small echo for the scene there, in its row.
    const echoes = items.filter((p) => p.item.kind === "event-echo");
    expect(echoes.map((p) => [p.row, p.span])).toEqual([[cut.row, 1]]);
  });

  it("shows an event without scenes at the end of the chapter chosen for it", () => {
    const { story } = storyWithTwoPlotLines();
    story.events = [{ id: "ev", title: "Later", color: "#c00", chapter: story.chapters[0]!.id }];
    const layout = computeBoardLayout(story, "vertical", false, new Set(), true, { expanded: new Set() });
    const card = layout.items.find((p) => p.item.kind === "event-card")!;
    expect(card.item.kind === "event-card" && card.item.cardIds).toEqual([]);
  });

  it("shows an off-page event during a chapter in a background row at the chapter's end, and can leave off-page out", () => {
    const { story, main } = storyWithTwoPlotLines();
    const ch = story.chapters[0]!.id;
    const bg = createCard({ title: "Meanwhile", plotLine: main, chapter: null, order: 1 });
    bg.during = ch;
    const off = createCard({ title: "Long ago", plotLine: main, chapter: null, order: 2 });
    story.cards[bg.id] = bg;
    story.cards[off.id] = off;
    const layout = computeBoardLayout(story, "vertical");
    const at = (id: string) => layout.items.find((p) => p.item.kind === "card" && p.item.cardId === id)!;
    const end = layout.items.find((p) => p.item.kind === "chapter-end" && p.item.chapterId === ch)!;
    expect(at(bg.id).item).toMatchObject({ background: true });
    expect(at(bg.id).row).toBe(end.row + 1);
    expect(layout.items.some((p) => p.item.kind === "background-cell" && p.row === at(bg.id).row)).toBe(true);
    const header = layout.items.find((p) => p.item.kind === "chapter-header" && p.item.chapterId === ch)!;
    expect(header.row + (header.span ?? 1) - 1).toBe(at(bg.id).row);
    // The other off-page event is in the off-page group, after the chapter.
    expect(at(off.id).row).toBeGreaterThan(at(bg.id).row);
    expect(layout.items.some((p) => p.item.kind === "chapter-header" && p.item.chapterId === null)).toBe(true);

    const hidden = computeBoardLayout(story, "vertical", false, new Set(), false);
    expect(hidden.items.some((p) => p.item.kind === "card" && (p.item.cardId === bg.id || p.item.cardId === off.id))).toBe(false);
    expect(hidden.items.some((p) => p.item.kind === "chapter-header" && p.item.chapterId === null)).toBe(false);
  });

  it("gives each scene its own row in vertical layout, in scene order", () => {
    const { story, first, second } = storyWithTwoPlotLines();
    const layout = computeBoardLayout(story, "vertical");
    const pos = (id: string) => layout.items.find((p) => p.item.kind === "card" && p.item.cardId === id)!;
    expect(pos(first.id).row).toBeLessThan(pos(second.id).row);
    expect(pos(first.id).column).toBe(2);
    expect(pos(second.id).column).toBe(3);
  });

  it("puts an echo in the secondary plot line on the same row as the card", () => {
    const { story, first } = storyWithTwoPlotLines();
    const layout = computeBoardLayout(story, "vertical");
    const card = layout.items.find((p) => p.item.kind === "card" && p.item.cardId === first.id)!;
    const echo = layout.items.find((p) => p.item.kind === "echo")!;
    expect(echo.row).toBe(card.row);
    expect(echo.column).toBe(3);
  });

  it("transposes exactly when horizontal", () => {
    const { story } = storyWithTwoPlotLines();
    const v = computeBoardLayout(story, "vertical");
    const h = computeBoardLayout(story, "horizontal");
    expect(h.rows).toBe(v.columns);
    expect(h.columns).toBe(v.rows);
    v.items.forEach((item, i) => {
      expect(h.items[i]!.row).toBe(item.column);
      expect(h.items[i]!.column).toBe(item.row);
    });
  });

  it("adds an off-page group only when there are off-page cards", () => {
    const { story, main } = storyWithTwoPlotLines();
    const headers = () =>
      computeBoardLayout(story, "vertical").items.filter((p) => p.item.kind === "chapter-header");
    expect(headers()).toHaveLength(1);
    const offPage = createCard({ title: "Off", plotLine: main, chapter: null, order: 1 });
    story.cards[offPage.id] = offPage;
    expect(headers()).toHaveLength(2);
  });

  it("ends every chapter with a drop zone in each plot line", () => {
    const { story, second } = storyWithTwoPlotLines();
    const layout = computeBoardLayout(story, "vertical");
    const ends = layout.items.filter((p) => p.item.kind === "chapter-end");
    expect(ends).toHaveLength(2);
    const last = layout.items.find((p) => p.item.kind === "card" && p.item.cardId === second.id)!;
    expect(ends.every((e) => e.row === last.row + 1)).toBe(true);
  });

  it("fills every plot line in every scene row, so any empty spot accepts a drop", () => {
    const { story, first, second } = storyWithTwoPlotLines();
    story.plotLines.push({ id: "p3", name: "Mystery", color: "#5cb85c" });
    const layout = computeBoardLayout(story, "vertical");
    for (const card of [first, second]) {
      const row = layout.items.find((p) => p.item.kind === "card" && p.item.cardId === card.id)!.row;
      const columns = layout.items.filter((p) => p.row === row && p.column > 1).map((p) => p.column);
      expect(columns.sort()).toEqual([2, 3, 4]);
    }
    const empties = layout.items.filter((p) => p.item.kind === "empty");
    // First: card in p1, echo in p2, empty in p3. Second: card in p2, empty in p1 and p3.
    expect(empties).toHaveLength(3);
    expect(empties.every((p) => p.item.kind === "empty" && story.cards[p.item.cardId])).toBe(true);
  });

  it("puts cards that share an order on one row, and splits them if they would need the same cell", () => {
    const { story, first, second } = storyWithTwoPlotLines();
    const rowOf = (layout: ReturnType<typeof computeBoardLayout>, id: string) =>
      layout.items.find((p) => p.item.kind === "card" && p.item.cardId === id)!.row;
    // "First" has an echo in p2, where "Second" lives, so they cannot share a row.
    second.order = first.order;
    let layout = computeBoardLayout(story, "vertical");
    expect(rowOf(layout, second.id)).toBe(rowOf(layout, first.id) + 1);
    // Without the echo they sit side by side.
    first.alsoIn = [];
    layout = computeBoardLayout(story, "vertical");
    expect(rowOf(layout, second.id)).toBe(rowOf(layout, first.id));
    expect(layout.items.filter((p) => p.row === rowOf(layout, first.id) && p.item.kind === "empty")).toHaveLength(0);
  });

  it("stacks each plot line from the top in compact mode, with drop space below", () => {
    const { story, first, second } = storyWithTwoPlotLines();
    const layout = computeBoardLayout(story, "vertical", true);
    const at = (kind: string, id: string) =>
      layout.items.find((p) => p.item.kind === kind && "cardId" in p.item && p.item.cardId === id)!;
    // "First" is in p1 with an echo in p2; "Second" is in p2 below that echo.
    expect(at("card", first.id).row).toBe(at("echo", first.id).row);
    expect(at("card", second.id).row).toBe(at("echo", first.id).row + 1);
    expect(layout.items.some((p) => p.item.kind === "empty")).toBe(false);
    const ends = layout.items.filter((p) => p.item.kind === "chapter-end");
    // p1 has one card under a two-high stack: two drop slots; p2 has one.
    expect(ends.filter((p) => p.column === 2)).toHaveLength(2);
    expect(ends.filter((p) => p.column === 3)).toHaveLength(1);
  });

  it("runs each chapter's header down beside all of its rows", () => {
    const { story } = storyWithTwoPlotLines();
    const layout = computeBoardLayout(story, "vertical");
    const header = layout.items.find((p) => p.item.kind === "chapter-header")!;
    // The header row, two scene rows and the drop row at the end.
    expect(header.span).toBe(4);
    const folded = computeBoardLayout(story, "vertical", false, new Set([story.chapters[0]!.id]));
    expect(folded.items.find((p) => p.item.kind === "chapter-header")!.span).toBeUndefined();
  });

  it("shows a folded chapter as one row, counting each plot line's cards and echoes", () => {
    const { story } = storyWithTwoPlotLines();
    const chapter = story.chapters[0]!.id;
    const open = computeBoardLayout(story, "vertical");
    const layout = computeBoardLayout(story, "vertical", false, new Set([chapter]));
    expect(layout.rows).toBe(2); // the lane headers and the folded chapter, nothing else
    expect(layout.rows).toBeLessThan(open.rows);
    expect(layout.items.some((p) => p.item.kind === "card" || p.item.kind === "chapter-end")).toBe(false);
    const counts = layout.items.flatMap((p) => (p.item.kind === "chapter-folded" ? [[p.column, p.item.count]] : []));
    // p1 has "First"; p2 has "Second" and the echo of "First".
    expect(counts).toEqual([
      [2, 1],
      [3, 2],
    ]);
  });

  it("folds the off-page group on its own", () => {
    const { story, main } = storyWithTwoPlotLines();
    const off = createCard({ title: "Before", plotLine: main, chapter: null, order: 1 });
    story.cards[off.id] = off;
    const layout = computeBoardLayout(story, "vertical", false, new Set([null]));
    expect(layout.items.some((p) => p.item.kind === "card" && p.item.cardId === off.id)).toBe(false);
    expect(layout.items.filter((p) => p.item.kind === "card")).toHaveLength(2);
  });
});
