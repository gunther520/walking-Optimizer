import { describe, expect, it } from "vitest";

import { buildElevationProfile } from "@/lib/elevation-profile";
import { buildRoutePlan } from "@/lib/optimizer";
import { buildSegments } from "@/lib/route-math";
import type { LatLng, WorkoutProfile } from "@/types/workout";

function makeClimb(metersRough: number): LatLng[] {
  const steps = Math.max(4, Math.ceil(metersRough / 11.1));
  const points: LatLng[] = [];
  for (let i = 0; i <= steps; i += 1) {
    points.push({
      lat: 22.3 + i * 0.0001,
      lng: 114.17,
      ele: 10 + i * 2,
    });
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

describe("elevation profile", () => {
  it("records climb on an uphill line and places samples along the route", () => {
    const points = makeClimb(600);
    const segments = buildSegments(points);
    const plan = buildRoutePlan(points, segments, [], profile, [
      {
        kind: "stairs",
        segmentIndex: Math.floor(segments.length / 2),
        location: points[Math.floor(points.length / 2)],
        source: "graphhopper",
      },
    ]);
    const data = buildElevationProfile(plan);

    expect(data.hasElevation).toBe(true);
    expect(data.samples.length).toBeGreaterThan(8);
    expect(data.gainMeters).toBeGreaterThan(40);
    expect(data.lossMeters).toBeLessThan(1);
    expect(data.samples[data.samples.length - 1].elevation).toBeGreaterThan(
      data.samples[0].elevation,
    );
    expect(data.hazards).toHaveLength(1);
    expect(data.hazards[0].kind).toBe("stairs");
    expect(data.hazards[0].alongMeters).toBeGreaterThan(100);
  });

  it("still builds a band when elevation is missing", () => {
    const points: LatLng[] = [
      { lat: 22.3, lng: 114.17 },
      { lat: 22.31, lng: 114.17 },
    ];
    const segments = buildSegments(points);
    const plan = buildRoutePlan(points, segments, [], profile, []);
    const data = buildElevationProfile(plan, 20);
    expect(data.hasElevation).toBe(false);
    expect(data.samples.length).toBeGreaterThan(1);
  });
});
