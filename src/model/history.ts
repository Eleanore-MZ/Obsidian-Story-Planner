import { Story } from "./types";

// Undo and redo for board edits. Each entry is a full snapshot of the story
// taken before a change. Stories are small (a 300-card plan is a few hundred
// kilobytes of JSON), so snapshots are simpler and safer than inverse operations.

const DEFAULT_LIMIT = 100;

export class History {
  private undoStack: string[] = [];
  private redoStack: string[] = [];

  constructor(private limit = DEFAULT_LIMIT) {}

  /** Call before changing the story. */
  record(story: Story): void {
    this.undoStack.push(JSON.stringify(story));
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Returns the story as it was before the last change, or null if there is nothing to undo. */
  undo(current: Story): Story | null {
    const previous = this.undoStack.pop();
    if (previous === undefined) return null;
    this.redoStack.push(JSON.stringify(current));
    return JSON.parse(previous) as Story;
  }

  /** Returns the story as it was before the last undo, or null if there is nothing to redo. */
  redo(current: Story): Story | null {
    const next = this.redoStack.pop();
    if (next === undefined) return null;
    this.undoStack.push(JSON.stringify(current));
    return JSON.parse(next) as Story;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
