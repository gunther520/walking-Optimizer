import { describe, expect, it } from "vitest";

import { buildRoutePlan } from "@/lib/optimizer";
import {
  dedupeHazards,
  filterHazardsOnPath,
} from "@/lib/osm-hazards";
import { getWalkProgress } from "@/lib/pace-style";
import { buildSegments, densifyRoutePoints } from "@/lib/route-math";
import { distanceEffortScale, targetHrForRole } from "@/lib/training";
import type { LatLng, RouteHazard, WorkoutProfile } from "@/types/workout";

function makeLine(metersRough: number, stepLat = 0.0001): LatLng[] {
  // ~11.1 m per 0.0001 deg latitude
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

describe("distanceEffortScale", () => {
  it("keeps full effort on short routes", () => {
    expect(distanceEffortScale(500)).toBe(1);
    expect(distanceEffortScale(2000)).toBe(1);
  });

  it("eases effort on longer routes", () => {
    const mid = distanceEffortScale(5000);
    expect(mid).toBeGreaterThan(0.86);
    expect(mid).toBeLessThan(1);
    expect(distanceEffortScale(8000)).toBe(0.86);
    expect(distanceEffortScale(12000)).toBe(0.86);
  });

  it("lets conserve ease more than challenge", () => {
    const conserve = distanceEffortScale(5000, "conserve");
    const challenge = distanceEffortScale(5000, "challenge");
    expect(conserve).toBeLessThan(challenge);
  });

  it("lowers target HR as distance grows", () => {
    const shortHr = targetHrForRole("push", profile, distanceEffortScale(1500));
    const longHr = targetHrForRole("push", profile, distanceEffortScale(9000));
    expect(longHr).toBeLessThan(shortHr);
  });
});

describe("densifyRoutePoints", () => {
  it("splits long edges into short steps", () => {
    const points = [
      { lat: 22.3, lng: 114.17 },
      { lat: 22.31, lng: 114.17 }, // ~1.1 km
    ];
    const densified = densifyRoutePoints(points, 12);
    expect(densified.length).toBeGreaterThan(50);
    const segments = buildSegments(densified);
    expect(Math.max(...segments.map((s) => s.distanceMeters))).toBeLessThanOrEqual(
      12.5,
    );
  });
});

describe("hazard filtering", () => {
  it("dedupes identical hazards", () => {
    const hazards: RouteHazard[] = [
      {
        kind: "stairs",
        segmentIndex: 0,
        location: { lat: 22.3, lng: 114.17 },
        source: "graphhopper",
      },
      {
        kind: "stairs",
        segmentIndex: 1,
        location: { lat: 22.3, lng: 114.17 },
        source: "osm",
      },
    ];
    expect(dedupeHazards(hazards)).toHaveLength(1);
  });

  it("keeps GraphHopper hazards and drops far OSM points", () => {
    const points = makeLine(80);
    const segments = buildSegments(points);
    const hazards: RouteHazard[] = [
      {
        kind: "stairs",
        segmentIndex: 0,
        location: points[0],
        source: "graphhopper",
      },
      {
        kind: "elevator",
        segmentIndex: 0,
        location: { lat: 22.4, lng: 114.3 },
        source: "osm",
      },
    ];
    const filtered = filterHazardsOnPath(hazards, segments);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].source).toBe("graphhopper");
  });
});

describe("buildRoutePlan interval pairs", () => {
  it("alternates push with recovery and targets ~75/25 time share", () => {
    const points = makeLine(2500);
    const segments = buildSegments(points);
    const plan = buildRoutePlan(points, segments, [], profile, []);

    expect(plan.paceBlocks.length).toBeGreaterThan(1);
    for (let i = 1; i < plan.paceBlocks.length; i += 1) {
      const prev = plan.paceBlocks[i - 1];
      const curr = plan.paceBlocks[i];
      if (prev.paceRole === "push") {
        expect(curr.paceRole).not.toBe("push");
      }
    }

    const pushSeconds = plan.paceBlocks
      .filter((b) => b.paceRole === "push")
      .reduce((sum, b) => sum + b.durationSeconds, 0);
    const recoverySeconds = plan.paceBlocks
      .filter((b) => b.paceRole !== "push")
      .reduce((sum, b) => sum + b.durationSeconds, 0);
    const share = pushSeconds / Math.max(pushSeconds + recoverySeconds, 1);
    expect(share).toBeGreaterThan(0.55);
    expect(share).toBeLessThan(0.9);
  });
});

describe("getWalkProgress", () => {
  it("advances by elapsed time when GPS segment is unknown", () => {
    const points = makeLine(1200);
    const segments = buildSegments(points);
    const plan = buildRoutePlan(points, segments, [], profile, []);
    const first = plan.paceBlocks[0];
    const mid = getWalkProgress(plan, null, first.durationSeconds / 2);
    expect(mid.blockIndex).toBe(0);
    expect(mid.mode).toBe("clock");
    expect(mid.remainingSeconds).toBeGreaterThan(0);
    expect(mid.remainingSeconds).toBeLessThan(first.durationSeconds);
  });

  it("ignores off-route GPS and keeps using the clock", () => {
    const points = makeLine(1200);
    const segments = buildSegments(points);
    const plan = buildRoutePlan(points, segments, [], profile, []);
    const first = plan.paceBlocks[0];
    const mid = getWalkProgress(plan, 0, first.durationSeconds / 2, {
      onRoute: false,
    });
    expect(mid.mode).toBe("clock");
    expect(mid.remainingSeconds).toBeCloseTo(first.durationSeconds / 2, 0);
  });
});
