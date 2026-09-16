import type { EffortPreference, LatLng, RoutePlan, RoutePreference, WorkoutLevel } from "@/types/workout";
import type { WalkShape } from "@/lib/time-budget";

export type StoredPlannerForm = {
  age: number;
  weightKg: number;
  restingHr: number;
  workoutLevel: WorkoutLevel;
  minSpeedMps: number;
  maxSpeedMps: number;
  effortPreference: EffortPreference;
  routePreference: RoutePreference;
  walkShape?: WalkShape;
  targetMinutes?: number;
  loopSeed?: number;
};

export type StoredWalkSession = {
  walking: boolean;
  elapsedSeconds: number;
  alongMeters: number;
  routeId: string;
};

export type StoredPlannerState = {
  version: 1;
  form: StoredPlannerForm;
  start: LatLng | null;
  end: LatLng | null;
  routePlan: RoutePlan | null;
  mapLocked: boolean;
  gpsConsent: boolean;
  viaPoints?: Array<{ id: string; location: LatLng; sequence?: number }>;
  walkSession?: StoredWalkSession | null;
  savedAt: string;
};

const STORAGE_KEY = "walking-optimizer:v1";

export function walkRouteId(plan: {
  segments: { length: number };
  totalDistanceMeters: number;
}) {
  return `${plan.segments.length}-${Math.round(plan.totalDistanceMeters)}`;
}

export function parseWalkSession(raw: unknown): StoredWalkSession | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.walking !== "boolean") return null;
  if (typeof value.elapsedSeconds !== "number" || !Number.isFinite(value.elapsedSeconds)) {
    return null;
  }
  if (typeof value.alongMeters !== "number" || !Number.isFinite(value.alongMeters)) {
    return null;
  }
  if (typeof value.routeId !== "string" || !value.routeId) return null;
  return {
    walking: value.walking,
    elapsedSeconds: Math.max(0, Math.round(value.elapsedSeconds)),
    alongMeters: Math.max(0, value.alongMeters),
    routeId: value.routeId,
  };
}

export function walkSessionForPlan(
  session: StoredWalkSession | null | undefined,
  plan: { segments: { length: number }; totalDistanceMeters: number } | null,
): StoredWalkSession | null {
  if (!session || !plan) return null;
  if (session.routeId !== walkRouteId(plan)) return null;
  if (session.elapsedSeconds <= 0 && session.alongMeters <= 0) return null;
  return session;
}

export function loadPlannerState(): StoredPlannerState | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredPlannerState;
    if (parsed?.version !== 1 || !parsed.form) return null;
    return {
      ...parsed,
      walkSession: walkSessionForPlan(
        parseWalkSession(parsed.walkSession),
        parsed.routePlan,
      ),
    };
  } catch {
    return null;
  }
}

export function savePlannerState(state: Omit<StoredPlannerState, "version" | "savedAt">) {
  if (typeof window === "undefined") return;

  try {
    const payload: StoredPlannerState = {
      version: 1,
      ...state,
      walkSession: walkSessionForPlan(state.walkSession ?? null, state.routePlan),
      savedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Quota / private mode — ignore.
  }
}

export function clearPlannerState() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore.
  }
}
