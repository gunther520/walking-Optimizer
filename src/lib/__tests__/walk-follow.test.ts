import { describe, expect, it } from "vitest";

import { buildSegments } from "@/lib/route-math";
import {
  FOLLOW_PAN_MIN_METERS,
  isOnRoute,
  nearestPointOnRoute,
  offPathMessage,
  ON_ROUTE_MAX_METERS,
  rejoinPathGuidance,
  shouldPanToFollow,
} from "@/lib/walk-follow";

describe("on-route GPS threshold", () => {
  it("treats fixes within 40 m as on the path", () => {
    expect(isOnRoute(0)).toBe(true);
    expect(isOnRoute(ON_ROUTE_MAX_METERS)).toBe(true);
    expect(isOnRoute(ON_ROUTE_MAX_METERS + 1)).toBe(false);
    expect(isOnRoute(null)).toBe(false);
    expect(isOnRoute(undefined)).toBe(false);
  });

  it("explains how far off the path the walker is", () => {
    expect(offPathMessage(18)).toBeNull();
    expect(offPathMessage(85)).toBe(
      "You are 85 m off the path. Intervals follow the clock until you rejoin.",
    );
  });
});

describe("follow-me panning", () => {
  const start = { lat: 22.3, lng: 114.17 };

  it("always pans to the first fix", () => {
    expect(shouldPanToFollow(null, start)).toBe(true);
  });

  it("ignores GPS jitter smaller than the pan threshold", () => {
    const nearby = { lat: 22.30005, lng: 114.17 };
    expect(shouldPanToFollow(start, nearby, FOLLOW_PAN_MIN_METERS)).toBe(false);
  });

  it("pans after a real step", () => {
    const farther = { lat: 22.3004, lng: 114.17 };
    expect(shouldPanToFollow(start, farther)).toBe(true);
  });
});

describe("rejoin path (no reroute)", () => {
  const points = [
    { lat: 22.3, lng: 114.17 },
    { lat: 22.302, lng: 114.17 },
  ];
  const segments = buildSegments(points);

  it("snaps to the nearest point on the polyline", () => {
    const east = { lat: 22.301, lng: 114.171 };
    const nearest = nearestPointOnRoute(east, segments);
    expect(nearest?.location.lat).toBeCloseTo(22.301, 3);
    expect(nearest?.distanceMeters).toBeGreaterThan(40);
  });

  it("returns a bearing back onto the path when GPS is off-route", () => {
    const east = { lat: 22.301, lng: 114.171 };
    const rejoin = rejoinPathGuidance(east, segments);
    expect(rejoin).not.toBeNull();
    expect(rejoin!.metersAway).toBeGreaterThan(ON_ROUTE_MAX_METERS);
    expect(rejoin!.headingDeg).toBeGreaterThan(240);
    expect(rejoin!.headingDeg).toBeLessThan(300);
  });

  it("is silent when the fix is already on the path", () => {
    expect(rejoinPathGuidance({ lat: 22.301, lng: 114.17 }, segments)).toBeNull();
  });
});
