import type { WorkoutLevel, WorkoutProfile, ZoneBand } from "@/types/workout";

const ZONE_RANGES: Record<WorkoutLevel, { minFraction: number; maxFraction: number; vo2max: number }> = {
  beginner: { minFraction: 0.6, maxFraction: 0.7, vo2max: 26 },
  intermediate: { minFraction: 0.65, maxFraction: 0.8, vo2max: 34 },
  advanced: { minFraction: 0.75, maxFraction: 0.85, vo2max: 42 },
};

export function getDefaultSpeedBounds(level: WorkoutLevel) {
  switch (level) {
    case "beginner":
      return { minSpeedMps: 0.9, maxSpeedMps: 1.45 };
    case "intermediate":
      return { minSpeedMps: 1.0, maxSpeedMps: 1.75 };
    case "advanced":
      return { minSpeedMps: 1.1, maxSpeedMps: 2.0 };
  }
}

export function estimateHrMax(age: number) {
  return 220 - age;
}

export function getZoneBand(profile: WorkoutProfile): ZoneBand {
  const range = ZONE_RANGES[profile.workoutLevel];
  const hrMax = estimateHrMax(profile.age);
  const minHr =
    profile.restingHr + (hrMax - profile.restingHr) * range.minFraction;
  const maxHr =
    profile.restingHr + (hrMax - profile.restingHr) * range.maxFraction;

  return {
    minFraction: range.minFraction,
    maxFraction: range.maxFraction,
    minHr: Math.round(minHr),
    maxHr: Math.round(maxHr),
    hrMax,
  };
}

export function estimateVo2Max(profile: WorkoutProfile) {
  return ZONE_RANGES[profile.workoutLevel].vo2max;
}

export function vo2FromSpeedAndGrade(speedMps: number, grade: number) {
  const metersPerMinute = speedMps * 60;
  return 0.1 * metersPerMinute + 1.8 * metersPerMinute * grade + 3.5;
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
      return "Comfortable aerobic build";
    case "intermediate":
      return "Steady cardio conditioning";
    case "advanced":
      return "Strong brisk-walk interval feel";
  }
}
