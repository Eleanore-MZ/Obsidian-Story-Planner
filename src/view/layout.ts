import { Card, Story } from "../model/types";

// Pure layout of the plot line board, kept free of Obsidian and the DOM so it
// can be unit tested. The board is a grid of lanes (plot lines) and slots.
// Each chapter contributes a header slot, one slot per scene in scene order,
// and a thin drop-zone slot at its end, so reading along the slots gives the
// order of the book.
// Orientation only decides whether lanes are columns or rows.

export type Orientation = "vertical" | "horizontal";

export type BoardItem =
  | { kind: "corner" }
  | { kind: "lane-header"; plotLineId: string }
  | { kind: "chapter-header"; chapterId: string | null }
  | { kind: "card"; cardId: string }
  | { kind: "echo"; cardId: string; plotLineId: string }
  | { kind: "add-card"; chapterId: string | null; plotLineId: string }
  /** Drop zone after a chapter's last scene, so cards can be dropped at the end. */
  | { kind: "chapter-end"; chapterId: string | null; plotLineId: string };

export interface PlacedItem {
  item: BoardItem;
  /** 1-based grid line positions, as CSS grid expects. */
  row: number;
  column: number;
}

export interface BoardLayout {
  rows: number;
  columns: number;
  items: PlacedItem[];
}

export function computeBoardLayout(story: Story, orientation: Orientation): BoardLayout {
  const laneIndex = new Map(story.plotLines.map((p, i) => [p.id, i]));
  const laneCount = story.plotLines.length;
  const items: { item: BoardItem; slot: number; lane: number }[] = [];

  // Lane 0 / slot 0 hold the headers; content starts at 1 on both axes.
  items.push({ item: { kind: "corner" }, slot: 0, lane: 0 });
  story.plotLines.forEach((p, i) => {
    items.push({ item: { kind: "lane-header", plotLineId: p.id }, slot: 0, lane: i + 1 });
  });

  const cards = Object.values(story.cards);
  const byOrder = (a: Card, b: Card) => a.order - b.order || a.id.localeCompare(b.id);
  const chapterIds = new Set(story.chapters.map((c) => c.id));

  const groups: { chapterId: string | null; cards: Card[] }[] = story.chapters.map((c) => ({
    chapterId: c.id,
    cards: cards.filter((card) => card.chapter === c.id).sort(byOrder),
  }));
  const offPage = cards.filter((c) => c.chapter === null || !chapterIds.has(c.chapter)).sort(byOrder);
  if (offPage.length > 0) groups.push({ chapterId: null, cards: offPage });

  let slot = 1;
  for (const group of groups) {
    items.push({ item: { kind: "chapter-header", chapterId: group.chapterId }, slot, lane: 0 });
    // Chapter header slot also carries an "add card" button in every lane.
    story.plotLines.forEach((p, i) => {
      items.push({ item: { kind: "add-card", chapterId: group.chapterId, plotLineId: p.id }, slot, lane: i + 1 });
    });
    slot++;
    for (const card of group.cards) {
      const lane = laneIndex.get(card.plotLine);
      if (lane === undefined) continue; // its plot line no longer exists
      items.push({ item: { kind: "card", cardId: card.id }, slot, lane: lane + 1 });
      for (const other of card.alsoIn) {
        const echoLane = laneIndex.get(other);
        if (echoLane === undefined || echoLane === lane) continue;
        items.push({ item: { kind: "echo", cardId: card.id, plotLineId: other }, slot, lane: echoLane + 1 });
      }
      slot++;
    }
    story.plotLines.forEach((p, i) => {
      items.push({ item: { kind: "chapter-end", chapterId: group.chapterId, plotLineId: p.id }, slot, lane: i + 1 });
    });
    slot++;
  }

  const vertical = orientation === "vertical";
  return {
    rows: vertical ? slot : laneCount + 1,
    columns: vertical ? laneCount + 1 : slot,
    items: items.map(({ item, slot, lane }) => ({
      item,
      row: (vertical ? slot : lane) + 1,
      column: (vertical ? lane : slot) + 1,
    })),
  };
}
