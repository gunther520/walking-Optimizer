import type { PaceRole, WorkoutLevel, WorkoutProfile, ZoneBand } from "@/types/workout";

/**
 * Classic Karvonen HR zones for interval walking.
 * Zone 2 is the ceiling — it is only targeted on Push.
 * Rest = Z1, Steady = low Z2, Push = upper Z2.
 */
const ROLE_HRR: Record<
  WorkoutLevel,
  Record<PaceRole, { low: number; high: number }>
> = {
  beginner: {
    rest: { low: 0.5, high: 0.58 },
    steady: { low: 0.58, high: 0.65 },
    push: { low: 0.65, high: 0.72 },
  },
  intermediate: {
    rest: { low: 0.5, high: 0.6 },
    steady: { low: 0.6, high: 0.66 },
    push: { low: 0.66, high: 0.75 },
  },
  advanced: {
    rest: { low: 0.5, high: 0.6 },
    steady: { low: 0.6, high: 0.68 },
    push: { low: 0.68, high: 0.78 },
  },
};

const ZONE_VO2MAX: Record<WorkoutLevel, number> = {
  beginner: 28,
  intermediate: 36,
  advanced: 44,
};

export function getDefaultSpeedBounds(level: WorkoutLevel) {
  switch (level) {
    case "beginner":
      return { minSpeedMps: 0.85, maxSpeedMps: 1.7 };
    case "intermediate":
      return { minSpeedMps: 0.95, maxSpeedMps: 2.0 };
    case "advanced":
      return { minSpeedMps: 1.05, maxSpeedMps: 2.25 };
  }
}

export function estimateHrMax(age: number) {
  return 220 - age;
}

export function getRoleHrr(level: WorkoutLevel, role: PaceRole) {
  return ROLE_HRR[level][role];
}

/**
 * Short routes keep full intensity; longer walks ease HR so average bpm drops.
 * ≤2 km → 100%, ≥8 km → ~86% of short-route effort (smooth in between).
 */
export function distanceEffortScale(routeDistanceMeters: number) {
  const SHORT_FULL_METERS = 2000;
  const LONG_SOFT_METERS = 8000;
  const MIN_SCALE = 0.86;

  if (routeDistanceMeters <= SHORT_FULL_METERS) return 1;
  if (routeDistanceMeters >= LONG_SOFT_METERS) return MIN_SCALE;

  const t =
    (routeDistanceMeters - SHORT_FULL_METERS) /
    (LONG_SOFT_METERS - SHORT_FULL_METERS);
  return 1 - t * (1 - MIN_SCALE);
}

/** Midpoint intensity inside the role's HR zone. */
export function intensityForRole(
  role: PaceRole,
  profile: WorkoutProfile,
  effortScale = 1,
) {
  const band = getRoleHrr(profile.workoutLevel, role);
  return ((band.low + band.high) / 2) * effortScale;
}

export function targetHrForRole(
  role: PaceRole,
  profile: WorkoutProfile,
  effortScale = 1,
) {
  const hrMax = estimateHrMax(profile.age);
  const intensity = intensityForRole(role, profile, effortScale);
  return Math.round(
    profile.restingHr + (hrMax - profile.restingHr) * intensity,
  );
}

export function zoneLabelForRole(role: PaceRole) {
  if (role === "rest") return "Zone 1";
  if (role === "steady") return "low Zone 2";
  return "Zone 2";
}

/** Overall UI band: Zone 1–2 (Zone 2 is the max). */
export function getZoneBand(
  profile: WorkoutProfile,
  effortScale = 1,
): ZoneBand {
  const rest = getRoleHrr(profile.workoutLevel, "rest");
  const push = getRoleHrr(profile.workoutLevel, "push");
  const hrMax = estimateHrMax(profile.age);
  const minHr =
    profile.restingHr +
    (hrMax - profile.restingHr) * rest.low * effortScale;
  const maxHr =
    profile.restingHr +
    (hrMax - profile.restingHr) * push.high * effortScale;

  return {
    minFraction: rest.low * effortScale,
    maxFraction: push.high * effortScale,
    minHr: Math.round(minHr),
    maxHr: Math.round(maxHr),
    hrMax,
  };
}

export function estimateVo2Max(profile: WorkoutProfile) {
  return ZONE_VO2MAX[profile.workoutLevel];
}

export function vo2FromSpeedAndGrade(speedMps: number, grade: number) {
  const metersPerMinute = speedMps * 60;
  return (
    0.1 * metersPerMinute +
    1.8 * metersPerMinute * Math.max(0, grade) +
    3.5
  );
}

export function metsFromVo2(vo2: number) {
  return vo2 / 3.5;
}

export function estimateHrFromVo2(profile: WorkoutProfile, vo2: number) {
  const vo2max = estimateVo2Max(profile);
  const clampedIntensity = Math.min(0.98, Math.max(0.35, vo2 / vo2max));
  const hrMax = estimateHrMax(profile.age);

  return Math.round(
    profile.restingHr + (hrMax - profile.restingHr) * clampedIntensity,
  );
}

export function getWorkoutCopy(level: WorkoutLevel) {
  switch (level) {
    case "beginner":
      return "HR intervals up to Zone 2 on push";
    case "intermediate":
      return "Zone 2 push / low Zone 2 steady / Zone 1 rest";
    case "advanced":
      return "Upper Zone 2 push with Zone 1 recovery";
  }
}
