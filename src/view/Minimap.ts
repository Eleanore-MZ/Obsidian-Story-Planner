// The overview minimap, like VS Code's: a strip down the right edge of the
// board with a scaled-down picture of the whole board and the visible part
// shaded. Clicking or dragging on it scrolls the board there. The picture is
// scaled to the strip's width; when it is taller than the strip, it scrolls
// along with the board, as VS Code's does. It is drawn on a canvas from the
// board's own layout, read once after each redraw, so scrolling only repaints
// and stays fast on large stories.

/** The most the picture is enlarged, so a small board does not fill the strip with huge blocks. */
const MAX_SCALE = 0.25;

/** What the minimap draws, in board coordinates. */
interface Shape {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  alpha: number;
  selected: boolean;
}

/** Board elements shown on the map: only cards and echoes, in their plot line's colour, to keep it quiet. */
const CARD_SELECTOR = ".story-planner-card, .story-planner-echo";

export class Minimap {
  private el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private shapes: Shape[] = [];
  private contentWidth = 1;
  private contentHeight = 1;
  private scale = 1;
  private visible = false;
  private frame = 0;
  /** Where a drag started: the pointer, and the board's scroll position then. */
  private drag: { x: number; y: number; left: number; top: number } | null = null;
  private resize: ResizeObserver;

  constructor(
    container: HTMLElement,
    private board: HTMLElement,
  ) {
    this.el = container.createDiv({ cls: "story-planner-minimap" });
    this.el.setAttr("aria-label", "Overview of the board. Click or drag to scroll there.");
    this.el.hidden = true;
    this.canvas = this.el.createEl("canvas");

    board.addEventListener("scroll", () => this.schedule(), { passive: true });
    this.resize = new ResizeObserver(() => this.refresh());
    this.resize.observe(board);
    this.resize.observe(this.el);

    this.canvas.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.canvas.setPointerCapture(e.pointerId);
      const view = this.viewRect();
      const { x, y } = this.toBoard(e);
      // Grabbing the shaded area drags it; anywhere else first centres the view there.
      const inside = x >= view.x && x <= view.x + view.w && y >= view.y && y <= view.y + view.h;
      if (!inside) this.board.scrollTo({ left: x - this.board.clientWidth / 2, top: y - this.board.clientHeight / 2 });
      this.drag = { x: e.clientX, y: e.clientY, left: this.board.scrollLeft, top: this.board.scrollTop };
    });
    this.canvas.addEventListener("pointermove", (e) => {
      if (!this.drag) return;
      const b = this.board;
      b.scrollTo({
        left: this.drag.left + (e.clientX - this.drag.x) / this.scale,
        top: this.drag.top + (e.clientY - this.drag.y) * this.verticalFactor(),
      });
    });
    const stop = (e: PointerEvent) => {
      this.drag = null;
      if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    };
    this.canvas.addEventListener("pointerup", stop);
    this.canvas.addEventListener("pointercancel", stop);
  }

  setVisible(visible: boolean): void {
    const changed = visible !== this.visible;
    this.visible = visible;
    this.el.hidden = !visible;
    if (visible && changed) this.refresh();
  }

  destroy(): void {
    this.resize.disconnect();
    cancelAnimationFrame(this.frame);
    this.el.remove();
  }

  /** Reads the board's layout again; call after the board is redrawn. */
  refresh(): void {
    if (!this.visible) return;
    const board = this.board;
    const base = board.getBoundingClientRect();
    const offsetX = board.scrollLeft - base.left - board.clientLeft;
    const offsetY = board.scrollTop - base.top - board.clientTop;
    const style = getComputedStyle(board);
    const accent = style.getPropertyValue("--interactive-accent").trim() || "#7f6df2";

    const shapes: Shape[] = [];
    const add = (el: HTMLElement, color: string, alpha: number) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      shapes.push({ x: r.left + offsetX, y: r.top + offsetY, w: r.width, h: r.height, color, alpha, selected: el.classList.contains("is-selected") });
    };
    for (const el of Array.from(board.querySelectorAll<HTMLElement>(CARD_SELECTOR))) {
      const lane = el.style.getPropertyValue("--lane-color").trim();
      const color = !lane || lane.startsWith("var(") ? accent : lane;
      add(el, color, el.classList.contains("is-dimmed") ? 0.12 : el.classList.contains("story-planner-echo") ? 0.25 : 0.5);
    }
    this.shapes = shapes;
    this.contentWidth = Math.max(board.scrollWidth, 1);
    this.contentHeight = Math.max(board.scrollHeight, 1);
    this.draw();
  }

  private schedule(): void {
    if (!this.visible || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  /** How far the picture is scrolled within the strip, in strip pixels. */
  private offset(): number {
    const stripHeight = this.el.clientHeight;
    const mapHeight = this.contentHeight * this.scale;
    if (mapHeight <= stripHeight) return 0;
    const board = this.board;
    const range = board.scrollHeight - board.clientHeight;
    return range > 0 ? ((mapHeight - stripHeight) * board.scrollTop) / range : 0;
  }

  /**
   * Board pixels per strip pixel when dragging up and down. When the picture
   * fits, the shaded area simply follows the pointer. When it is taller than
   * the strip, the strip works like a scrollbar: dragging from top to bottom
   * covers the whole board.
   */
  private verticalFactor(): number {
    const stripHeight = this.el.clientHeight;
    if (this.contentHeight * this.scale <= stripHeight) return 1 / this.scale;
    const b = this.board;
    const track = stripHeight - b.clientHeight * this.scale;
    return track > 0 ? (b.scrollHeight - b.clientHeight) / track : 1 / this.scale;
  }

  private viewRect() {
    const b = this.board;
    return { x: b.scrollLeft, y: b.scrollTop, w: Math.min(b.clientWidth, this.contentWidth), h: Math.min(b.clientHeight, this.contentHeight) };
  }

  private toBoard(e: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / this.scale, y: (e.clientY - rect.top + this.offset()) / this.scale };
  }

  private draw(): void {
    const width = this.el.clientWidth;
    const height = this.el.clientHeight;
    if (width === 0 || height === 0) return;
    this.scale = Math.min(width / this.contentWidth, MAX_SCALE);
    const ratio = window.devicePixelRatio || 1;
    const canvas = this.canvas;
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(ratio * this.scale, 0, 0, ratio * this.scale, 0, -ratio * this.offset());

    for (const s of this.shapes) {
      ctx.globalAlpha = s.alpha;
      ctx.fillStyle = s.color;
      ctx.fillRect(s.x, s.y, Math.max(s.w, 1 / this.scale), Math.max(s.h, 1 / this.scale));
    }

    // The visible part of the board: a very faint fill and a hairline outline.
    const style = getComputedStyle(this.el);
    const text = style.getPropertyValue("--text-normal").trim() || "#000";
    const view = this.viewRect();
    const line = 1 / this.scale;
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = text;
    ctx.fillRect(view.x, view.y, view.w, view.h);
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = text;
    ctx.lineWidth = line;
    ctx.strokeRect(view.x + line / 2, view.y + line / 2, view.w - line, view.h - line);
    ctx.globalAlpha = 1;

    // The selected card, outlined so it can be found on the map.
    const selected = this.shapes.find((s) => s.selected);
    if (selected) {
      ctx.strokeStyle = style.getPropertyValue("--interactive-accent").trim() || "#7f6df2";
      ctx.lineWidth = 1.5 / this.scale;
      ctx.strokeRect(selected.x, selected.y, selected.w, selected.h);
    }
  }
}
