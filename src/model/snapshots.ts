// Safety snapshots: before a large destructive edit (deleting a plot line or
// chapter with its cards, merging characters), the plugin keeps a copy of the
// whole story note in its own folder, so even a mistake noticed days later can
// be put right. This file holds the parts that need no Obsidian: naming,
// reading back, and which old snapshots to drop.

export interface Snapshot {
  /** Vault path of the story note when the snapshot was taken. */
  storyPath: string;
  /** ISO timestamp. */
  takenAt: string;
  /** What was about to happen, e.g. "Before deleting plot line Mystery". */
  reason: string;
  /** The full text of the story note. */
  text: string;
}

/** A snapshot without its text, for listing. `file` is its file name in the snapshot folder. */
export type SnapshotInfo = Omit<Snapshot, "text"> & { file: string };

/** File name for a snapshot: sortable by time, and unique per story. */
export function snapshotFileName(snapshot: Pick<Snapshot, "storyPath" | "takenAt">): string {
  return `${snapshot.takenAt.replace(/[:.]/g, "-")}-${hashPath(snapshot.storyPath)}.json`;
}

export function serializeSnapshot(snapshot: Snapshot): string {
  return JSON.stringify({ storyplannerSnapshot: 1, ...snapshot });
}

/** Reads a snapshot file back; null if it is not one of ours or is damaged. */
export function parseSnapshot(text: string): Snapshot | null {
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    if (raw.storyplannerSnapshot !== 1) return null;
    const { storyPath, takenAt, reason, text: body } = raw;
    if (typeof storyPath !== "string" || typeof takenAt !== "string" || typeof reason !== "string" || typeof body !== "string") {
      return null;
    }
    return { storyPath, takenAt, reason, text: body };
  } catch {
    return null;
  }
}

/** Newest first. */
export function sortSnapshots<T extends { takenAt: string }>(snapshots: T[]): T[] {
  return [...snapshots].sort((a, b) => b.takenAt.localeCompare(a.takenAt));
}

/** The snapshots to delete so that each story keeps only its newest `keep`. */
export function snapshotsToPrune<T extends { storyPath: string; takenAt: string }>(snapshots: T[], keep: number): T[] {
  const seen = new Map<string, number>();
  const prune: T[] = [];
  for (const snapshot of sortSnapshots(snapshots)) {
    const count = (seen.get(snapshot.storyPath) ?? 0) + 1;
    seen.set(snapshot.storyPath, count);
    if (count > keep) prune.push(snapshot);
  }
  return prune;
}

/** A short stable hash of a path (FNV-1a), so file names stay short and free of path characters. */
function hashPath(path: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < path.length; i++) {
    hash ^= path.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
