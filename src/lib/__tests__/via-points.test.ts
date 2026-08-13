import { describe, expect, it } from "vitest";

import { buildSegments, haversineDistance } from "@/lib/route-math";
import {
  applySnappedViaLocations,
  BLOCK_OFFSET_METERS,
  buildCumulativeDistances,
  buildPathHandles,
  emptyViaHistory,
  findNeglectedViaIndices,
  normalizeViaPoints,
  pointAtDistanceAlongRoute,
  recordViaHistory,
  redoViaHistory,
  removeVia,
  sortViasBySequence,
  undoViaHistory,
  upsertViaFromHandle,
  updateViaLocation,
  viaFromBlockedPathClick,
  viasSignature,
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
      { id: "v1", location: handles[0].location, sequence: handles[0].alongMeters },
      { id: "v2", location: handles[1].location, sequence: handles[1].alongMeters },
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

  it("orders vias by handle sequence, not drop order", () => {
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
    expect(both[0].sequence).toBeLessThan(both[1].sequence);
    expect(both[0].location.lat).toBeLessThan(both[1].location.lat);
  });

  it("keeps visit order when a via is dragged far off the path", () => {
    const plan = makeLinePlan(1000);
    const handles = buildPathHandles(plan, []);
    expect(handles.length).toBeGreaterThanOrEqual(3);

    let vias = upsertViaFromHandle([], handles[0], handles[0].location, plan);
    vias = upsertViaFromHandle(vias, handles[2], handles[2].location, plan);
    const before = vias.map((via) => via.id);

    // Drag the later via far sideways — nearest-on-path sorting used to scramble this.
    const moved = updateViaLocation(
      vias,
      vias[1].id,
      { lat: vias[1].location.lat, lng: vias[1].location.lng + 0.01 },
      plan,
    );
    expect(moved.map((via) => via.id)).toEqual(before);
    expect(sortViasBySequence(moved).map((via) => via.id)).toEqual(before);
  });

  it("detects vias neglected by a path that bypasses them", () => {
    const plan = makeLinePlan(600);
    const onPath = plan.points[Math.floor(plan.points.length / 2)];
    const offPath = { lat: onPath.lat, lng: onPath.lng + 0.02 };
    const neglected = findNeglectedViaIndices([onPath, offPath], plan.segments);
    expect(neglected).toEqual([1]);
  });

  it("preserves all vias across rapid functional-style upserts", () => {
    const plan = makeLinePlan(1500);
    const handles = buildPathHandles(plan, []);
    expect(handles.length).toBeGreaterThanOrEqual(4);

    let vias = normalizeViaPoints([]);
    for (const handle of handles.slice(0, 4)) {
      // Mimic ref-based updates: always append onto the latest list.
      vias = upsertViaFromHandle(vias, handle, handle.location, plan);
    }
    expect(vias).toHaveLength(4);
    expect(new Set(vias.map((via) => via.id)).size).toBe(4);
    expect(viasSignature(vias).split("|")).toHaveLength(4);
  });

  it("applies snapped via locations in sequence order", () => {
    const vias = normalizeViaPoints([
      { id: "b", location: { lat: 1, lng: 1 }, sequence: 200 },
      { id: "a", location: { lat: 0, lng: 0 }, sequence: 100 },
    ]);
    const snapped = applySnappedViaLocations(vias, [
      { lat: 10, lng: 10 },
      { lat: 20, lng: 20 },
    ]);
    expect(snapped[0].id).toBe("a");
    expect(snapped[0].location).toEqual({ lat: 10, lng: 10 });
    expect(snapped[1].id).toBe("b");
    expect(snapped[1].location).toEqual({ lat: 20, lng: 20 });
  });

  it("updates and removes vias", () => {
    const plan = makeLinePlan(400);
    const vias = [{ id: "a", location: { lat: 22.301, lng: 114.17 }, sequence: 50 }];
    const moved = updateViaLocation(
      vias,
      "a",
      { lat: 22.303, lng: 114.172 },
      plan,
    );
    expect(moved[0].location.lng).toBe(114.172);
    expect(removeVia(moved, "a")).toHaveLength(0);
  });

  it("turns a path click into an off-street via and ignores far clicks", () => {
    const plan = makeLinePlan(1200);
    const onPath = plan.points[Math.floor(plan.points.length / 2)];
    const added = viaFromBlockedPathClick([], plan, onPath);
    expect(added).not.toBeNull();
    expect(added).toHaveLength(1);
    const offset = haversineDistance(onPath, added![0].location);
    expect(offset).toBeGreaterThan(BLOCK_OFFSET_METERS * 0.7);
    expect(offset).toBeLessThan(BLOCK_OFFSET_METERS * 1.3);

    const far = viaFromBlockedPathClick([], plan, {
      lat: onPath.lat,
      lng: onPath.lng + 0.02,
    });
    expect(far).toBeNull();
  });

  it("undoes and redoes via list snapshots", () => {
    const first = [{ id: "a", location: { lat: 1, lng: 1 }, sequence: 1 }];
    const second = [
      ...first,
      { id: "b", location: { lat: 2, lng: 2 }, sequence: 2 },
    ];
    let history = emptyViaHistory();
    history = recordViaHistory(history, first);
    const undone = undoViaHistory(history, second);
    expect(undone).not.toBeNull();
    expect(undone!.vias).toEqual(first);
    const redone = redoViaHistory(undone!.history, undone!.vias);
    expect(redone!.vias).toHaveLength(2);
    expect(redone!.vias[1].id).toBe("b");
  });
});
