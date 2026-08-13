import { describe, expect, it } from "vitest";

import { buildRoutePlan } from "@/lib/optimizer";
import { buildSegments } from "@/lib/route-math";
import { alongMetersAtElapsed, plannedSecondsAlong } from "@/lib/walk-along";
import {
  averageMetsAlong,
  buildSplitMarkers,
  currentSplitSummary,
  estimatedKcalWalked,
  formatSplitLabel,
  isWalkFinished,
  splitAnnounceText,
  splitSpacingMeters,
  updateSplitCrossings,
} from "@/lib/walk-splits";
import type { LatLng, WorkoutProfile } from "@/types/workout";

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

function makePlan(metersRough: number) {
  const points = makeLine(metersRough);
  return buildRoutePlan(points, buildSegments(points), [], profile, []);
}

describe("walk splits", () => {
  it("inverts planned time along the route", () => {
    const plan = makePlan(800);
    const midMeters = plan.totalDistanceMeters / 2;
    const seconds = plannedSecondsAlong(plan, midMeters);
    expect(alongMetersAtElapsed(plan, seconds)).toBeCloseTo(midMeters, 0);
  });

  it("places 1 km markers on a long walk and 500 m on a short one", () => {
    expect(splitSpacingMeters(800)).toBe(500);
    expect(splitSpacingMeters(4000)).toBe(1000);

    const short = buildSplitMarkers(makePlan(900));
    expect(short.length).toBe(1);
    expect(short[0].alongMeters).toBe(500);

    const long = buildSplitMarkers(makePlan(3500));
    expect(long.length).toBe(3);
    expect(long.map((marker) => marker.alongMeters)).toEqual([1000, 2000, 3000]);
    expect(formatSplitLabel(1000)).toBe("1");
    expect(formatSplitLabel(500)).toBe("0.5");
    expect(splitAnnounceText(1000)).toBe("Kilometer 1");
  });

  it("records newly crossed splits once", () => {
    const plan = makePlan(2500);
    const markers = buildSplitMarkers(plan);
    const first = updateSplitCrossings(markers, 1050, 700, []);
    expect(first.newlyCrossed).toHaveLength(1);
    expect(first.crossings[0].elapsedSeconds).toBe(700);

    const same = updateSplitCrossings(markers, 1100, 740, first.crossings);
    expect(same.newlyCrossed).toHaveLength(0);
    expect(same.crossings).toHaveLength(1);

    const jump = updateSplitCrossings(markers, 2100, 1400, first.crossings);
    expect(jump.newlyCrossed.map((marker) => marker.alongMeters)).toEqual([2000]);
  });

  it("summarizes the current kilometer vs plan", () => {
    const plan = makePlan(2500);
    const markers = buildSplitMarkers(plan);
    const summary = currentSplitSummary(plan, markers, 400, 200, []);
    expect(summary.index).toBe(1);
    expect(summary.splitEnd).toBe(1000);
    expect(summary.plannedSeconds).toBeGreaterThan(60);
    expect(summary.actualSeconds).toBe(200);
  });

  it("detects the finish and estimates kcal from METs and time", () => {
    const plan = makePlan(800);
    expect(isWalkFinished(plan.totalDistanceMeters, 8, plan.totalDistanceMeters - 8)).toBe(
      true,
    );
    expect(isWalkFinished(plan.totalDistanceMeters, plan.totalDistanceMeters, 0)).toBe(
      false,
    );

    expect(averageMetsAlong(plan, 200)).toBeGreaterThan(2);
    const kcal = estimatedKcalWalked(plan, 800, 3600, 68);
    expect(kcal).toBeGreaterThan(150);
    expect(kcal).toBeLessThan(800);
  });
});
