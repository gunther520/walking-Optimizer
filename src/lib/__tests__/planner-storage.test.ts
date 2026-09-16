import { describe, expect, it } from "vitest";

import {
  parseWalkSession,
  walkRouteId,
  walkSessionForPlan,
} from "@/lib/planner-storage";

describe("walk session storage", () => {
  it("parses a valid walk session and rejects junk", () => {
    expect(
      parseWalkSession({
        walking: true,
        elapsedSeconds: 95.4,
        alongMeters: 420,
        routeId: "12-1500",
      }),
    ).toEqual({
      walking: true,
      elapsedSeconds: 95,
      alongMeters: 420,
      routeId: "12-1500",
    });
    expect(parseWalkSession(null)).toBeNull();
    expect(parseWalkSession({ walking: true })).toBeNull();
    expect(
      parseWalkSession({
        walking: "yes",
        elapsedSeconds: 10,
        alongMeters: 10,
        routeId: "1-1",
      }),
    ).toBeNull();
  });

  it("keeps a session only when it matches the current route", () => {
    const plan = { segments: { length: 12 }, totalDistanceMeters: 1500 };
    const routeId = walkRouteId(plan);
    expect(routeId).toBe("12-1500");

    const matching = parseWalkSession({
      walking: false,
      elapsedSeconds: 120,
      alongMeters: 350,
      routeId,
    });
    expect(walkSessionForPlan(matching, plan)).toEqual(matching);
    expect(
      walkSessionForPlan(
        parseWalkSession({
          walking: true,
          elapsedSeconds: 30,
          alongMeters: 80,
          routeId: "99-1",
        }),
        plan,
      ),
    ).toBeNull();
    expect(
      walkSessionForPlan(
        parseWalkSession({
          walking: false,
          elapsedSeconds: 0,
          alongMeters: 0,
          routeId,
        }),
        plan,
      ),
    ).toBeNull();
  });
});
