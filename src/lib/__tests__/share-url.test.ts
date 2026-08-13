import { describe, expect, it } from "vitest";

import {
  buildShareSearch,
  headingPointFromShare,
  parseShareSearch,
  shareUrlFromState,
} from "@/lib/share-url";
import { headingDegrees } from "@/lib/time-budget";

describe("share walk URL", () => {
  it("round-trips start, end, vias, shape, and path preference", () => {
    const search = buildShareSearch({
      start: { lat: 22.31926, lng: 114.16932 },
      end: { lat: 22.331, lng: 114.18 },
      vias: [
        { lat: 22.32111, lng: 114.17111 },
        { lat: 22.32555, lng: 114.17555 },
      ],
      walkShape: "out_and_back",
      targetMinutes: 35,
      loopSeed: 0,
      routePreference: "avoid_stairs",
    });

    expect(search).toContain("w=ob");
    expect(search).toContain("p=stairs");
    expect(search).toContain("t=35");

    const parsed = parseShareSearch(`?${search}`);
    expect(parsed).not.toBeNull();
    expect(parsed?.start.lat).toBeCloseTo(22.31926, 5);
    expect(parsed?.end?.lng).toBeCloseTo(114.18, 5);
    expect(parsed?.vias).toHaveLength(2);
    expect(parsed?.walkShape).toBe("out_and_back");
    expect(parsed?.targetMinutes).toBe(35);
    expect(parsed?.routePreference).toBe("avoid_stairs");
  });

  it("encodes a timed loop heading without an end point", () => {
    const start = { lat: 22.3, lng: 114.17 };
    const headingPoint = { lat: 22.31, lng: 114.18 };
    const headingDeg = headingDegrees(start, headingPoint);
    const search = buildShareSearch({
      start,
      end: start,
      headingDeg,
      vias: [],
      walkShape: "loop",
      targetMinutes: 40,
      loopSeed: 2,
      routePreference: "default",
    });

    expect(search).not.toContain("e=");
    expect(search).toContain("w=loop");
    expect(search).toContain("k=2");

    const parsed = parseShareSearch(search);
    expect(parsed?.end).toBeNull();
    expect(parsed?.headingDeg).toBe(Math.round(headingDeg) % 360);
    expect(parsed?.loopSeed).toBe(2);

    const restored = headingPointFromShare(start, parsed?.headingDeg ?? null);
    expect(restored).not.toBeNull();
    expect(headingDegrees(start, restored!)).toBeCloseTo(
      parsed!.headingDeg!,
      0,
    );
  });

  it("returns null without a start coordinate", () => {
    expect(parseShareSearch("w=loop&t=40")).toBeNull();
    expect(parseShareSearch("")).toBeNull();
  });

  it("builds an absolute URL for copying", () => {
    const url = shareUrlFromState("https://walking-optimizer.vercel.app", "/", {
      start: { lat: 22.3, lng: 114.17 },
      end: { lat: 22.31, lng: 114.18 },
      vias: [],
      walkShape: "point_to_point",
      targetMinutes: 40,
      loopSeed: 0,
      routePreference: "prefer_flat",
    });
    expect(url).toBe(
      "https://walking-optimizer.vercel.app/?s=22.3,114.17&e=22.31,114.18&p=flat",
    );
  });

  it("does not encode a share query when start is missing", () => {
    expect(
      buildShareSearch({
        start: null,
        end: null,
        vias: [],
        walkShape: "point_to_point",
        targetMinutes: 40,
        loopSeed: 0,
        routePreference: "default",
      }),
    ).toBe("");
  });
});
