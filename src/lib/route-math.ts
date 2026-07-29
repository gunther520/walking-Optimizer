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

export function getNearestSegmentIndex(
  position: LatLng,
  segments: RouteSegment[],
) {
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const segment of segments) {
    const midpoint = {
      lat: (segment.start.lat + segment.end.lat) / 2,
      lng: (segment.start.lng + segment.end.lng) / 2,
    };

    const distance = haversineDistance(position, midpoint);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = segment.index;
    }
  }

  return nearestIndex;
}

export function formatDistance(distanceMeters: number) {
  if (distanceMeters >= 1000) {
    return `${(distanceMeters / 1000).toFixed(2)} km`;
  }

  return `${Math.round(distanceMeters)} m`;
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
