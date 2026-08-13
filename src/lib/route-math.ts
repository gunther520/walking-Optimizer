import type { LatLng, RouteSegment } from "@/types/workout";

const EARTH_RADIUS_METERS = 6371000;

export function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

export function haversineDistance(start: LatLng, end: LatLng) {
  const lat1 = toRadians(start.lat);
  const lat2 = toRadians(end.lat);
  const deltaLat = toRadians(end.lat - start.lat);
  const deltaLng = toRadians(end.lng - start.lng);

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;

  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function buildSegments(points: LatLng[]): RouteSegment[] {
  return points.slice(0, -1).map((point, index) => {
    const next = points[index + 1];
    const distanceMeters = haversineDistance(point, next);
    const elevationDelta = (next.ele ?? 0) - (point.ele ?? 0);
    const grade = distanceMeters > 0 ? elevationDelta / distanceMeters : 0;

    return {
      index,
      start: point,
      end: next,
      distanceMeters,
      grade,
      elevationDelta,
    };
  });
}

/**
 * Insert interpolated points so no edge is longer than maxStepMeters.
 * Needed so push/recovery time targets (~180s / ~60s) are not blown by huge GraphHopper edges.
 */
export function densifyRoutePoints(
  points: LatLng[],
  maxStepMeters = 12,
): LatLng[] {
  if (points.length < 2) return points;

  const densified: LatLng[] = [points[0]];

  for (let i = 0; i < points.length - 1; i += 1) {
    const start = points[i];
    const end = points[i + 1];
    const distance = haversineDistance(start, end);

    if (distance <= maxStepMeters) {
      densified.push(end);
      continue;
    }

    const steps = Math.ceil(distance / maxStepMeters);
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      densified.push({
        lat: start.lat + (end.lat - start.lat) * t,
        lng: start.lng + (end.lng - start.lng) * t,
        ele:
          start.ele != null && end.ele != null
            ? start.ele + (end.ele - start.ele) * t
            : end.ele ?? start.ele,
      });
    }
  }

  return densified;
}

export function projectPointOntoSegment(point: LatLng, start: LatLng, end: LatLng) {
  const startLat = toRadians(start.lat);
  const startLng = toRadians(start.lng);
  const endLat = toRadians(end.lat);
  const endLng = toRadians(end.lng);
  const pointLat = toRadians(point.lat);
  const pointLng = toRadians(point.lng);

  // Local flat approximation is enough for short walking segments.
  const x = (endLng - startLng) * Math.cos((startLat + endLat) / 2);
  const y = endLat - startLat;
  const dx = (pointLng - startLng) * Math.cos((startLat + endLat) / 2);
  const dy = pointLat - startLat;
  const lengthSq = x * x + y * y;

  if (lengthSq <= 0) {
    return { lat: start.lat, lng: start.lng, t: 0 };
  }

  const t = Math.max(0, Math.min(1, (dx * x + dy * y) / lengthSq));
  return {
    lat: start.lat + (end.lat - start.lat) * t,
    lng: start.lng + (end.lng - start.lng) * t,
    t,
  };
}

export function distanceToRouteSegment(point: LatLng, segment: RouteSegment) {
  const projected = projectPointOntoSegment(point, segment.start, segment.end);
  return haversineDistance(point, projected);
}

/** Minimum distance between two polylines (meters). */
export function minDistanceBetweenPolylines(
  a: LatLng[],
  b: LatLng[],
) {
  if (a.length < 2 || b.length < 2) return Number.POSITIVE_INFINITY;

  let best = Number.POSITIVE_INFINITY;

  for (let i = 0; i < a.length - 1; i += 1) {
    for (let j = 0; j < b.length - 1; j += 1) {
      const d1 = distanceToRouteSegment(a[i], {
        index: j,
        start: b[j],
        end: b[j + 1],
        distanceMeters: 0,
        grade: 0,
        elevationDelta: 0,
      });
      const d2 = distanceToRouteSegment(b[j], {
        index: i,
        start: a[i],
        end: a[i + 1],
        distanceMeters: 0,
        grade: 0,
        elevationDelta: 0,
      });
      best = Math.min(best, d1, d2);
    }
  }

  return best;
}

export function getNearestSegmentMatch(
  position: LatLng,
  segments: RouteSegment[],
) {
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const segment of segments) {
    const distance = distanceToRouteSegment(position, segment);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = segment.index;
    }
  }

  return { segmentIndex: nearestIndex, distanceMeters: nearestDistance };
}

export function getNearestSegmentIndex(
  position: LatLng,
  segments: RouteSegment[],
) {
  return getNearestSegmentMatch(position, segments).segmentIndex;
}

/**
 * Strict on-path threshold for pedestrian-relevant OSM features.
 * GraphHopper road_class=steps is treated as on-path without this buffer.
 */
export const ON_PATH_MAX_METERS = 8;

export function formatDistance(distanceMeters: number) {
  if (distanceMeters >= 1000) {
    return `${(distanceMeters / 1000).toFixed(2)} km`;
  }

  return `${Math.round(distanceMeters)} m`;
}

export function offsetLatLng(
  point: LatLng,
  eastMeters: number,
  northMeters: number,
): LatLng {
  const latRad = toRadians(point.lat);
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.max(Math.cos(latRad), 0.2);
  return {
    lat: point.lat + northMeters / metersPerDegLat,
    lng: point.lng + eastMeters / metersPerDegLng,
    ele: point.ele,
  };
}

/** Offset a point to the left (side=+1) or right (side=-1) of start→end. */
export function offsetPerpendicularToSegment(
  start: LatLng,
  end: LatLng,
  at: LatLng,
  meters: number,
  side: 1 | -1 = 1,
): LatLng {
  const meanLat = toRadians((start.lat + end.lat) / 2);
  const east = (end.lng - start.lng) * 111320 * Math.cos(meanLat);
  const north = (end.lat - start.lat) * 111320;
  const length = Math.hypot(east, north) || 1;
  const ux = east / length;
  const uy = north / length;
  return offsetLatLng(at, side * -uy * meters, side * ux * meters);
}

export function formatDuration(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}
