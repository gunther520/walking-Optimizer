import {
  estimateHrFromVo2,
  getZoneBand,
  metsFromVo2,
  targetHrForRole,
  vo2FromSpeedAndGrade,
  zoneLabelForRole,
} from "@/lib/training";
import { buildSegments, densifyRoutePoints, getNearestSegmentMatch } from "@/lib/route-math";
import type {
  OSMHazardKind,
  PaceBlockSummary,
  PaceRole,
  RouteHazard,
  RoutePlan,
  RouteSegment,
  SegmentPlan,
  WorkoutProfile,
  LatLng,
} from "@/types/workout";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

type IntervalBlock = {
  startIndex: number;
  endIndex: number;
  distanceMeters: number;
  durationSeconds: number;
  avgGrade: number;
  hazards: OSMHazardKind[];
  role: PaceRole;
  targetHr: number;
};

/** Every alternating pair: 75% push + 25% recovery, same pair length. */
const PUSH_TIME_RATIO = 0.75;
const RECOVERY_TIME_RATIO = 0.25;
const PAIR_SECONDS = 120;
const PUSH_SECONDS = PAIR_SECONDS * PUSH_TIME_RATIO; // 90
const RECOVERY_SECONDS = PAIR_SECONDS * RECOVERY_TIME_RATIO; // 30
/** Keep edges short so time targets stay accurate. */
const DENSIFY_STEP_METERS = 12;

function hazardKindsForSegment(
  segmentIndex: number,
  hazardsBySegment: Map<number, OSMHazardKind[]>,
) {
  return hazardsBySegment.get(segmentIndex) ?? [];
}

function isHardTerrain(grade: number, hazards: OSMHazardKind[]) {
  return (
    hazards.includes("stairs") ||
    hazards.includes("elevator") ||
    grade > 0.06
  );
}

function speedForTargetHr(
  segment: RouteSegment,
  profile: WorkoutProfile,
  targetHr: number,
  role: PaceRole,
) {
  const span = profile.maxSpeedMps - profile.minSpeedMps;
  const minBound =
    role === "rest"
      ? profile.minSpeedMps
      : role === "steady"
        ? profile.minSpeedMps + span * 0.35
        : profile.minSpeedMps + span * 0.7;
  const maxBound =
    role === "rest"
      ? profile.minSpeedMps + span * 0.38
      : role === "steady"
        ? profile.minSpeedMps + span * 0.72
        : profile.maxSpeedMps;

  let speed = role === "push" ? maxBound * 0.92 : (minBound + maxBound) / 2;

  for (let step = 0; step < 16; step += 1) {
    const vo2 = vo2FromSpeedAndGrade(speed, Math.max(0, segment.grade));
    const estimatedHr = estimateHrFromVo2(profile, vo2);
    speed += (targetHr - estimatedHr) / 180;
    speed = clamp(speed, minBound, maxBound);
  }

  return speed;
}

function estimateSegmentSeconds(
  segment: RouteSegment,
  profile: WorkoutProfile,
  role: PaceRole,
) {
  const targetHr = targetHrForRole(role, profile);
  const speed = speedForTargetHr(segment, profile, targetHr, role);
  return segment.distanceMeters / Math.max(speed, 0.2);
}

/**
 * Fill exactly ~targetSeconds using short densified edges.
 * Stops as soon as the target is reached — never swallows a long GraphHopper edge.
 */
