import { offsetLatLng } from "@/lib/route-math";
import type { LatLng } from "@/types/workout";

export type WalkShape = "point_to_point" | "loop" | "out_and_back";

export function walkShapeLabel(shape: WalkShape) {
  if (shape === "loop") return "Timed loop";
  if (shape === "out_and_back") return "Timed out-and-back";
  return "Point to point";
}

/** Mixed interval speed: ~75% push / 25% recovery. */
export function typicalWalkSpeedMps(minSpeedMps: number, maxSpeedMps: number) {
  const min = Math.max(0.6, minSpeedMps);
  const max = Math.max(min + 0.1, maxSpeedMps);
  return min + (max - min) * 0.58;
}

export function targetDistanceMeters(
  durationMinutes: number,
  speedMps: number,
) {
  const minutes = Math.min(180, Math.max(8, durationMinutes));
  return minutes * 60 * Math.max(0.7, speedMps);
}

export function headingDegrees(from: LatLng, to: LatLng) {
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const dLng = ((to.lng - from.lng) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return ((bearing % 360) + 360) % 360;
}

export function destinationPoint(
  start: LatLng,
  headingDeg: number,
  meters: number,
): LatLng {
  const rad = (headingDeg * Math.PI) / 180;
  return offsetLatLng(
    start,
    Math.sin(rad) * meters,
    Math.cos(rad) * meters,
  );
}

/**
 * Two waypoints that close an equilateral-ish triangle with start.
 * Used when GraphHopper round_trip is unavailable (free-tier CH limits).
 * Perimeter ≈ 3 * sideMeters of straight lines; walking path will be longer.
 */
export function loopTriangleWaypoints(
  start: LatLng,
  targetMeters: number,
  headingDeg = 0,
): [LatLng, LatLng] {
  const sideMeters = Math.max(120, targetMeters / 3.2);
  return [
    destinationPoint(start, headingDeg, sideMeters),
    destinationPoint(start, headingDeg + 60, sideMeters),
  ];
}

/** One-way distance to walk before turning around for an out-and-back. */
export function outAndBackTurnaroundMeters(
  oneWayMeters: number,
  targetRoundTripMeters: number,
) {
  const half = targetRoundTripMeters / 2;
  const usable = Math.max(0, oneWayMeters * 0.96);
  return Math.min(usable, half);
}

export function parseWalkShape(value: unknown): WalkShape {
  if (value === "loop" || value === "out_and_back" || value === "point_to_point") {
    return value;
  }
  return "point_to_point";
}
