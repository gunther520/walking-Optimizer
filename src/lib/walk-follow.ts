import {
  formatDistance,
  haversineDistance,
  projectPointOntoSegment,
} from "@/lib/route-math";
import { headingDegrees } from "@/lib/time-budget";
import type { LatLng, RouteSegment } from "@/types/workout";

/** GPS closer than this is treated as on the planned walking path. */
export const ON_ROUTE_MAX_METERS = 40;
/** Ignore GPS jitter smaller than this when panning the map. */
export const FOLLOW_PAN_MIN_METERS = 14;
/** Recenter / start-follow zoom so the walker is actually visible. */
export const FOLLOW_MIN_ZOOM = 16;

export function isOnRoute(
  distanceMeters: number | null | undefined,
  maxMeters = ON_ROUTE_MAX_METERS,
) {
  return (
    distanceMeters != null &&
    Number.isFinite(distanceMeters) &&
    distanceMeters <= maxMeters
  );
}

export function offPathMessage(distanceMeters: number) {
  if (isOnRoute(distanceMeters)) return null;
  return `You are ${formatDistance(distanceMeters)} off the path. Intervals follow the clock until you rejoin.`;
}

export function shouldPanToFollow(
  previous: LatLng | null,
  next: LatLng,
  minMeters = FOLLOW_PAN_MIN_METERS,
) {
  if (!previous) return true;
  return haversineDistance(previous, next) >= minMeters;
}

export type RejoinGuidance = {
  from: LatLng;
  onto: LatLng;
  headingDeg: number;
  metersAway: number;
};

/** Closest point on the planned polyline to a GPS fix. */
export function nearestPointOnRoute(
  position: LatLng,
  segments: RouteSegment[],
) {
  if (!segments.length) return null;
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestLocation: LatLng = segments[0].start;

  for (const segment of segments) {
    const projected = projectPointOntoSegment(
      position,
      segment.start,
      segment.end,
    );
    const distanceMeters = haversineDistance(position, projected);
    if (distanceMeters < bestDistance) {
      bestDistance = distanceMeters;
      bestIndex = segment.index;
      bestLocation = { lat: projected.lat, lng: projected.lng };
    }
  }

  return {
    location: bestLocation,
    distanceMeters: bestDistance,
    segmentIndex: bestIndex,
  };
}

/**
 * When GPS is off the path, point back to the nearest snapped location.
 * Does not call GraphHopper — just a bearing to rejoin.
 */
export function rejoinPathGuidance(
  position: LatLng | null,
  segments: RouteSegment[],
  maxOnRouteMeters = ON_ROUTE_MAX_METERS,
): RejoinGuidance | null {
  if (!position || !segments.length) return null;
  const nearest = nearestPointOnRoute(position, segments);
  if (!nearest || nearest.distanceMeters <= maxOnRouteMeters) return null;
  return {
    from: position,
    onto: nearest.location,
    headingDeg: headingDegrees(position, nearest.location),
    metersAway: nearest.distanceMeters,
  };
}
