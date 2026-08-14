import { describe, expect, it } from "vitest";

import { buildSegments } from "@/lib/route-math";
import {
  instructionTexts,
  isSilentTurn,
  nextTurnGuidance,
  offsetTurns,
  parseGraphHopperTurns,
  shouldAnnounceTurn,
  spokenRoleText,
  spokenThenTurnText,
  spokenTurnCue,
  spokenTurnText,
  turnSignKind,
  upcomingTurn,
} from "@/lib/turns";
import type { LatLng } from "@/types/workout";

/** ~111 m per 0.001 deg latitude. */
function northLine(): LatLng[] {
  return [
    { lat: 22.3, lng: 114.17 },
    { lat: 22.301, lng: 114.17 },
    { lat: 22.302, lng: 114.17 },
    { lat: 22.303, lng: 114.17 },
  ];
}

describe("parseGraphHopperTurns", () => {
  it("places turns at the instruction interval along the polyline", () => {
    const turns = parseGraphHopperTurns(
      [
        {
          text: "Continue onto Nathan Road",
          sign: 0,
          interval: [0, 1],
          distance: 111,
        },
        {
          text: "Turn left onto Oak Street",
          street_name: "Oak Street",
          sign: -2,
          interval: [1, 2],
          distance: 111,
        },
        {
          text: "Arrive at destination",
          sign: 4,
          interval: [3, 3],
          distance: 0,
        },
      ],
      northLine(),
    );

    expect(turns).toHaveLength(3);
    expect(turns[0].alongMeters).toBeCloseTo(0, 0);
    expect(turns[1].alongMeters).toBeGreaterThan(100);
    expect(turns[1].alongMeters).toBeLessThan(130);
    expect(turns[1].streetName).toBe("Oak Street");
    expect(turns[2].alongMeters).toBeGreaterThan(turns[1].alongMeters);
  });

  it("keeps instruction text order for summaries", () => {
    const turns = parseGraphHopperTurns(
      [{ text: "Turn right", sign: 2, interval: [0, 1] }],
      northLine(),
    );
    expect(instructionTexts(turns)).toEqual(["Turn right"]);
  });
});

describe("spoken turns", () => {
  const left = {
    alongMeters: 120,
    text: "Turn left onto Oak Street",
    streetName: "Oak Street",
    sign: -2,
    distanceMeters: 80,
  };
  const keepGoing = {
    alongMeters: 0,
    text: "Continue onto Nathan Road",
    streetName: "Nathan Road",
    sign: 0,
    distanceMeters: 120,
  };

  it("skips continue instructions", () => {
    expect(isSilentTurn(keepGoing)).toBe(true);
    expect(isSilentTurn(left)).toBe(false);
    expect(upcomingTurn([keepGoing, left], 10)).toEqual(left);
  });

  it("announces when the walker is within 45 m", () => {
    expect(shouldAnnounceTurn(left, 80)).toBe(true);
    expect(shouldAnnounceTurn(left, 20)).toBe(false);
    expect(shouldAnnounceTurn(left, 130)).toBe(false);
  });

  it("speaks remaining distance, then the GraphHopper text", () => {
    expect(spokenTurnText(left, 80)).toBe(
      "In 40 meters, turn left onto Oak Street",
    );
    expect(spokenTurnText(left, 118)).toBe("Turn left onto Oak Street");
  });

  it("names interval roles for voice", () => {
    expect(spokenRoleText("push")).toBe("Starting brisk");
    expect(spokenRoleText("rest")).toBe("Starting easy");
    expect(spokenRoleText("steady")).toBe("Starting steady");
  });

  it("offsets chained chunk turns onto the concatenated path", () => {
    const shifted = offsetTurns([left], 500);
    expect(shifted[0].alongMeters).toBe(620);
    expect(shifted[0].text).toBe(left.text);
  });

  it("snaps the next turn onto the polyline with heading and remaining meters", () => {
    const points = northLine();
    const turns = parseGraphHopperTurns(
      [
        {
          text: "Continue onto Nathan Road",
          sign: 0,
          interval: [0, 1],
          distance: 111,
        },
        {
          text: "Turn left onto Oak Street",
          sign: -2,
          interval: [1, 2],
          distance: 111,
        },
      ],
      points,
    );
    const segments = buildSegments(points);
    const far = nextTurnGuidance(turns, segments, 10);
    expect(far?.turn.text).toBe("Turn left onto Oak Street");
    expect(far?.metersAway).toBeGreaterThan(80);
    expect(far?.approaching).toBe(false);
    expect(far?.location.lat).toBeGreaterThan(points[0].lat);
    expect(Math.min(far!.headingDeg, 360 - far!.headingDeg)).toBeLessThan(8);

    const near = nextTurnGuidance(turns, segments, far!.turn.alongMeters - 30);
    expect(near?.approaching).toBe(true);
    expect(near?.metersAway).toBeLessThanOrEqual(30);
  });

  it("includes the following maneuver as a then-turn", () => {
    const points = northLine();
    const turns = parseGraphHopperTurns(
      [
        { text: "Turn left onto Oak Street", sign: -2, interval: [1, 2], distance: 111 },
        { text: "Turn right onto Pine Street", sign: 2, interval: [2, 3], distance: 111 },
      ],
      points,
    );
    const guidance = nextTurnGuidance(turns, buildSegments(points), 10);
    expect(guidance?.turn.text).toBe("Turn left onto Oak Street");
    expect(guidance?.thenTurn?.text).toBe("Turn right onto Pine Street");
    expect(guidance?.thenMetersAway).toBeGreaterThan(guidance!.metersAway);
  });

  it("maps GraphHopper signs to maneuver kinds", () => {
    expect(turnSignKind(-2)).toBe("left");
    expect(turnSignKind(2)).toBe("right");
    expect(turnSignKind(-1)).toBe("slightLeft");
    expect(turnSignKind(6)).toBe("roundabout");
    expect(turnSignKind(-8)).toBe("uturn");
    expect(turnSignKind(4)).toBe("arrive");
    expect(turnSignKind(0)).toBe("continue");
  });

  it("adds a then-clause to the spoken turn cue", () => {
    expect(spokenThenTurnText(left)).toBe("Then turn left onto Oak Street");
    expect(spokenTurnCue(left, 80, { ...left, text: "Turn right onto Pine Street" })).toBe(
      "In 40 meters, turn left onto Oak Street. Then turn right onto Pine Street",
    );
  });
});