function takeTimedBlock(
  segments: RouteSegment[],
  hazardsBySegment: Map<number, OSMHazardKind[]>,
  profile: WorkoutProfile,
  startAt: number,
  role: PaceRole,
  targetSeconds: number,
): { block: IntervalBlock | null; nextIndex: number } {
  if (startAt >= segments.length) {
    return { block: null, nextIndex: startAt };
  }

  let i = startAt;
  let distanceMeters = 0;
  let durationSeconds = 0;
  let gradeWeighted = 0;
  const hazardSet = new Set<OSMHazardKind>();
  let endIndex = startAt;

  while (i < segments.length) {
    const segment = segments[i];
    const hazards = hazardKindsForSegment(i, hazardsBySegment);
    const seconds = estimateSegmentSeconds(segment, profile, role);

    // Stop before adding if we are already near target and this would overshoot.
    if (durationSeconds >= targetSeconds * 0.92) break;
    if (
      durationSeconds > 0 &&
      durationSeconds + seconds > targetSeconds * 1.08
    ) {
      break;
    }

    distanceMeters += segment.distanceMeters;
    durationSeconds += seconds;
    gradeWeighted += segment.grade * segment.distanceMeters;
    for (const hazard of hazards) hazardSet.add(hazard);
    endIndex = i;
    i += 1;

    if (durationSeconds >= targetSeconds) break;
  }

  // Guarantee progress on pathological short leftovers.
  if (i === startAt && startAt < segments.length) {
    const segment = segments[startAt];
    const hazards = hazardKindsForSegment(startAt, hazardsBySegment);
    const seconds = estimateSegmentSeconds(segment, profile, role);
    distanceMeters = segment.distanceMeters;
    durationSeconds = seconds;
    gradeWeighted = segment.grade * segment.distanceMeters;
    for (const hazard of hazards) hazardSet.add(hazard);
    endIndex = startAt;
    i = startAt + 1;
  }

  return {
    nextIndex: i,
    block: {
      startIndex: startAt,
      endIndex,
      distanceMeters,
      durationSeconds,
      avgGrade: distanceMeters > 0 ? gradeWeighted / distanceMeters : 0,
      hazards: [...hazardSet],
      role,
      targetHr: targetHrForRole(role, profile),
    },
  };
}

function pickRecoveryRole(hazards: OSMHazardKind[], avgGrade: number): PaceRole {
  if (isHardTerrain(avgGrade, hazards) || hazards.includes("trafficSignal")) {
    return "rest";
  }
  return "steady";
}

function remapHazardsToSegments(
  hazards: RouteHazard[],
  segments: RouteSegment[],
): RouteHazard[] {
  return hazards.map((hazard) => {
    const match = getNearestSegmentMatch(hazard.location, segments);
    return { ...hazard, segmentIndex: match.segmentIndex };
  });
}

function buildHazardMap(hazards: RouteHazard[]) {
  const hazardsBySegment = new Map<number, OSMHazardKind[]>();
  for (const hazard of hazards) {
    const existing = hazardsBySegment.get(hazard.segmentIndex) ?? [];
    hazardsBySegment.set(hazard.segmentIndex, [...existing, hazard.kind]);
  }
  return hazardsBySegment;
}

/**
 * Strict pairs with consistent timing on densified geometry:
 * push (~90s, 75%) → one recovery (~30s, 25%) → repeat.
 */
function buildBalancedPairs(
  segments: RouteSegment[],
  hazardsBySegment: Map<number, OSMHazardKind[]>,
  profile: WorkoutProfile,
): IntervalBlock[] {
  if (!segments.length) return [];

  const blocks: IntervalBlock[] = [];
  let i = 0;

  while (i < segments.length) {
    const remainingRoughSeconds = segments.slice(i).reduce((sum, segment) => {
      const mid = (profile.minSpeedMps + profile.maxSpeedMps) / 2;
      return sum + segment.distanceMeters / Math.max(mid, 0.2);
    }, 0);

    const pairSeconds =
      remainingRoughSeconds < PAIR_SECONDS * 0.45
        ? Math.max(36, remainingRoughSeconds)
        : PAIR_SECONDS;
    const pushTarget = pairSeconds * PUSH_TIME_RATIO;
    const recoveryTarget = pairSeconds * RECOVERY_TIME_RATIO;

    // 1) Push — 75%
    const push = takeTimedBlock(
      segments,
      hazardsBySegment,
      profile,
      i,
      "push",
      pushTarget,
    );
    if (!push.block) break;
    blocks.push(push.block);
    i = push.nextIndex;
    if (i >= segments.length) break;

    // 2) Single recovery — 25%
    const peekHazards = hazardKindsForSegment(i, hazardsBySegment);
    const recoveryRole = pickRecoveryRole(peekHazards, segments[i].grade);
    const recovery = takeTimedBlock(
      segments,
      hazardsBySegment,
      profile,
      i,
      recoveryRole,
      recoveryTarget,
    );
    if (!recovery.block) break;
    blocks.push(recovery.block);
    i = recovery.nextIndex;
  }

  return ensureStrictAlternation(blocks, profile);
}

