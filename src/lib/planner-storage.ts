import type { EffortPreference, LatLng, RoutePlan, WorkoutLevel } from "@/types/workout";

export type StoredPlannerForm = {
  age: number;
  weightKg: number;
  restingHr: number;
  workoutLevel: WorkoutLevel;
  minSpeedMps: number;
  maxSpeedMps: number;
  effortPreference: EffortPreference;
};

export type StoredPlannerState = {
  version: 1;
  form: StoredPlannerForm;
  start: LatLng | null;
  end: LatLng | null;
  routePlan: RoutePlan | null;
  mapLocked: boolean;
  gpsConsent: boolean;
  savedAt: string;
};

const STORAGE_KEY = "walking-optimizer:v1";

export function loadPlannerState(): StoredPlannerState | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredPlannerState;
    if (parsed?.version !== 1 || !parsed.form) return null;
    return parsed;
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
