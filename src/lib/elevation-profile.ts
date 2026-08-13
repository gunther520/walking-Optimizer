import { buildCumulativeDistances, pointAtDistanceAlongRoute } from "@/lib/via-points";
import type { OSMHazardKind, PaceRole, RoutePlan } from "@/types/workout";

export type ElevationSample = {
  alongMeters: number;
  elevation: number;
  grade: number;
  paceRole: PaceRole;
};

export type ElevationHazardMark = {
  alongMeters: number;
  kind: OSMHazardKind;
};

export type ElevationProfileData = {
  samples: ElevationSample[];
  hazards: ElevationHazardMark[];
  totalMeters: number;
  minEle: number;
  maxEle: number;
  gainMeters: number;
  lossMeters: number;
  hasElevation: boolean;
};

const DEFAULT_SAMPLES = 160;

export function buildElevationProfile(
  plan: RoutePlan,
  maxSamples = DEFAULT_SAMPLES,
): ElevationProfileData {
  const { offsets, totalMeters } = buildCumulativeDistances(plan.segments);
  let gainMeters = 0;
  let lossMeters = 0;
  let hasElevation = false;

  for (const segment of plan.segments) {
    if (segment.start.ele != null || segment.end.ele != null) {
      hasElevation = true;
    }
    if (segment.elevationDelta > 0) gainMeters += segment.elevationDelta;
    else lossMeters += -segment.elevationDelta;
  }

  if (totalMeters <= 0 || !plan.segments.length) {
    return {
      samples: [],
      hazards: [],
      totalMeters: 0,
      minEle: 0,
      maxEle: 1,
      gainMeters,
      lossMeters,
      hasElevation,
    };
  }

  const count = Math.max(2, Math.min(maxSamples, Math.round(totalMeters / 12) + 1));
  const samples: ElevationSample[] = [];

  for (let i = 0; i < count; i += 1) {
    const alongMeters = (i / (count - 1)) * totalMeters;
    const hit = pointAtDistanceAlongRoute(plan.segments, alongMeters);
    const segmentIndex = hit?.segmentIndex ?? 0;
    const segment = plan.segments[segmentIndex];
    samples.push({
      alongMeters,
      elevation:
        hit?.location.ele ?? segment?.end.ele ?? segment?.start.ele ?? 0,
      grade: segment?.grade ?? 0,
      paceRole: plan.speedPlan[segmentIndex]?.paceRole ?? "steady",
    });
  }

  const elevations = samples.map((sample) => sample.elevation);
  const minEle = Math.min(...elevations);
  const maxEle = Math.max(...elevations);

  const hazards: ElevationHazardMark[] = (plan.hazards ?? []).map((hazard) => ({
    kind: hazard.kind,
    alongMeters:
      (offsets[hazard.segmentIndex] ?? 0) +
      (plan.segments[hazard.segmentIndex]?.distanceMeters ?? 0) / 2,
  }));

  return {
    samples,
    hazards,
    totalMeters,
    minEle,
    maxEle: maxEle === minEle ? minEle + 1 : maxEle,
    gainMeters,
    lossMeters,
    hasElevation,
  };
}
