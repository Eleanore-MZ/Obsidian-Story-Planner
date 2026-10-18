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
});
