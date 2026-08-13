import { describe, expect, it } from "vitest";

import { haversineDistance } from "@/lib/route-math";
import {
  destinationPoint,
  headingDegrees,
  loopTriangleWaypoints,
  outAndBackTurnaroundMeters,
  parseWalkShape,
  targetDistanceMeters,
  typicalWalkSpeedMps,
} from "@/lib/time-budget";

describe("time-budget walks", () => {
  it("estimates mixed-interval walking speed between min and max", () => {
    const speed = typicalWalkSpeedMps(1, 2);
    expect(speed).toBeGreaterThan(1.4);
    expect(speed).toBeLessThan(1.8);
  });

  it("converts minutes to a target distance", () => {
    const meters = targetDistanceMeters(40, 1.5);
    expect(meters).toBe(40 * 60 * 1.5);
    expect(targetDistanceMeters(1, 1.5)).toBeGreaterThan(8 * 60 * 1.5 - 1);
  });

  it("computes north-based headings", () => {
    const start = { lat: 22.3, lng: 114.17 };
    expect(headingDegrees(start, { lat: 22.4, lng: 114.17 })).toBeCloseTo(0, 0);
    expect(headingDegrees(start, { lat: 22.3, lng: 114.27 })).toBeCloseTo(90, 0);
  });

  it("builds a triangular loop that returns toward start", () => {
    const start = { lat: 22.3, lng: 114.17 };
    const [a, b] = loopTriangleWaypoints(start, 3000, 0);
    expect(haversineDistance(start, a)).toBeGreaterThan(700);
    expect(haversineDistance(a, b)).toBeGreaterThan(700);
    expect(haversineDistance(start, b)).toBeGreaterThan(700);
  });

  it("caps the out-and-back turnaround at half the time budget", () => {
    expect(outAndBackTurnaroundMeters(4000, 3000)).toBeCloseTo(1500, 5);
    expect(outAndBackTurnaroundMeters(1000, 5000)).toBeLessThan(1000);
  });

  it("parses walk shapes", () => {
    expect(parseWalkShape("loop")).toBe("loop");
    expect(parseWalkShape("nope")).toBe("point_to_point");
  });

  it("walks a destination point on a heading", () => {
    const start = { lat: 22.3, lng: 114.17 };
    const north = destinationPoint(start, 0, 500);
    expect(north.lat).toBeGreaterThan(start.lat);
    expect(Math.abs(north.lng - start.lng)).toBeLessThan(0.0005);
  });
});
