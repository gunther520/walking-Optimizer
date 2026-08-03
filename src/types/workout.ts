export type LatLng = {
  lat: number;
  lng: number;
  ele?: number;
};

export type WorkoutLevel = "beginner" | "intermediate" | "advanced";

/** How aggressively long routes ease average bpm. */
export type EffortPreference = "conserve" | "balanced" | "challenge";

/** How GraphHopper should choose the walking path. */
export type RoutePreference = "default" | "avoid_stairs" | "prefer_flat";

export type WorkoutProfile = {
  age: number;
  weightKg: number;
  restingHr: number;
  workoutLevel: WorkoutLevel;
  minSpeedMps: number;
  maxSpeedMps: number;
  effortPreference?: EffortPreference;
  routePreference?: RoutePreference;
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

export type PaceRole = "rest" | "steady" | "push";

export type SegmentPlan = {
  segmentIndex: number;
  targetSpeedMps: number;
  estimatedHr: number;
  estimatedMets: number;
  paceRole: PaceRole;
};

export type PaceBlockSummary = {
  index: number;
  paceRole: PaceRole;
  startSegmentIndex: number;
  endSegmentIndex: number;
  distanceMeters: number;
  durationSeconds: number;
  avgSpeedMps: number;
  avgHr: number;
  targetHr: number;
  zoneLabel: string;
};

export type OSMHazardKind = "stairs" | "elevator" | "trafficSignal";

export type RouteHazard = {
  kind: OSMHazardKind;
  segmentIndex: number;
  location: LatLng;
  /** graphhopper = walked on this feature; osm = pedestrian feature on the path */
  source?: "graphhopper" | "osm";
};

export type RoutePlan = {
  points: LatLng[];
  segments: RouteSegment[];
  speedPlan: SegmentPlan[];
  paceBlocks: PaceBlockSummary[];
  zoneBand: ZoneBand;
  hazards: RouteHazard[];
  hazardDebug?: {
    graphHopperCount: number;
    osmRawCount: number;
    osmOnPathCount: number;
    overpassOk: boolean;
    overpassError?: string;
  };
  totalDistanceMeters: number;
  estimatedDurationSeconds: number;
  instructionSummary: string[];
};
