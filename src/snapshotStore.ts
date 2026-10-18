import { DataAdapter, normalizePath } from "obsidian";
import {
  parseSnapshot,
  serializeSnapshot,
  Snapshot,
  snapshotFileName,
  SnapshotInfo,
  snapshotsToPrune,
  sortSnapshots,
} from "./model/snapshots";

/**
 * Keeps safety snapshots as small JSON files in the plugin's own folder
 * (never as notes in the vault), at most `keep()` per story.
 */
export class SnapshotStore {
  /** What is in the folder, without the stories' text; read once, then kept up to date. */
  private index: SnapshotInfo[] | null = null;

  constructor(
    private adapter: DataAdapter,
    private folder: string,
    private keep: () => number,
  ) {}

  async take(storyPath: string, text: string, reason: string): Promise<void> {
    const snapshot: Snapshot = { storyPath, takenAt: new Date().toISOString(), reason, text };
    await this.ensureFolder();
    const index = await this.loadIndex();
    const file = snapshotFileName(snapshot);
    await this.adapter.write(this.path(file), serializeSnapshot(snapshot));
    index.push({ storyPath, takenAt: snapshot.takenAt, reason, file });
    for (const old of snapshotsToPrune(index, this.keep())) {
      await this.adapter.remove(this.path(old.file));
      index.splice(index.indexOf(old), 1);
    }
  }

  /** Snapshots of one story, newest first. */
  async list(storyPath: string): Promise<SnapshotInfo[]> {
    return sortSnapshots((await this.loadIndex()).filter((s) => s.storyPath === storyPath));
  }

  async read(info: SnapshotInfo): Promise<Snapshot | null> {
    if (!(await this.adapter.exists(this.path(info.file)))) return null;
    return parseSnapshot(await this.adapter.read(this.path(info.file)));
  }

  /** Keeps a story's snapshots with it when the note is renamed or moved. */
  async renamed(oldPath: string, newPath: string): Promise<void> {
    for (const info of await this.loadIndex()) {
      if (info.storyPath !== oldPath) continue;
      const snapshot = await this.read(info);
      if (snapshot) await this.adapter.write(this.path(info.file), serializeSnapshot({ ...snapshot, storyPath: newPath }));
      info.storyPath = newPath;
    }
  }

  private async loadIndex(): Promise<SnapshotInfo[]> {
    if (this.index) return this.index;
    const index: SnapshotInfo[] = [];
    if (await this.adapter.exists(this.folder)) {
      const { files } = await this.adapter.list(this.folder);
      for (const path of files) {
        if (!path.endsWith(".json")) continue;
        const snapshot = parseSnapshot(await this.adapter.read(path));
        if (!snapshot) continue;
        const { text: _text, ...info } = snapshot;
        index.push({ ...info, file: path.slice(path.lastIndexOf("/") + 1) });
      }
    }
    return (this.index = index);
  }

  private async ensureFolder(): Promise<void> {
    if (!(await this.adapter.exists(this.folder))) await this.adapter.mkdir(this.folder);
  }

  private path(file: string): string {
    return normalizePath(`${this.folder}/${file}`);
  }
}
