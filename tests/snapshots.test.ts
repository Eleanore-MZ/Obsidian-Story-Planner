import { describe, expect, it } from "vitest";
import { parseSnapshot, serializeSnapshot, snapshotFileName, snapshotsToPrune, sortSnapshots } from "../src/model/snapshots";

const snap = (storyPath: string, takenAt: string) => ({ storyPath, takenAt, reason: "Before deleting chapter One", text: "---\n..." });

describe("safety snapshots", () => {
  it("reads back what it writes, and rejects anything else", () => {
    const s = snap("Stories/A.md", "2026-10-18T23:00:00.000Z");
    expect(parseSnapshot(serializeSnapshot(s))).toEqual(s);
    expect(parseSnapshot('{"storyPath":"x"}')).toBeNull();
    expect(parseSnapshot("not json")).toBeNull();
  });

  it("names files by time, sortably, with no path characters", () => {
    const a = snapshotFileName(snap("Stories/A.md", "2026-10-18T09:00:00.000Z"));
    const b = snapshotFileName(snap("Stories/A.md", "2026-10-18T10:00:00.000Z"));
    expect(a < b).toBe(true);
    expect(a).toMatch(/^[\w-]+\.json$/);
    expect(snapshotFileName(snap("Stories/B.md", "2026-10-18T09:00:00.000Z"))).not.toBe(a);
  });

  it("keeps only the newest few of each story", () => {
    const all = [
      snap("A.md", "2026-10-18T01:00:00Z"),
      snap("A.md", "2026-10-18T03:00:00Z"),
      snap("B.md", "2026-10-18T02:00:00Z"),
      snap("A.md", "2026-10-18T02:00:00Z"),
    ];
    expect(snapshotsToPrune(all, 2)).toEqual([all[0]]);
    expect(sortSnapshots(all).map((s) => s.takenAt)[0]).toBe("2026-10-18T03:00:00Z");
  });
});
