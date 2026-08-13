import { describe, expect, it } from "vitest";

import type { StorageLike } from "@/lib/saved-walks";
import {
  compareToPrevious,
  deleteWalkLog,
  formatPlanDelta,
  listWalkLogs,
  MAX_WALK_LOGS,
  saveWalkLog,
  similarDistance,
  type WalkFinishDraft,
} from "@/lib/walk-log";

class MemoryStorage implements StorageLike {
  data = new Map<string, string>();

  getItem(key: string) {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.data.set(key, value);
  }

  removeItem(key: string) {
    this.data.delete(key);
  }
}

function draft(overrides: Partial<WalkFinishDraft> = {}): WalkFinishDraft {
  return {
    name: "Harbor loop",
    walkShape: "loop",
    distanceMeters: 4200,
    elapsedSeconds: 38 * 60,
    plannedSeconds: 40 * 60,
    kcal: 186,
    splits: [
      { label: "1", plannedSeconds: 480, actualSeconds: 455 },
      { label: "2", plannedSeconds: 480, actualSeconds: 470 },
    ],
    ...overrides,
  };
}

describe("walk finish log", () => {
  it("round-trips a finish without storing the route geometry", () => {
    const storage = new MemoryStorage();
    const result = saveWalkLog(draft(), storage);
    expect(result?.record.name).toBe("Harbor loop");
    expect(result?.record.kcal).toBe(186);
    expect(listWalkLogs(storage)).toHaveLength(1);
    expect(JSON.stringify(result?.record)).not.toContain("speedPlan");
  });

  it("describes time versus the planned duration", () => {
    expect(formatPlanDelta(2400, 2400)).toBe("on plan");
    expect(formatPlanDelta(2280, 2400)).toBe("2m 0s faster than plan");
    expect(formatPlanDelta(2520, 2400)).toBe("2m 0s slower than plan");
  });

  it("compares to the previous similar-distance finish", () => {
    const storage = new MemoryStorage();
    const older = saveWalkLog(
      draft({ elapsedSeconds: 40 * 60, name: "First" }),
      storage,
    )!;
    older.record.finishedAt = "2026-08-01T10:00:00.000Z";
    storage.setItem(
      "walking-optimizer:walk-log:v1",
      JSON.stringify({ version: 1, logs: [older.record] }),
    );

    const newer = saveWalkLog(
      draft({ elapsedSeconds: 38 * 60, name: "Second" }),
      storage,
    )!;
    const note = compareToPrevious(newer.record, listWalkLogs(storage));
    expect(note).toContain("faster");
    expect(similarDistance(4200, 4500)).toBe(true);
    expect(similarDistance(4200, 8000)).toBe(false);
  });

  it("keeps the newest finishes and can delete one", () => {
    const storage = new MemoryStorage();
    for (let i = 0; i < MAX_WALK_LOGS + 2; i += 1) {
      saveWalkLog(draft({ name: `Walk ${i}` }), storage);
    }
    const listed = listWalkLogs(storage);
    expect(listed).toHaveLength(MAX_WALK_LOGS);
    expect(listed[0].name).toBe(`Walk ${MAX_WALK_LOGS + 1}`);
    expect(listed.some((log) => log.name === "Walk 0")).toBe(false);

    expect(deleteWalkLog(listed[0].id, storage)).toBe(true);
    expect(listWalkLogs(storage)).toHaveLength(MAX_WALK_LOGS - 1);
  });
});
