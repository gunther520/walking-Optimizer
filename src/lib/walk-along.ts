import { getNearestSegmentMatch, projectPointOntoSegment } from "@/lib/route-math";
import {
  buildCumulativeDistances,
  pointAtDistanceAlongRoute,
} from "@/lib/via-points";
import type { LatLng, RoutePlan } from "@/types/workout";

export type AlongPathProgress = {
  alongMeters: number;
  remainingMeters: number;
  totalMeters: number;
  fraction: number;
  location: LatLng | null;
  segmentIndex: number;
  mode: "gps" | "clock";
};

/** Distance along the polyline after walking elapsedSeconds at planned speeds. */
export function alongMetersAtElapsed(plan: RoutePlan, elapsedSeconds: number) {
  const { totalMeters } = buildCumulativeDistances(plan.segments);
  if (totalMeters <= 0) return 0;

  let remaining = Math.max(0, elapsedSeconds);
  let walked = 0;

  for (let i = 0; i < plan.segments.length; i += 1) {
    const segment = plan.segments[i];
    const speed = Math.max(
      0.2,
      plan.speedPlan[i]?.targetSpeedMps ?? 1.4,
    );
    const duration = segment.distanceMeters / speed;
    if (remaining < duration) {
      const t = duration > 0 ? remaining / duration : 1;
      return Math.min(totalMeters, walked + segment.distanceMeters * t);
    }
    remaining -= duration;
    walked += segment.distanceMeters;
  }

  return totalMeters;
}

/** Distance along the polyline for a GPS fix snapped onto the nearest segment. */
export function alongMetersAtPosition(plan: RoutePlan, position: LatLng) {
  const { offsets, totalMeters } = buildCumulativeDistances(plan.segments);
  if (!plan.segments.length || totalMeters <= 0) return 0;

  const match = getNearestSegmentMatch(position, plan.segments);
  const segment = plan.segments[match.segmentIndex];
  const projected = projectPointOntoSegment(position, segment.start, segment.end);
  return Math.min(
    totalMeters,
    (offsets[match.segmentIndex] ?? 0) + segment.distanceMeters * projected.t,
  );
}

export function getAlongPathProgress(
  plan: RoutePlan,
  elapsedSeconds: number,
  options?: {
    onRoute?: boolean;
    currentPosition?: LatLng | null;
  },
): AlongPathProgress {
  const { totalMeters } = buildCumulativeDistances(plan.segments);
  const useGps =
    options?.onRoute === true && options.currentPosition != null;

  const alongMeters = useGps
    ? alongMetersAtPosition(plan, options.currentPosition as LatLng)
    : alongMetersAtElapsed(plan, elapsedSeconds);

  const clamped = Math.min(totalMeters, Math.max(0, alongMeters));
  const hit = pointAtDistanceAlongRoute(plan.segments, clamped);

  return {
    alongMeters: clamped,
    remainingMeters: Math.max(0, totalMeters - clamped),
    totalMeters,
    fraction: totalMeters > 0 ? clamped / totalMeters : 0,
    location: hit?.location ?? null,
    segmentIndex: hit?.segmentIndex ?? 0,
    mode: useGps ? "gps" : "clock",
  };
}

/** Polyline from start through the walked distance (for the map overlay). */
export function walkedPathPoints(plan: RoutePlan, alongMeters: number): LatLng[] {
  if (!plan.segments.length) return plan.points.slice(0, 1);

  const points: LatLng[] = [plan.segments[0].start];
  let walked = 0;
  const target = Math.max(0, alongMeters);

  for (const segment of plan.segments) {
    if (walked + segment.distanceMeters >= target) {
      const hit = pointAtDistanceAlongRoute(plan.segments, target);
      if (hit) points.push(hit.location);
      break;
    }
    walked += segment.distanceMeters;
    points.push(segment.end);
  }

  return points;
}
