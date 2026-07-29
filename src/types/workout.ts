export type LatLng = {
  lat: number;
  lng: number;
  ele?: number;
};

export type WorkoutLevel = "beginner" | "intermediate" | "advanced";

export type WorkoutProfile = {
  age: number;
  weightKg: number;
  restingHr: number;
  workoutLevel: WorkoutLevel;
  minSpeedMps: number;
  maxSpeedMps: number;
};

export type RouteSegment = {
  index: number;
  start: LatLng;
  end: LatLng;
  distanceMeters: number;
  grade: number;
  elevationDelta: number;
};

export type ZoneBand = {
  minFraction: number;
  maxFraction: number;
  minHr: number;
  maxHr: number;
  hrMax: number;
};

export type SegmentPlan = {
  segmentIndex: number;
  targetSpeedMps: number;
  estimatedHr: number;
  estimatedMets: number;
};

export type RoutePlan = {
  points: LatLng[];
  segments: RouteSegment[];
  speedPlan: SegmentPlan[];
  zoneBand: ZoneBand;
  totalDistanceMeters: number;
  estimatedDurationSeconds: number;
  instructionSummary: string[];
};
