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
