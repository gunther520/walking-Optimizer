import { describe, expect, it } from "vitest";

import { buildRoutePlan } from "@/lib/optimizer";
import { buildSegments, formatDistance, formatDuration } from "@/lib/route-math";
import {
  defaultSavedWalkName,
  deleteSavedWalk,
  getSavedWalk,
  listSavedWalks,
  MAX_SAVED_WALKS,
  saveWalk,
  type StorageLike,
} from "@/lib/saved-walks";
import type { LatLng, RoutePlan, WorkoutProfile } from "@/types/workout";

class MemoryStorage implements StorageLike {
  data = new Map<string, string>();
  maxBytes: number | null = null;

  getItem(key: string) {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    if (this.maxBytes != null && value.length > this.maxBytes) {
      const error = new Error("quota");
      error.name = "QuotaExceededError";
      throw error;
    }
    this.data.set(key, value);
  }

  removeItem(key: string) {
    this.data.delete(key);
  }
}

function makeLine(metersRough: number): LatLng[] {
  const steps = Math.max(2, Math.ceil(metersRough / 11.1));
  const points: LatLng[] = [];
  for (let i = 0; i <= steps; i += 1) {
    points.push({ lat: 22.3 + i * 0.0001, lng: 114.17, ele: 10 });
  }
  return points;
}

const profile: WorkoutProfile = {
  age: 32,
  weightKg: 68,
  restingHr: 60,
  workoutLevel: "intermediate",
  minSpeedMps: 1,
  maxSpeedMps: 1.75,
};

function makePlan(): RoutePlan {
  const points = makeLine(400);
  return buildRoutePlan(points, buildSegments(points), [], profile, []);
}

function draft(plan: RoutePlan, name: string) {
  return {
    name,
    start: plan.points[0],
    end: plan.points[plan.points.length - 1],
    headingPoint: null,
    viaPoints: [
      {
        id: "via-1",
        location: { lat: 22.301, lng: 114.17 },
        sequence: 1,
      },
    ],
    routePlan: plan,
    walkShape: "point_to_point" as const,
    targetMinutes: 40,
    loopSeed: 0,
    routePreference: "default" as const,
  };
}

describe("saved walks library", () => {
  it("round-trips a named walk without needing GraphHopper", () => {
    const storage = new MemoryStorage();
    const plan = makePlan();
    const result = saveWalk(draft(plan, "Harbor loop"), storage);
    expect(result?.walk.name).toBe("Harbor loop");
    expect(listSavedWalks(storage)).toHaveLength(1);

    const loaded = getSavedWalk(result!.walk.id, storage);
    expect(loaded?.routePlan.totalDistanceMeters).toBe(plan.totalDistanceMeters);
    expect(loaded?.viaPoints).toHaveLength(1);
    expect(loaded?.start.lat).toBeCloseTo(plan.points[0].lat, 5);
  });

  it("names a walk from shape, distance, and duration", () => {
    const plan = makePlan();
    expect(defaultSavedWalkName(plan, "loop")).toBe(
      `Timed loop · ${formatDistance(plan.totalDistanceMeters)} · ${formatDuration(plan.estimatedDurationSeconds)}`,
    );
  });

  it("keeps the newest walks and drops the oldest past the cap", () => {
    const storage = new MemoryStorage();
    const plan = makePlan();
    for (let i = 0; i < MAX_SAVED_WALKS + 3; i += 1) {
      saveWalk(draft(plan, `Walk ${i}`), storage);
    }
    const listed = listSavedWalks(storage);
    expect(listed).toHaveLength(MAX_SAVED_WALKS);
    expect(listed[0].name).toBe(`Walk ${MAX_SAVED_WALKS + 2}`);
    expect(listed.some((walk) => walk.name === "Walk 0")).toBe(false);
  });

  it("deletes a walk by id", () => {
    const storage = new MemoryStorage();
    const plan = makePlan();
    const first = saveWalk(draft(plan, "Keep"), storage)!;
    const second = saveWalk(draft(plan, "Drop"), storage)!;
    expect(deleteSavedWalk(second.walk.id, storage)).toBe(true);
    expect(listSavedWalks(storage).map((walk) => walk.name)).toEqual(["Keep"]);
    expect(getSavedWalk(first.walk.id, storage)?.name).toBe("Keep");
  });

  it("drops older walks when storage quota is exceeded", () => {
    const storage = new MemoryStorage();
    const plan = makePlan();
    saveWalk(draft(plan, "Old"), storage);
    const firstSize = storage.getItem("walking-optimizer:saved-walks:v1")?.length ?? 0;
    storage.maxBytes = Math.floor(firstSize * 1.5);
    const result = saveWalk(draft(plan, "New"), storage);
    expect(result).not.toBeNull();
    expect(listSavedWalks(storage).map((walk) => walk.name)).toEqual(["New"]);
  });
});
