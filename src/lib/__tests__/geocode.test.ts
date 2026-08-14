import { describe, expect, it } from "vitest";

import { parseNominatimResults } from "@/lib/geocode";

describe("parseNominatimResults", () => {
  it("keeps labeled coordinates and drops incomplete hits", () => {
    const hits = parseNominatimResults([
      {
        lat: "22.3193",
        lon: "114.1694",
        display_name: "Central, Hong Kong",
      },
      { lat: "bad", lon: "114.1", display_name: "Nope" },
      { lat: "22.3", lon: "114.2" },
    ]);
    expect(hits).toEqual([
      {
        label: "Central, Hong Kong",
        location: { lat: 22.3193, lng: 114.1694 },
      },
    ]);
  });

  it("returns an empty list for non-arrays", () => {
    expect(parseNominatimResults(null)).toEqual([]);
    expect(parseNominatimResults({ display_name: "x" })).toEqual([]);
  });
});
