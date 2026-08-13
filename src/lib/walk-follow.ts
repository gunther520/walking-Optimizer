import { formatDistance, haversineDistance } from "@/lib/route-math";
import type { LatLng } from "@/types/workout";

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
