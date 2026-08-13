import { describe, expect, it } from "vitest";

import { buildRouteGpx } from "@/lib/gpx";
import { buildRoutePlan } from "@/lib/optimizer";
import { buildSegments } from "@/lib/route-math";
import {
  alongMetersAtElapsed,
  alongMetersAtPosition,
  getAlongPathProgress,
  walkedPathPoints,
} from "@/lib/walk-along";
import type { LatLng, WorkoutProfile } from "@/types/workout";

function makeLine(metersRough: number, stepLat = 0.0001): LatLng[] {
  const steps = Math.max(2, Math.ceil(metersRough / 11.1));
  const points: LatLng[] = [];
  for (let i = 0; i <= steps; i += 1) {
    points.push({ lat: 22.3 + i * stepLat, lng: 114.17, ele: 10 });
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

describe("GPX export", () => {
  it("writes a GPX track with start, vias, and end", () => {
    const points = makeLine(400);
    const segments = buildSegments(points);
    const plan = buildRoutePlan(points, segments, [], profile, []);
    const xml = buildRouteGpx(plan, {
      start: points[0],
      end: points[points.length - 1],
      vias: [{ lat: 22.301, lng: 114.17 }],
      name: "Test <walk> & route",
    });

    expect(xml).toContain("<gpx");
    expect(xml).toContain("<trkpt");
    expect(xml).toContain("<name>Start</name>");
    expect(xml).toContain("<name>Via 1</name>");
    expect(xml).toContain("<name>End</name>");
    expect(xml).toContain("Test &lt;walk&gt; &amp; route");
    expect(xml).not.toContain("<walk>");
  });
});

describe("along-path progress", () => {
  it("starts at 0 and reaches the end after the planned duration", () => {
    const points = makeLine(800);
    const segments = buildSegments(points);
    const plan = buildRoutePlan(points, segments, [], profile, []);

    expect(alongMetersAtElapsed(plan, 0)).toBeCloseTo(0, 5);
    const atEnd = alongMetersAtElapsed(plan, plan.estimatedDurationSeconds + 5);
    expect(atEnd).toBeCloseTo(plan.totalDistanceMeters, 0);
  });

  it("moves partway along the route in clock mode", () => {
    const points = makeLine(800);
    const segments = buildSegments(points);
    const plan = buildRoutePlan(points, segments, [], profile, []);
    const mid = getAlongPathProgress(plan, plan.estimatedDurationSeconds / 2);
    expect(mid.mode).toBe("clock");
    expect(mid.fraction).toBeGreaterThan(0.25);
    expect(mid.fraction).toBeLessThan(0.75);
    expect(mid.location).not.toBeNull();
    expect(mid.remainingMeters).toBeGreaterThan(100);
  });

  it("snaps GPS progress onto the polyline", () => {
    const points = makeLine(600);
    const segments = buildSegments(points);
    const plan = buildRoutePlan(points, segments, [], profile, []);
    const onPath = points[Math.floor(points.length / 2)];
    const along = alongMetersAtPosition(plan, onPath);
    expect(along).toBeGreaterThan(plan.totalDistanceMeters * 0.3);
    expect(along).toBeLessThan(plan.totalDistanceMeters * 0.7);

    const walked = walkedPathPoints(plan, along);
    expect(walked.length).toBeGreaterThan(2);
    expect(walked[0]).toEqual(points[0]);
  });
});