function ensureStrictAlternation(
  blocks: IntervalBlock[],
  profile: WorkoutProfile,
): IntervalBlock[] {
  const out: IntervalBlock[] = [];
  for (const block of blocks) {
    const prev = out[out.length - 1];
    if (prev?.role === "push" && block.role === "push") {
      out.push({
        ...block,
        role: "rest",
        targetHr: targetHrForRole("rest", profile),
      });
      continue;
    }
    if (prev && prev.role !== "push" && block.role !== "push") {
      const distanceMeters = prev.distanceMeters + block.distanceMeters;
      const durationSeconds = prev.durationSeconds + block.durationSeconds;
      const gradeWeighted =
        prev.avgGrade * prev.distanceMeters +
        block.avgGrade * block.distanceMeters;
      const role: PaceRole =
        prev.role === "rest" || block.role === "rest" ? "rest" : "steady";
      out[out.length - 1] = {
        startIndex: prev.startIndex,
        endIndex: block.endIndex,
        distanceMeters,
        durationSeconds,
        avgGrade: distanceMeters > 0 ? gradeWeighted / distanceMeters : 0,
        hazards: [...new Set([...prev.hazards, ...block.hazards])],
        role,
        targetHr: targetHrForRole(role, profile),
      };
      continue;
    }
    out.push(block);
  }
  return out;
}

function lightSmooth(plans: SegmentPlan[], profile: WorkoutProfile) {
  return plans.map((plan, index) => {
    const previous = plans[index - 1];
    const next = plans[index + 1];
    if (
      previous?.paceRole === plan.paceRole &&
      next?.paceRole === plan.paceRole
    ) {
      const smoothed =
        (previous.targetSpeedMps + plan.targetSpeedMps + next.targetSpeedMps) /
        3;
      return {
        ...plan,
        targetSpeedMps: clamp(
          smoothed,
          profile.minSpeedMps,
          profile.maxSpeedMps,
        ),
      };
    }
    return plan;
  });
}

function summarizePaceBlocks(
  blocks: IntervalBlock[],
  profile: WorkoutProfile,
): PaceBlockSummary[] {
  return blocks.map((block, index) => ({
    index,
    paceRole: block.role,
    startSegmentIndex: block.startIndex,
    endSegmentIndex: block.endIndex,
    distanceMeters: block.distanceMeters,
    durationSeconds: block.durationSeconds,
    avgSpeedMps:
      block.durationSeconds > 0
        ? block.distanceMeters / block.durationSeconds
        : 0,
    avgHr: block.targetHr,
    targetHr: targetHrForRole(block.role, profile),
    zoneLabel: zoneLabelForRole(block.role),
  }));
}

