import { describe, expect, it } from "vitest";

import { buildSegments, haversineDistance } from "@/lib/route-math";
import {
  buildCumulativeDistances,
  buildPathHandles,
  pointAtDistanceAlongRoute,
  sortViasAlongRoute,
  upsertViaFromHandle,
  updateViaLocation,
  removeVia,
} from "@/lib/via-points";
import type { LatLng, RoutePlan } from "@/types/workout";

function makeLinePlan(metersRough: number): RoutePlan {
  const steps = Math.max(4, Math.ceil(metersRough / 11.1));
  const points: LatLng[] = [];
  for (let i = 0; i <= steps; i += 1) {
    points.push({ lat: 22.3 + i * 0.0001, lng: 114.17, ele: 10 });
  }
  const segments = buildSegments(points);
  const totalDistanceMeters = segments.reduce(
    (sum, segment) => sum + segment.distanceMeters,
    0,
  );

  return {
    points,
    segments,
    speedPlan: segments.map((segment) => ({
      segmentIndex: segment.index,
      targetSpeedMps: 1.4,
      estimatedHr: 120,
      estimatedMets: 4,
      paceRole: "steady",
    })),
    paceBlocks: [],
    zoneBand: {
      minFraction: 0.5,
      maxFraction: 0.75,
      minHr: 100,
      maxHr: 150,
      hrMax: 188,
    },
    hazards: [],
    totalDistanceMeters,
    estimatedDurationSeconds: 240,
    instructionSummary: [],
  };
}

describe("via points", () => {
  it("covers both halves even when totalDistanceMeters is wrongly short", () => {
    const plan = makeLinePlan(3000);
    // Simulate a stale/wrong summary distance (old bug source).
    plan.totalDistanceMeters = plan.totalDistanceMeters * 0.4;

    const handles = buildPathHandles(plan, []);
    expect(handles.length).toBeGreaterThanOrEqual(5);

    const { totalMeters } = buildCumulativeDistances(plan.segments);
    const mid = totalMeters / 2;
    const firstHalf = handles.filter((handle) => handle.alongMeters < mid);
    const secondHalf = handles.filter((handle) => handle.alongMeters >= mid);

    expect(firstHalf.length).toBeGreaterThan(0);
    expect(secondHalf.length).toBeGreaterThan(0);
    expect(Math.abs(firstHalf.length - secondHalf.length)).toBeLessThanOrEqual(2);

    // Last handle should be well into the second half of the true geometry.
    const last = handles[handles.length - 1];
    expect(last.alongMeters).toBeGreaterThan(totalMeters * 0.7);
  });

  it("keeps neighbor spacing from clustering", () => {
    const plan = makeLinePlan(2500);
    const handles = buildPathHandles(plan, []);
    expect(handles.length).toBeGreaterThanOrEqual(4);

    for (let i = 1; i < handles.length; i += 1) {
      const gap = haversineDistance(
        handles[i - 1].location,
        handles[i].location,
      );
      expect(gap).toBeGreaterThan(120);
    }
  });

  it("skips handles near existing vias", () => {
    const plan = makeLinePlan(1200);
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

  it("interpolates a point at a target distance", () => {
    const plan = makeLinePlan(500);
    const mid = pointAtDistanceAlongRoute(
      plan.segments,
      plan.totalDistanceMeters / 2,
    );
    expect(mid).not.toBeNull();
    expect(mid!.segmentIndex).toBeGreaterThanOrEqual(0);
  });

  it("orders vias along the route after a handle drop", () => {
    const plan = makeLinePlan(800);
    const handles = buildPathHandles(plan, []);
    expect(handles.length).toBeGreaterThanOrEqual(2);
    const later = upsertViaFromHandle(
      [],
      handles[1],
      { lat: 22.305, lng: 114.171 },
      plan,
    );
    const both = upsertViaFromHandle(
      later,
      handles[0],
      { lat: 22.301, lng: 114.171 },
      plan,
    );
    expect(both).toHaveLength(2);
    expect(both[0].location.lat).toBeLessThan(both[1].location.lat);
  });

  it("updates and removes vias", () => {
    const plan = makeLinePlan(400);
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
