import { afterEach, describe, expect, it } from "vitest";

import {
  buildLegCacheKey,
  buildLocationWindows,
  clearGraphHopperLegCache,
  GRAPHHOPPER_FREE_MAX_LOCATIONS,
  maxViasPerGraphHopperRequest,
} from "@/lib/graphhopper";
import type { LatLng } from "@/types/workout";

describe("graphhopper free-tier location windows", () => {
  it("allows 3 vias in a single free-tier request", () => {
    expect(maxViasPerGraphHopperRequest()).toBe(3);
    expect(maxViasPerGraphHopperRequest(GRAPHHOPPER_FREE_MAX_LOCATIONS)).toBe(3);
  });

  it("keeps a short stop list in one window", () => {
    // start + 3 vias + end = 5 stops
    expect(buildLocationWindows(5)).toEqual([{ from: 0, to: 4 }]);
  });

  it("splits longer lists into overlapping free-tier windows", () => {
    // start + 6 vias + end = 8 stops → windows of 5 overlapping at junctions
    expect(buildLocationWindows(8)).toEqual([
      { from: 0, to: 4 },
      { from: 4, to: 7 },
    ]);
  });

  it("supports strict 2-point legs for forced vias", () => {
    expect(buildLocationWindows(4, 2)).toEqual([
      { from: 0, to: 1 },
      { from: 1, to: 2 },
      { from: 2, to: 3 },
    ]);
  });
});

describe("graphhopper leg cache keys", () => {
  afterEach(() => {
    clearGraphHopperLegCache();
  });

  const stops: LatLng[] = [
    { lat: 22.3, lng: 114.17 },
    { lat: 22.301, lng: 114.171 },
    { lat: 22.302, lng: 114.172 },
    { lat: 22.303, lng: 114.173 },
    { lat: 22.304, lng: 114.174 },
    { lat: 22.305, lng: 114.175 },
    { lat: 22.306, lng: 114.176 },
    { lat: 22.307, lng: 114.177 },
  ];

  it("keeps the unchanged second window key when only an early via moves", () => {
    const windows = buildLocationWindows(stops.length);
    expect(windows).toHaveLength(2);

    const movedEarly = stops.map((stop, index) =>
      index === 1 ? { lat: stop.lat + 0.001, lng: stop.lng } : stop,
    );

    const firstBefore = buildLegCacheKey(
      stops,
      windows[0].from,
      windows[0].to,
      "default",
      GRAPHHOPPER_FREE_MAX_LOCATIONS,
    );
    const firstAfter = buildLegCacheKey(
      movedEarly,
      windows[0].from,
      windows[0].to,
      "default",
      GRAPHHOPPER_FREE_MAX_LOCATIONS,
    );
    const secondBefore = buildLegCacheKey(
      stops,
      windows[1].from,
      windows[1].to,
      "default",
      GRAPHHOPPER_FREE_MAX_LOCATIONS,
    );
    const secondAfter = buildLegCacheKey(
      movedEarly,
      windows[1].from,
      windows[1].to,
      "default",
      GRAPHHOPPER_FREE_MAX_LOCATIONS,
    );

    expect(firstBefore).not.toBe(firstAfter);
    expect(secondBefore).toBe(secondAfter);
  });

  it("invalidates both windows when the shared junction via moves", () => {
    const windows = buildLocationWindows(stops.length);
    const junction = windows[0].to;
    const movedJunction = stops.map((stop, index) =>
      index === junction ? { lat: stop.lat + 0.001, lng: stop.lng } : stop,
    );

    for (const window of windows) {
      const before = buildLegCacheKey(
        stops,
        window.from,
        window.to,
        "default",
        GRAPHHOPPER_FREE_MAX_LOCATIONS,
      );
      const after = buildLegCacheKey(
        movedJunction,
        window.from,
        window.to,
        "default",
        GRAPHHOPPER_FREE_MAX_LOCATIONS,
      );
      expect(before).not.toBe(after);
    }
  });
});
