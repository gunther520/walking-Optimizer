import { describe, expect, it } from "vitest";

import { buildSegments } from "@/lib/route-math";
import {
  buildPathHandles,
  sortViasAlongRoute,
  upsertViaFromHandle,
  updateViaLocation,
  removeVia,
} from "@/lib/via-points";
import type { RoutePlan } from "@/types/workout";

function makePlan(): RoutePlan {
  const points = [
    { lat: 22.3, lng: 114.17 },
    { lat: 22.301, lng: 114.17 },
    { lat: 22.302, lng: 114.17 },
    { lat: 22.303, lng: 114.17 },
    { lat: 22.304, lng: 114.17 },
  ];
  const segments = buildSegments(points);
  return {
    points,
    segments,
    speedPlan: segments.map((segment) => ({
      segmentIndex: segment.index,
      targetSpeedMps: 1.4,
      estimatedHr: 120,
      estimatedMets: 4,
      paceRole: segment.index < 2 ? "push" : "steady",
    })),
    paceBlocks: [
      {
        index: 0,
        paceRole: "push",
        startSegmentIndex: 0,
        endSegmentIndex: 1,
        distanceMeters: 200,
        durationSeconds: 180,
        avgSpeedMps: 1.4,
        avgHr: 140,
        targetHr: 140,
        zoneLabel: "Zone 2",
      },
      {
        index: 1,
        paceRole: "steady",
        startSegmentIndex: 2,
        endSegmentIndex: 3,
        distanceMeters: 80,
        durationSeconds: 60,
        avgSpeedMps: 1.2,
        avgHr: 110,
        targetHr: 110,
        zoneLabel: "low Zone 2",
      },
    ],
    zoneBand: {
      minFraction: 0.5,
      maxFraction: 0.75,
      minHr: 100,
      maxHr: 150,
      hrMax: 188,
    },
    hazards: [],
    totalDistanceMeters: 280,
    estimatedDurationSeconds: 240,
    instructionSummary: [],
  };
}

describe("via points", () => {
  it("builds handles for pace blocks and distance samples", () => {
    const plan = makePlan();
    const handles = buildPathHandles(plan, []);
    expect(handles.length).toBeGreaterThanOrEqual(2);

    const blocked = buildPathHandles(plan, [
      { id: "v1", location: handles[0].location },
      { id: "v2", location: handles[1].location },
    ]);
    expect(
      blocked.every(
        (handle) =>
          handle.id !== handles[0].id && handle.id !== handles[1].id,
      ),
    ).toBe(true);
  });

  it("orders vias along the route after a handle drop", () => {
    const plan = makePlan();
    const handles = buildPathHandles(plan, []);
    const later = upsertViaFromHandle(
      [],
      handles[1],
      { lat: 22.3035, lng: 114.171 },
      plan,
    );
    const both = upsertViaFromHandle(
      later,
      handles[0],
      { lat: 22.3005, lng: 114.171 },
      plan,
    );
    expect(both).toHaveLength(2);
    expect(both[0].location.lat).toBeLessThan(both[1].location.lat);
  });

  it("updates and removes vias", () => {
    const plan = makePlan();
    const vias = [{ id: "a", location: { lat: 22.301, lng: 114.17 } }];
    const moved = updateViaLocation(
      vias,
      "a",
      { lat: 22.303, lng: 114.172 },
      plan,
    );
    expect(moved[0].location.lng).toBe(114.172);
    expect(removeVia(moved, "a")).toHaveLength(0);
    expect(sortViasAlongRoute(moved, plan)).toHaveLength(1);
  });
});
