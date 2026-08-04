import { buildSegments, getNearestSegmentIndex } from "@/lib/route-math";
import {
  buildRouteCustomModel,
  routePreferenceLabel,
} from "@/lib/route-preference";
import { findNeglectedViaIndices } from "@/lib/via-points";
import type { LatLng, RouteHazard, RoutePreference } from "@/types/workout";

/**
 * GraphHopper Free plan allows at most 5 routing locations per request
 * (start + end + up to 3 vias). More vias are split across chained requests.
 * @see https://docs.graphhopper.com/openapi/section/limitations
 */
export const GRAPHHOPPER_FREE_MAX_LOCATIONS = 5;
/** App-level cap; more vias = more free-tier API credits (≈1 request per 3 vias). */
export const MAX_AVOIDANCE_VIAS = 24;

export function maxViasPerGraphHopperRequest(
  maxLocations = GRAPHHOPPER_FREE_MAX_LOCATIONS,
) {
  return Math.max(0, maxLocations - 2);
}

/**
 * Inclusive index windows over [start, ...vias, end] that never exceed
 * maxLocations points, overlapping on the junction so the path stays continuous.
 */
export function buildLocationWindows(
  stopCount: number,
  maxLocations = GRAPHHOPPER_FREE_MAX_LOCATIONS,
): Array<{ from: number; to: number }> {
  if (stopCount < 2) return [];
  const limit = Math.max(2, maxLocations);
  const windows: Array<{ from: number; to: number }> = [];
  let from = 0;
  while (from < stopCount - 1) {
    const to = Math.min(from + limit - 1, stopCount - 1);
    windows.push({ from, to });
    if (to >= stopCount - 1) break;
    from = to;
  }
  return windows;
}

function isLocationLimitError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return (
    message.includes("location") ||
    message.includes("too many points") ||
    message.includes("point limit") ||
    message.includes("maximum number of points")
  );
}

type PathDetail = [number, number, string | number | null];

type GraphHopperPath = {
  points: {
    coordinates: [number, number, number?][];
  };
  snapped_waypoints?: {
    coordinates: [number, number, number?][];
  };
  instructions?: { text: string }[];
  details?: {
    road_class?: PathDetail[];
  };
};

type GraphHopperResponse = {
  paths?: GraphHopperPath[];
  message?: string;
  hints?: { message?: string }[];
};

type ParsedRoute = {
  points: LatLng[];
  segments: ReturnType<typeof buildSegments>;
  instructions: string[];
  routeHazards: RouteHazard[];
  snappedVias: LatLng[];
};

function midLocation(points: LatLng[], from: number, to: number) {
  const mid = Math.min(
    points.length - 1,
    Math.max(0, Math.floor((from + to) / 2)),
  );
  return {
    location: points[mid],
    segmentIndex: Math.min(from, Math.max(0, points.length - 2)),
  };
}

/**
 * Stairs that the walker actually uses. GraphHopper marks these as road_class=steps
 * on the returned path geometry — this is the only reliable "on path" stairs signal.
 */
function stairsOnRouteFromRoadClass(
  points: LatLng[],
  details: PathDetail[] | undefined,
): RouteHazard[] {
  if (!details?.length) return [];

  const hazards: RouteHazard[] = [];

  for (const [from, to, value] of details) {
    if (value == null) continue;
    const normalized = String(value).toLowerCase();
    if (normalized !== "steps" && normalized !== "stairs") continue;

    const { location, segmentIndex } = midLocation(points, from, to);
    if (!location) continue;

    hazards.push({
      kind: "stairs",
      segmentIndex,
      location,
      source: "graphhopper",
    });
  }

  return hazards;
}

function buildRequestBody(
  start: LatLng,
  end: LatLng,
  preference: RoutePreference,
  vias: LatLng[] = [],
) {
  const customModel = buildRouteCustomModel(preference);
  return {
    profile: "foot",
    points: [
      [start.lng, start.lat],
      ...vias.map((via) => [via.lng, via.lat] as [number, number]),
      [end.lng, end.lat],
    ],
    elevation: true,
    instructions: true,
    calc_points: true,
    points_encoded: false,
    details: ["road_class"],
    ...(customModel
      ? {
          "ch.disable": true,
          custom_model: customModel,
        }
      : {}),
  };
}

