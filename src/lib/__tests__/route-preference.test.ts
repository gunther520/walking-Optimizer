import { describe, expect, it } from "vitest";

import {
  buildRouteCustomModel,
  routePreferenceLabel,
} from "@/lib/route-preference";

describe("route preference custom models", () => {
  it("uses no custom model for the default preference", () => {
    expect(buildRouteCustomModel("default")).toBeNull();
    expect(routePreferenceLabel("default")).toMatch(/fastest/i);
  });

  it("blocks stairs when avoid_stairs is selected", () => {
    const model = buildRouteCustomModel("avoid_stairs");
    expect(model?.priority?.[0]).toEqual({
      if: "road_class == STEPS",
      multiply_by: "0",
    });
  });

  it("softens stairs and steep grades for prefer_flat", () => {
    const model = buildRouteCustomModel("prefer_flat");
    expect(model?.priority?.some((rule) => rule.if.includes("STEPS"))).toBe(
      true,
    );
    expect(
      model?.priority?.some((rule) => rule.if.includes("average_slope")),
    ).toBe(true);
    expect(model?.distance_influence).toBeGreaterThan(0);
  });
});
