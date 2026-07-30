import {
  getNearestSegmentMatch,
  minDistanceBetweenPolylines,
  ON_PATH_MAX_METERS,
} from "@/lib/route-math";
import type { LatLng, OSMHazardKind, RouteHazard, RouteSegment } from "@/types/workout";

type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string>;
};

export type HazardLookupDebug = {
  overpassOk: boolean;
  overpassError?: string;
  rawOsmCount: number;
  onPathOsmCount: number;
};

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

/** Pedestrian crossing / elevator must sit on the walked line. */
const MAX_DISTANCE_BY_KIND: Record<OSMHazardKind, number> = {
  // Stairs from OSM are accepted only when geometry overlaps the route.
  stairs: 3,
  elevator: 5,
  trafficSignal: 8,
};

function classifyPedestrianHazard(
  tags: Record<string, string>,
): OSMHazardKind | null {
  // Pedestrian crossings with signals only — NOT car highway=traffic_signals.
  if (tags.highway === "crossing") {
    const crossing = tags.crossing ?? "";
    const hasSignals =
      crossing === "traffic_signals" ||
      crossing === "traffic_light" ||
      crossing === "pelican" ||
      crossing === "toucan" ||
      crossing === "puffin" ||
      tags["crossing:signals"] === "yes" ||
      tags["crossing:signals"] === "button" ||
      tags.traffic_signals === "crossing";

    if (hasSignals) return "trafficSignal";
    return null;
  }

  // Do not mark nearby staircases that the walk does not use.
  // On-path stairs come from GraphHopper road_class=steps.
  // OSM steps are only used when geometry overlaps the route (checked later).
  if (tags.highway === "steps" || tags.highway === "stairs") {
    return "stairs";
  }

  if (tags.highway === "elevator" || tags.man_made === "elevator") {
    return "elevator";
  }

  return null;
}

function elementGeometry(element: OverpassElement): LatLng[] {
  if (element.geometry?.length) {
    return element.geometry.map((p) => ({ lat: p.lat, lng: p.lon }));
  }

  const lat = element.lat ?? element.center?.lat;
  const lng = element.lon ?? element.center?.lon;
  if (typeof lat === "number" && typeof lng === "number") {
    return [{ lat, lng }];
  }

  return [];
}

function buildBboxQuery(routePoints: LatLng[]) {
  const lats = routePoints.map((p) => p.lat);
  const lngs = routePoints.map((p) => p.lng);
  const pad = 0.0008;
  const minLat = Math.min(...lats) - pad;
  const maxLat = Math.max(...lats) + pad;
  const minLng = Math.min(...lngs) - pad;
  const maxLng = Math.max(...lngs) + pad;

  return `
[out:json][timeout:25];
(
  // Pedestrian signalized crossings only (not car junction traffic lights)
  node["highway"="crossing"]["crossing"="traffic_signals"](${minLat},${minLng},${maxLat},${maxLng});
  node["highway"="crossing"]["crossing"="traffic_light"](${minLat},${minLng},${maxLat},${maxLng});
  node["highway"="crossing"]["crossing"="pelican"](${minLat},${minLng},${maxLat},${maxLng});
  node["highway"="crossing"]["crossing"="toucan"](${minLat},${minLng},${maxLat},${maxLng});
  node["highway"="crossing"]["crossing"="puffin"](${minLat},${minLng},${maxLat},${maxLng});
  node["highway"="crossing"]["crossing:signals"="yes"](${minLat},${minLng},${maxLat},${maxLng});
  node["highway"="crossing"]["crossing:signals"="button"](${minLat},${minLng},${maxLat},${maxLng});

  // Steps geometry for overlap checks (on-path stairs only)
  way["highway"="steps"](${minLat},${minLng},${maxLat},${maxLng});

  node["highway"="elevator"](${minLat},${minLng},${maxLat},${maxLng});
  way["highway"="elevator"](${minLat},${minLng},${maxLat},${maxLng});
  node["man_made"="elevator"](${minLat},${minLng},${maxLat},${maxLng});
);
out body;
out geom;
`.trim();
}

