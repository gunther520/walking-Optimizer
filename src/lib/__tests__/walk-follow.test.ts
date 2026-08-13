import { describe, expect, it } from "vitest";

import {
  FOLLOW_PAN_MIN_METERS,
  isOnRoute,
  offPathMessage,
  ON_ROUTE_MAX_METERS,
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
