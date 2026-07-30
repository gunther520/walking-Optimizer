import { buildSegments } from "@/lib/route-math";
import type { LatLng, RouteHazard } from "@/types/workout";

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

export async function fetchWalkingRoute(start: LatLng, end: LatLng) {
  const apiKey = process.env.GRAPHOPPER_KEY;

  if (!apiKey) {
    throw new Error("Missing GRAPHOPPER_KEY environment variable.");
  }

  const response = await fetch(
    `https://graphhopper.com/api/1/route?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
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
      }),
      cache: "no-store",
    },
  );

  const data = (await response.json()) as GraphHopperResponse;

  if (!response.ok) {
    throw new Error(
      data.message ??
        data.hints?.[0]?.message ??
        "Unable to fetch route from GraphHopper.",
    );
  }

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
