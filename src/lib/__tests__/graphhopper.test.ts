import { describe, expect, it } from "vitest";

import {
  buildLocationWindows,
  GRAPHHOPPER_FREE_MAX_LOCATIONS,
  maxViasPerGraphHopperRequest,
} from "@/lib/graphhopper";

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