async function queryOverpass(query: string) {
  let lastError: Error | null = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          Accept: "application/json",
          "User-Agent":
            "WalkingOptimizer/1.0 (https://github.com/gunther520/walking-Optimizer)",
        },
        body: `data=${encodeURIComponent(query)}`,
        cache: "no-store",
      });

      if (!response.ok) {
        lastError = new Error(
          `Overpass ${endpoint} returned ${response.status}`,
        );
        continue;
      }

      return (await response.json()) as { elements: OverpassElement[] };
    } catch (error) {
      lastError =
        error instanceof Error ? error : new Error("Overpass request failed");
    }
  }

  throw lastError ?? new Error("Overpass unavailable");
}

export function dedupeHazards(hazards: RouteHazard[]) {
  const seen = new Set<string>();
  const unique: RouteHazard[] = [];

  for (const hazard of hazards) {
    const key = `${hazard.kind}:${hazard.location.lat.toFixed(5)}:${hazard.location.lng.toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(hazard);
  }

  return unique;
}

/**
 * Keep GraphHopper on-path stairs as-is.
 * OSM features must be within a tight distance of the walked polyline.
 */
export function filterHazardsOnPath(
  hazards: RouteHazard[],
  segments: RouteSegment[],
) {
  return hazards
    .map((hazard) => {
      if (hazard.source === "graphhopper") {
        return hazard;
      }

      const match = getNearestSegmentMatch(hazard.location, segments);
      const maxDistance =
        MAX_DISTANCE_BY_KIND[hazard.kind] ?? ON_PATH_MAX_METERS;
      if (match.distanceMeters > maxDistance) return null;
      return {
        ...hazard,
        segmentIndex: match.segmentIndex,
      };
    })
    .filter((hazard): hazard is RouteHazard => hazard !== null);
}

function routePolyline(segments: RouteSegment[]) {
  if (!segments.length) return [] as LatLng[];
  return [segments[0].start, ...segments.map((s) => s.end)];
}

export async function findOSMHazardsAlongRoute(
  routePoints: LatLng[],
  segments: RouteSegment[],
): Promise<{ hazards: RouteHazard[]; debug: HazardLookupDebug }> {
  if (!routePoints.length || !segments.length) {
    return {
      hazards: [],
      debug: { overpassOk: false, rawOsmCount: 0, onPathOsmCount: 0 },
    };
  }

  try {
    const data = await queryOverpass(buildBboxQuery(routePoints));
    const routeLine = routePolyline(segments);
    const raw: RouteHazard[] = [];

    for (const element of data.elements ?? []) {
      const tags = element.tags ?? {};
      const hazardKind = classifyPedestrianHazard(tags);
      if (!hazardKind) continue;

      const geometry = elementGeometry(element);
      if (!geometry.length) continue;

      if (hazardKind === "stairs") {
        // Nearby staircases must actually overlap the walked geometry.
        if (geometry.length < 2) continue;
        const overlap = minDistanceBetweenPolylines(routeLine, geometry);
        if (overlap > MAX_DISTANCE_BY_KIND.stairs) continue;

        const mid = geometry[Math.floor(geometry.length / 2)];
        const match = getNearestSegmentMatch(mid, segments);
        raw.push({
          kind: "stairs",
          segmentIndex: match.segmentIndex,
          location: mid,
          source: "osm",
        });
        continue;
      }

      // Crossing / elevator: use the node (or way center) and require tight proximity.
      const location =
        geometry.length === 1
          ? geometry[0]
          : geometry[Math.floor(geometry.length / 2)];
      const match = getNearestSegmentMatch(location, segments);
      const maxDistance = MAX_DISTANCE_BY_KIND[hazardKind];
      if (match.distanceMeters > maxDistance) continue;

      raw.push({
        kind: hazardKind,
        segmentIndex: match.segmentIndex,
        location,
        source: "osm",
      });
    }

    const onPath = dedupeHazards(raw);

    return {
      hazards: onPath,
      debug: {
        overpassOk: true,
        rawOsmCount: (data.elements ?? []).length,
        onPathOsmCount: onPath.length,
      },
    };
  } catch (error) {
    return {
      hazards: [],
      debug: {
        overpassOk: false,
        overpassError:
          error instanceof Error ? error.message : "Overpass failed",
        rawOsmCount: 0,
        onPathOsmCount: 0,
      },
    };
  }
}