export function buildRoutePlan(
  points: LatLng[],
  segments: RouteSegment[],
  instructions: string[],
  profile: WorkoutProfile,
  hazards: RouteHazard[],
): RoutePlan {
  const zoneBand = getZoneBand(profile);

  // Densify first so 90s/30s targets are enforceable.
  const densifiedPoints = densifyRoutePoints(points, DENSIFY_STEP_METERS);
  const densifiedSegments = buildSegments(densifiedPoints);
  const remappedHazards = remapHazardsToSegments(hazards, densifiedSegments);
  const hazardsBySegment = buildHazardMap(remappedHazards);

  const hazardSummary = remappedHazards.slice(0, 12).map((h) => {
    const label =
      h.kind === "stairs"
        ? "Stairs (on path)"
        : h.kind === "elevator"
          ? "Elevator (on path)"
          : "Pedestrian crossing signal";
    return `${label} near densified segment #${h.segmentIndex + 1}`;
  });

  const blocks = buildBalancedPairs(
    densifiedSegments,
    hazardsBySegment,
    profile,
  );
  const roleBySegment = new Map<number, PaceRole>();
  for (const block of blocks) {
    for (let idx = block.startIndex; idx <= block.endIndex; idx += 1) {
      roleBySegment.set(idx, block.role);
    }
  }

  const rawPlan: SegmentPlan[] = densifiedSegments.map((segment) => {
    const role = roleBySegment.get(segment.index) ?? "steady";
    const targetHr = targetHrForRole(role, profile);
    const targetSpeedMps = speedForTargetHr(segment, profile, targetHr, role);
    const vo2 = vo2FromSpeedAndGrade(
      targetSpeedMps,
      Math.max(0, segment.grade),
    );

    return {
      segmentIndex: segment.index,
      targetSpeedMps,
      estimatedHr: targetHr,
      estimatedMets: metsFromVo2(vo2),
      paceRole: role,
    };
  });

  const speedPlan = lightSmooth(rawPlan, profile).map((plan) => {
    const targetHr = targetHrForRole(plan.paceRole, profile);
    const segment = densifiedSegments[plan.segmentIndex];
    const vo2 = vo2FromSpeedAndGrade(
      plan.targetSpeedMps,
      Math.max(0, segment.grade),
    );

    return {
      ...plan,
      estimatedHr: targetHr,
      estimatedMets: metsFromVo2(vo2),
    };
  });

  const totalDistanceMeters = densifiedSegments.reduce(
    (sum, segment) => sum + segment.distanceMeters,
    0,
  );

  const estimatedDurationSeconds = densifiedSegments.reduce(
    (sum, segment, index) => {
      const speed = speedPlan[index]?.targetSpeedMps ?? profile.minSpeedMps;
      return sum + segment.distanceMeters / Math.max(speed, 0.2);
    },
    0,
  );

  const pushSeconds = blocks
    .filter((b) => b.role === "push")
    .reduce((sum, b) => sum + b.durationSeconds, 0);
  const recoverySeconds = blocks
    .filter((b) => b.role !== "push")
    .reduce((sum, b) => sum + b.durationSeconds, 0);
  const totalIntervalSeconds = Math.max(pushSeconds + recoverySeconds, 1);
  const pushShare = Math.round((pushSeconds / totalIntervalSeconds) * 100);

  const pushMeters = blocks
    .filter((b) => b.role === "push")
    .reduce((sum, b) => sum + b.distanceMeters, 0);

  const pushCount = blocks.filter((b) => b.role === "push").length;
  const restCount = blocks.filter((b) => b.role === "rest").length;
  const steadyCount = blocks.filter((b) => b.role === "steady").length;
  const paceBlocks = summarizePaceBlocks(blocks, profile);

  const pushHr = targetHrForRole("push", profile);
  const steadyHr = targetHrForRole("steady", profile);
  const restHr = targetHrForRole("rest", profile);

  // Silence unused original segments param contract (callers still pass GH segments).
  void segments;

  return {
    points: densifiedPoints,
    segments: densifiedSegments,
    speedPlan,
    paceBlocks,
    zoneBand,
    hazards: remappedHazards,
    totalDistanceMeters,
    estimatedDurationSeconds,
    instructionSummary: [
      `HR intervals: Push Z2 ~${pushHr} bpm / Steady low-Z2 ~${steadyHr} bpm / Rest Z1 ~${restHr} bpm`,
      `Pair timing target 75/25 (~${PUSH_SECONDS}s push / ~${RECOVERY_SECONDS}s recovery). Actual push share ~${pushShare}%`,
      `Blocks: ${pushCount} push / ${steadyCount} steady / ${restCount} rest · push ~${Math.round(pushMeters)} m / ~${Math.round(pushSeconds)} s`,
      ...hazardSummary,
      ...instructions,
    ],
  };
}
