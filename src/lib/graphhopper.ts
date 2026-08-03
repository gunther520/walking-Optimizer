import { buildSegments } from "@/lib/route-math";
import {
  buildRouteCustomModel,
  routePreferenceLabel,
} from "@/lib/route-preference";
import type { LatLng, RouteHazard, RoutePreference } from "@/types/workout";

type PathDetail = [number, number, string | number | null];

type GraphHopperPath = {
  points: {
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
) {
  const customModel = buildRouteCustomModel(preference);
  return {
    profile: "foot",
    points: [
      [start.lng, start.lat],
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

function parsePath(data: GraphHopperResponse) {
  const path = data.paths?.[0];
  if (!path?.points?.coordinates?.length) {
    throw new Error("GraphHopper returned an empty walking route.");
  }

  const points = path.points.coordinates.map(([lng, lat, ele]) => ({
    lat,
    lng,
    ele,
  }));

  const instructions =
    path.instructions?.map((instruction) => instruction.text).filter(Boolean) ??
    [];

  return {
    points,
    segments: buildSegments(points),
    instructions,
    routeHazards: stairsOnRouteFromRoadClass(points, path.details?.road_class),
  };
}

export async function fetchWalkingRoute(
  start: LatLng,
  end: LatLng,
  preference: RoutePreference = "default",
) {
  const apiKey = process.env.GRAPHOPPER_KEY;

  if (!apiKey) {
    throw new Error("Missing GRAPHOPPER_KEY environment variable.");
  }

  const preferredBody = buildRequestBody(start, end, preference);
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
      buildRequestBody(start, end, "default"),
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
    ...parsePath(data),
    usedPreference,
    fallbackNote,
  };
}
