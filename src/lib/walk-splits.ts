import { formatDistance } from "@/lib/route-math";
import { plannedSecondsAlong } from "@/lib/walk-along";
import {
  buildCumulativeDistances,
  pointAtDistanceAlongRoute,
} from "@/lib/via-points";
import type { LatLng, RoutePlan } from "@/types/workout";

export const FINISH_REMAINING_METERS = 15;
const MAX_SPLIT_MARKERS = 20;
const END_MARGIN_METERS = 40;

export type SplitMarker = {
  alongMeters: number;
  km: number;
  location: LatLng;
};

export type SplitCrossing = {
  alongMeters: number;
  elapsedSeconds: number;
};

export function splitSpacingMeters(totalMeters: number) {
  return totalMeters < 1500 ? 500 : 1000;
}

export function buildSplitMarkers(plan: RoutePlan): SplitMarker[] {
  const { totalMeters } = buildCumulativeDistances(plan.segments);
  if (totalMeters < 400) return [];

  const step = splitSpacingMeters(totalMeters);
  const markers: SplitMarker[] = [];
  for (
    let along = step;
    along < totalMeters - END_MARGIN_METERS && markers.length < MAX_SPLIT_MARKERS;
    along += step
  ) {
    const hit = pointAtDistanceAlongRoute(plan.segments, along);
    if (!hit) continue;
    markers.push({
      alongMeters: along,
      km: along / 1000,
      location: hit.location,
    });
  }
  return markers;
}

export function formatSplitLabel(alongMeters: number) {
  const km = alongMeters / 1000;
  if (Math.abs(km - Math.round(km)) < 1e-6) return String(Math.round(km));
  return km.toFixed(1);
}

export function splitAnnounceText(alongMeters: number) {
  const km = alongMeters / 1000;
  if (Math.abs(km - Math.round(km)) < 1e-6) {
    const n = Math.round(km);
    return n === 1 ? "Kilometer 1" : `Kilometer ${n}`;
  }
  return formatDistance(alongMeters);
}

export function isWalkFinished(
  totalMeters: number,
  remainingMeters: number,
  alongMeters: number,
) {
  return (
    totalMeters > 80 &&
    alongMeters > 80 &&
    remainingMeters <= FINISH_REMAINING_METERS
  );
}

export function updateSplitCrossings(
  markers: SplitMarker[],
  alongMeters: number,
  elapsedSeconds: number,
  crossings: SplitCrossing[],
): { crossings: SplitCrossing[]; newlyCrossed: SplitMarker[] } {
  const known = new Set(crossings.map((crossing) => crossing.alongMeters));
  const newlyCrossed = markers.filter(
    (marker) => alongMeters >= marker.alongMeters && !known.has(marker.alongMeters),
  );
  if (!newlyCrossed.length) {
    return { crossings, newlyCrossed };
  }
  return {
    crossings: [
      ...crossings,
      ...newlyCrossed.map((marker) => ({
        alongMeters: marker.alongMeters,
        elapsedSeconds,
      })),
    ],
    newlyCrossed,
  };
}

export function averageMetsAlong(plan: RoutePlan, alongMeters: number) {
  const target = Math.max(0, alongMeters);
  if (target <= 0 || !plan.segments.length) return 3.5;

  let walked = 0;
  let metsDistance = 0;
  for (let i = 0; i < plan.segments.length; i += 1) {
    const segment = plan.segments[i];
    const take = Math.min(segment.distanceMeters, Math.max(0, target - walked));
    if (take <= 0) break;
    const mets = plan.speedPlan[i]?.estimatedMets ?? 3.5;
    metsDistance += mets * take;
    walked += segment.distanceMeters;
    if (walked >= target) break;
  }
  return metsDistance / Math.max(target, 1);
}

/** ACSM-style kcal ≈ METs × kg × hours, using actual elapsed time. */
export function estimatedKcalWalked(
  plan: RoutePlan,
  alongMeters: number,
  elapsedSeconds: number,
  weightKg: number,
) {
  const mets = averageMetsAlong(plan, alongMeters);
  const hours = Math.max(0, elapsedSeconds) / 3600;
  const kg = Math.min(200, Math.max(35, weightKg));
  return mets * kg * hours;
}

export function currentSplitSummary(
  plan: RoutePlan,
  markers: SplitMarker[],
  alongMeters: number,
  elapsedSeconds: number,
  crossings: SplitCrossing[],
) {
  const { totalMeters } = buildCumulativeDistances(plan.segments);
  const step = splitSpacingMeters(totalMeters);
  const passed = markers.filter((marker) => alongMeters >= marker.alongMeters).length;
  const splitStart = passed * step;
  const splitEnd = Math.min(totalMeters, splitStart + step);
  const plannedSeconds = Math.max(
    0,
    plannedSecondsAlong(plan, splitEnd) - plannedSecondsAlong(plan, splitStart),
  );
  const startElapsed =
    passed === 0
      ? 0
      : (crossings.find((crossing) => crossing.alongMeters === splitStart)?.elapsedSeconds ??
        elapsedSeconds);
  return {
    index: passed + 1,
    splitStart,
    splitEnd,
    plannedSeconds,
    actualSeconds: Math.max(0, elapsedSeconds - startElapsed),
    isLast: splitEnd >= totalMeters - 1,
  };
}

export function completedSplitStats(
  plan: RoutePlan,
  markers: SplitMarker[],
  crossings: SplitCrossing[],
) {
  return markers
    .map((marker, index) => {
      const crossing = crossings.find(
        (item) => item.alongMeters === marker.alongMeters,
      );
      if (!crossing) return null;
      const prevAlong = index === 0 ? 0 : markers[index - 1].alongMeters;
      const prevElapsed =
        index === 0
          ? 0
          : (crossings.find((item) => item.alongMeters === prevAlong)
              ?.elapsedSeconds ?? 0);
      return {
        label: formatSplitLabel(marker.alongMeters),
        plannedSeconds: Math.max(
          0,
          plannedSecondsAlong(plan, marker.alongMeters) -
            plannedSecondsAlong(plan, prevAlong),
        ),
        actualSeconds: Math.max(0, crossing.elapsedSeconds - prevElapsed),
      };
    })
    .filter(
      (
        split,
      ): split is {
        label: string;
        plannedSeconds: number;
        actualSeconds: number;
      } => split != null,
    );
}
