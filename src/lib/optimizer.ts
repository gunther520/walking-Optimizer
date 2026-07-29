import { metsFromVo2, estimateHrFromVo2, vo2FromSpeedAndGrade, getZoneBand } from "@/lib/training";
import type { RoutePlan, RouteSegment, SegmentPlan, WorkoutProfile } from "@/types/workout";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function smoothSpeeds(plans: SegmentPlan[], profile: WorkoutProfile) {
  return plans.map((plan, index) => {
    const previous = plans[index - 1]?.targetSpeedMps ?? plan.targetSpeedMps;
    const current = plan.targetSpeedMps;
    const next = plans[index + 1]?.targetSpeedMps ?? plan.targetSpeedMps;
    const smoothed = (previous + current + next) / 3;

    return {
      ...plan,
      targetSpeedMps: clamp(smoothed, profile.minSpeedMps, profile.maxSpeedMps),
    };
  });
}

function estimateTargetSpeed(segment: RouteSegment, profile: WorkoutProfile) {
  const zone = getZoneBand(profile);
  const targetHr = (zone.minHr + zone.maxHr) / 2;
  let speed = (profile.minSpeedMps + profile.maxSpeedMps) / 2;

  for (let index = 0; index < 12; index += 1) {
    const vo2 = vo2FromSpeedAndGrade(speed, Math.max(-0.08, segment.grade));
    const estimatedHr = estimateHrFromVo2(profile, vo2);

    if (estimatedHr > zone.maxHr) {
      speed -= 0.08;
    } else if (estimatedHr < zone.minHr) {
      speed += 0.08;
    } else {
      const hrDelta = targetHr - estimatedHr;
      speed += hrDelta / 300;
    }

    speed = clamp(speed, profile.minSpeedMps, profile.maxSpeedMps);
  }

  return speed;
}

export function buildRoutePlan(
  points: RouteSegment["start"][],
  segments: RouteSegment[],
  instructions: string[],
  profile: WorkoutProfile,
): RoutePlan {
  const zoneBand = getZoneBand(profile);

  const rawPlan = segments.map((segment) => {
    const targetSpeedMps = estimateTargetSpeed(segment, profile);
    const vo2 = vo2FromSpeedAndGrade(targetSpeedMps, Math.max(-0.08, segment.grade));

    return {
      segmentIndex: segment.index,
      targetSpeedMps,
      estimatedHr: estimateHrFromVo2(profile, vo2),
      estimatedMets: metsFromVo2(vo2),
    };
  });

  const speedPlan = smoothSpeeds(rawPlan, profile).map((plan, index) => {
    const segment = segments[index];
    const vo2 = vo2FromSpeedAndGrade(
      plan.targetSpeedMps,
      Math.max(-0.08, segment.grade),
    );

    return {
      ...plan,
      estimatedHr: estimateHrFromVo2(profile, vo2),
      estimatedMets: metsFromVo2(vo2),
    };
  });

  const totalDistanceMeters = segments.reduce(
    (sum, segment) => sum + segment.distanceMeters,
    0,
  );

  const estimatedDurationSeconds = segments.reduce((sum, segment, index) => {
    const speed = speedPlan[index]?.targetSpeedMps ?? profile.minSpeedMps;
    return sum + segment.distanceMeters / Math.max(speed, 0.2);
  }, 0);

  return {
    points,
    segments,
    speedPlan,
    zoneBand,
    totalDistanceMeters,
    estimatedDurationSeconds,
    instructionSummary: instructions,
  };
}
