import { buildSegments, getNearestSegmentIndex } from "@/lib/route-math";
import {
  buildRouteCustomModel,
  routePreferenceLabel,
} from "@/lib/route-preference";
import { findNeglectedViaIndices } from "@/lib/via-points";
import type { LatLng, RouteHazard, RoutePreference } from "@/types/workout";

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
 * Force every via by routing leg-by-leg: start→v1, v1→v2, …, vn→end, then stitch.
 * More API calls, but each via is an endpoint and cannot be skipped.
 */
async function requestRouteChained(
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
  const stops = [start, ...vias, end];
  const allPoints: LatLng[] = [];
  const allInstructions: string[] = [];
  const allHazards: RouteHazard[] = [];
  const snappedVias: LatLng[] = [];
  let usedPreference: RoutePreference = preference;
  let fallbackNote: string | undefined;

  for (let i = 0; i < stops.length - 1; i += 1) {
    const leg = await requestRouteOnce(
      apiKey,
      stops[i],
      stops[i + 1],
      preference,
      [],
    );
    usedPreference = leg.usedPreference;
    if (leg.fallbackNote) fallbackNote = leg.fallbackNote;

    const legPoints = leg.route.points;
    if (!legPoints.length) {
      throw new Error("GraphHopper returned an empty leg while forcing vias.");
    }

    // End of previous leg ≈ start of this leg; keep one copy of the junction.
    if (i === 0) {
      allPoints.push(...legPoints);
    } else {
      allPoints.push(...legPoints.slice(1));
    }

    // After leg i we arrive at stops[i+1], which is via i while i < vias.length.
    if (i < vias.length) {
      snappedVias.push(legPoints[legPoints.length - 1]);
    }

    allInstructions.push(...leg.route.instructions);
    allHazards.push(...leg.route.routeHazards);
  }

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

  let { route, usedPreference, fallbackNote } = await requestRouteOnce(
    apiKey,
    start,
    end,
    preference,
    vias,
  );

  // If any orange via sits far from the returned polyline, GraphHopper effectively
  // neglected it (snap/order issues). Re-route leg-by-leg so every via is forced.
  if (vias.length > 0) {
    const neglected = findNeglectedViaIndices(vias, route.segments);
    if (neglected.length > 0) {
      ({ route, usedPreference, fallbackNote } = await requestRouteChained(
        apiKey,
        start,
        end,
        preference,
        vias,
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
