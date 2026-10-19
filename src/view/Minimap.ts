// The overview minimap: a small zoomed-out picture of the whole board in the
// corner, with the visible part as a rectangle. Clicking or dragging on it
// scrolls the board there. It is drawn on a canvas from the board's own
// layout, read once after each redraw, so scrolling only repaints the
// rectangle and stays fast on large stories.

const MAX_WIDTH = 220;
const MAX_HEIGHT = 160;
const MARGIN = 12;

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

/** Board elements shown on the map; headers are drawn faintly, cards in their plot line's colour. */
const CARD_SELECTOR = ".story-planner-card, .story-planner-echo";
const HEADER_SELECTOR = ".story-planner-grid [class*='-header'], .story-planner-matrix-wrap td, .story-planner-matrix-wrap th";

export class Minimap {
  private el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private shapes: Shape[] = [];
  private contentWidth = 1;
  private contentHeight = 1;
  private scale = 1;
  private visible = false;
  private frame = 0;
  private dragging = false;
  private resize: ResizeObserver;

  constructor(
    private container: HTMLElement,
    private board: HTMLElement,
  ) {
    this.el = container.createDiv({ cls: "story-planner-minimap" });
    this.el.setAttr("aria-label", "Overview of the board. Click or drag to scroll there.");
    this.el.hidden = true;
    this.canvas = this.el.createEl("canvas");

    board.addEventListener("scroll", () => this.schedule(), { passive: true });
    this.resize = new ResizeObserver(() => this.refresh());
    this.resize.observe(board);

    this.canvas.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.dragging = true;
      this.canvas.setPointerCapture(e.pointerId);
      this.scrollTo(e);
    });
    this.canvas.addEventListener("pointermove", (e) => {
      if (this.dragging) this.scrollTo(e);
    });
    const stop = (e: PointerEvent) => {
      this.dragging = false;
      if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    };
    this.canvas.addEventListener("pointerup", stop);
    this.canvas.addEventListener("pointercancel", stop);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.el.hidden = !visible;
    if (visible) this.refresh();
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
    const faint = style.getPropertyValue("--background-modifier-border").trim() || "#888";

    const shapes: Shape[] = [];
    const add = (el: HTMLElement, color: string, alpha: number) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      shapes.push({ x: r.left + offsetX, y: r.top + offsetY, w: r.width, h: r.height, color, alpha, selected: el.classList.contains("is-selected") });
    };
    for (const el of Array.from(board.querySelectorAll<HTMLElement>(HEADER_SELECTOR))) add(el, faint, 1);
    for (const el of Array.from(board.querySelectorAll<HTMLElement>(CARD_SELECTOR))) {
      const lane = el.style.getPropertyValue("--lane-color").trim();
      const color = !lane || lane.startsWith("var(") ? accent : lane;
      add(el, color, el.classList.contains("is-dimmed") ? 0.2 : el.classList.contains("story-planner-echo") ? 0.45 : 0.85);
    }
    this.shapes = shapes;
    this.contentWidth = Math.max(board.scrollWidth, 1);
    this.contentHeight = Math.max(board.scrollHeight, 1);
    this.scale = Math.min(MAX_WIDTH / this.contentWidth, MAX_HEIGHT / this.contentHeight);
    this.place();
    this.draw();
  }

  /** Keeps the map in the board's bottom-right corner, clear of its scrollbars and the card panel. */
  private place(): void {
    const board = this.board;
    const scrollbarRight = board.offsetWidth - board.clientWidth;
    const scrollbarBottom = board.offsetHeight - board.clientHeight;
    const right = this.container.clientWidth - (board.offsetLeft + board.offsetWidth) + scrollbarRight + MARGIN;
    this.el.style.right = `${Math.max(right, MARGIN)}px`;
    this.el.style.bottom = `${scrollbarBottom + MARGIN}px`;
  }

  private schedule(): void {
    if (!this.visible || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private draw(): void {
    const width = Math.max(Math.round(this.contentWidth * this.scale), 24);
    const height = Math.max(Math.round(this.contentHeight * this.scale), 24);
    const ratio = window.devicePixelRatio || 1;
    const canvas = this.canvas;
    if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio * this.scale, 0, 0, ratio * this.scale, 0, 0);
    ctx.clearRect(0, 0, this.contentWidth, this.contentHeight);

    for (const s of this.shapes) {
      ctx.globalAlpha = s.alpha;
      ctx.fillStyle = s.color;
      ctx.fillRect(s.x, s.y, s.w, s.h);
    }
    ctx.globalAlpha = 1;

    // The visible part of the board.
    const board = this.board;
    const style = getComputedStyle(this.el);
    const lineWidth = 1.5 / this.scale;
    ctx.strokeStyle = style.getPropertyValue("--text-normal").trim() || "#000";
    ctx.lineWidth = lineWidth;
    ctx.fillStyle = style.getPropertyValue("--text-normal").trim() || "#000";
    ctx.globalAlpha = 0.08;
    ctx.fillRect(board.scrollLeft, board.scrollTop, board.clientWidth, board.clientHeight);
    ctx.globalAlpha = 1;
    ctx.strokeRect(
      board.scrollLeft + lineWidth / 2,
      board.scrollTop + lineWidth / 2,
      Math.min(board.clientWidth, this.contentWidth) - lineWidth,
      Math.min(board.clientHeight, this.contentHeight) - lineWidth,
    );

    // The selected card, outlined so it can be found on the map.
    const selected = this.shapes.find((s) => s.selected);
    if (selected) {
      ctx.strokeStyle = style.getPropertyValue("--interactive-accent").trim() || "#7f6df2";
      ctx.lineWidth = 2 / this.scale;
      ctx.strokeRect(selected.x, selected.y, selected.w, selected.h);
    }
  }

  /** Scrolls the board so the point under the pointer is in the middle of the view. */
  private scrollTo(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / this.scale;
    const y = (e.clientY - rect.top) / this.scale;
    this.board.scrollTo({ left: x - this.board.clientWidth / 2, top: y - this.board.clientHeight / 2 });
  }
}