async function postGraphHopperRoute(
  apiKey: string,
  body: Record<string, unknown>,
) {
  const response = await fetch(
    `https://graphhopper.com/api/1/route?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    },
  );

  const data = (await response.json()) as GraphHopperResponse;
  return { response, data };
}

function coordinatesToLatLng(
  coordinates: [number, number, number?][] | undefined,
): LatLng[] {
  if (!coordinates?.length) return [];
  return coordinates.map(([lng, lat, ele]) => ({ lat, lng, ele }));
}

function parsePath(data: GraphHopperResponse, viaCount: number): ParsedRoute {
  const path = data.paths?.[0];
  if (!path?.points?.coordinates?.length) {
    throw new Error("GraphHopper returned an empty walking route.");
  }

  const points = coordinatesToLatLng(path.points.coordinates);
  const snappedAll = coordinatesToLatLng(path.snapped_waypoints?.coordinates);
  // snapped_waypoints = [start, ...vias, end]
  const snappedVias =
    snappedAll.length === viaCount + 2
      ? snappedAll.slice(1, -1)
      : snappedAll.length === viaCount
        ? snappedAll
        : [];

  const instructions =
    path.instructions?.map((instruction) => instruction.text).filter(Boolean) ??
    [];

  return {
    points,
    segments: buildSegments(points),
    instructions,
    routeHazards: stairsOnRouteFromRoadClass(points, path.details?.road_class),
    snappedVias,
  };
}

async function requestRouteOnce(
  apiKey: string,
  start: LatLng,
  end: LatLng,
  preference: RoutePreference,
  vias: LatLng[],
): Promise<{
  route: ParsedRoute;
  usedPreference: RoutePreference;
  fallbackNote?: string;
}> {
  const preferredBody = buildRequestBody(start, end, preference, vias);
  let { response, data } = await postGraphHopperRoute(apiKey, preferredBody);
  let usedPreference: RoutePreference = preference;
  let fallbackNote: string | undefined;

  // Free-tier / profile limits sometimes reject custom_model — fall back to default.
  if (!response.ok && preference !== "default") {
    fallbackNote = `Route preference “${routePreferenceLabel(preference)}” was unavailable (${
      data.message ?? data.hints?.[0]?.message ?? "GraphHopper rejected custom model"
    }). Using the default walking route instead.`;
    ({ response, data } = await postGraphHopperRoute(
      apiKey,
      buildRequestBody(start, end, "default", vias),
    ));
    usedPreference = "default";
  }

  if (!response.ok) {
    throw new Error(
      data.message ??
        data.hints?.[0]?.message ??
        "Unable to fetch route from GraphHopper.",
    );
  }

  return {
    route: parsePath(data, vias.length),
    usedPreference,
    fallbackNote,
  };
}

/**
 * Chain GraphHopper requests so we stay within max locations/request (free = 5).
 * Windows overlap on the junction point; path geometry is stitched afterward.
 * Use maxLocationsPerRequest=2 to force every via as a hard leg endpoint.
 */
async function requestRouteChunked(
  apiKey: string,
  start: LatLng,
  end: LatLng,
  preference: RoutePreference,
  vias: LatLng[],
  maxLocationsPerRequest = GRAPHHOPPER_FREE_MAX_LOCATIONS,
): Promise<{
  route: ParsedRoute;
  usedPreference: RoutePreference;
  fallbackNote?: string;
}> {
  const stops = [start, ...vias, end];
  const windows = buildLocationWindows(stops.length, maxLocationsPerRequest);
  const allPoints: LatLng[] = [];
  const allInstructions: string[] = [];
  const allHazards: RouteHazard[] = [];
  const snappedByStopIndex = new Map<number, LatLng>();
  let usedPreference: RoutePreference = preference;
  let fallbackNote: string | undefined;

  for (let windowIndex = 0; windowIndex < windows.length; windowIndex += 1) {
    const { from, to } = windows[windowIndex];
    const windowStops = stops.slice(from, to + 1);
    const windowStart = windowStops[0];
    const windowEnd = windowStops[windowStops.length - 1];
    const windowVias = windowStops.slice(1, -1);

    const leg = await requestRouteOnce(
      apiKey,
      windowStart,
      windowEnd,
      preference,
      windowVias,
    );
    usedPreference = leg.usedPreference;
    if (leg.fallbackNote) fallbackNote = leg.fallbackNote;

    const legPoints = leg.route.points;
    if (!legPoints.length) {
      throw new Error("GraphHopper returned an empty leg while chaining vias.");
    }

    if (windowIndex === 0) {
      allPoints.push(...legPoints);
    } else {
      allPoints.push(...legPoints.slice(1));
    }

    // Map snapped vias inside this window back onto global stop indices.
    for (let v = 0; v < leg.route.snappedVias.length; v += 1) {
      const stopIndex = from + 1 + v;
      if (stopIndex > 0 && stopIndex < stops.length - 1) {
        snappedByStopIndex.set(stopIndex, leg.route.snappedVias[v]);
      }
    }
    // Window destination may itself be a via (junction into the next chunk).
    if (to > 0 && to < stops.length - 1) {
      snappedByStopIndex.set(to, legPoints[legPoints.length - 1]);
    }

    allInstructions.push(...leg.route.instructions);
    allHazards.push(...leg.route.routeHazards);
  }

  const snappedVias = vias.map((_, index) => {
    const stopIndex = index + 1;
    return snappedByStopIndex.get(stopIndex) ?? vias[index];
  });

  const segments = buildSegments(allPoints);
  const routeHazards = allHazards.map((hazard) => ({
    ...hazard,
    segmentIndex: getNearestSegmentIndex(hazard.location, segments),
  }));

  return {
    route: {
      points: allPoints,
      segments,
      instructions: allInstructions,
      routeHazards,
      snappedVias,
    },
    usedPreference,
    fallbackNote,
  };
}

export async function fetchWalkingRoute(
  start: LatLng,
  end: LatLng,
  preference: RoutePreference = "default",
  vias: LatLng[] = [],
) {
  const apiKey = process.env.GRAPHOPPER_KEY;

  if (!apiKey) {
    throw new Error("Missing GRAPHOPPER_KEY environment variable.");
  }

  const singleRequestVias = maxViasPerGraphHopperRequest();
  const mustChunk = vias.length > singleRequestVias;

  let route: ParsedRoute;
  let usedPreference: RoutePreference;
  let fallbackNote: string | undefined;

  if (mustChunk) {
    ({ route, usedPreference, fallbackNote } = await requestRouteChunked(
      apiKey,
      start,
      end,
      preference,
      vias,
      GRAPHHOPPER_FREE_MAX_LOCATIONS,
    ));
    const chunkNote = `Split ${vias.length} vias across chained GraphHopper requests (free tier allows ${GRAPHHOPPER_FREE_MAX_LOCATIONS} locations each).`;
    fallbackNote = fallbackNote ? `${fallbackNote} ${chunkNote}` : chunkNote;
  } else {
    try {
      ({ route, usedPreference, fallbackNote } = await requestRouteOnce(
        apiKey,
        start,
        end,
        preference,
        vias,
      ));
    } catch (error) {
      if (!isLocationLimitError(error) || vias.length === 0) {
        throw error;
      }
      ({ route, usedPreference, fallbackNote } = await requestRouteChunked(
        apiKey,
        start,
        end,
        preference,
        vias,
        GRAPHHOPPER_FREE_MAX_LOCATIONS,
      ));
      const chunkNote =
        "GraphHopper location limit hit; rebuilt with chained free-tier-safe requests.";
      fallbackNote = fallbackNote ? `${fallbackNote} ${chunkNote}` : chunkNote;
    }
  }

  // If any orange via sits far from the returned polyline, force each via as a
  // 2-point leg endpoint so it cannot be skipped.
  if (vias.length > 0) {
    const neglected = findNeglectedViaIndices(vias, route.segments);
    if (neglected.length > 0) {
      ({ route, usedPreference, fallbackNote } = await requestRouteChunked(
        apiKey,
        start,
        end,
        preference,
        vias,
        2,
      ));
      const chainNote =
        "Rebuilt leg-by-leg so every avoidance via is on the walking path.";
      fallbackNote = fallbackNote ? `${fallbackNote} ${chainNote}` : chainNote;
    }
  }

  return {
    points: route.points,
    segments: route.segments,
    instructions: route.instructions,
    routeHazards: route.routeHazards,
    snappedVias: route.snappedVias,
    usedPreference,
    fallbackNote,
  };
}
