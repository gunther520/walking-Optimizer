import { formatDistance, formatDuration } from "@/lib/route-math";
import { walkShapeLabel, type WalkShape } from "@/lib/time-budget";
import type { ViaWaypoint } from "@/lib/via-points";
import type { LatLng, RoutePlan, RoutePreference } from "@/types/workout";

export const MAX_SAVED_WALKS = 8;
const STORAGE_KEY = "walking-optimizer:saved-walks:v1";

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type SavedWalkDraft = {
  name: string;
  start: LatLng;
  end: LatLng | null;
  headingPoint: LatLng | null;
  viaPoints: ViaWaypoint[];
  routePlan: RoutePlan;
  walkShape: WalkShape;
  targetMinutes: number;
  loopSeed: number;
  routePreference: RoutePreference;
};

export type SavedWalk = SavedWalkDraft & {
  id: string;
  savedAt: string;
};

type SavedWalkStore = {
  version: 1;
  walks: SavedWalk[];
};

function getStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function createId() {
  return `walk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isWalk(value: unknown): value is SavedWalk {
  if (!value || typeof value !== "object") return false;
  const walk = value as SavedWalk;
  return (
    typeof walk.id === "string" &&
    typeof walk.name === "string" &&
    walk.start != null &&
    typeof walk.start.lat === "number" &&
    walk.routePlan != null &&
    Array.isArray(walk.routePlan.points)
  );
}

function readStore(storage: StorageLike): SavedWalk[] {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedWalkStore;
    if (parsed?.version !== 1 || !Array.isArray(parsed.walks)) return [];
    return parsed.walks.filter(isWalk);
  } catch {
    return [];
  }
}

function writeStore(walks: SavedWalk[], storage: StorageLike) {
  try {
    const payload: SavedWalkStore = { version: 1, walks };
    storage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function defaultSavedWalkName(plan: RoutePlan, walkShape: WalkShape) {
  return `${walkShapeLabel(walkShape)} · ${formatDistance(plan.totalDistanceMeters)} · ${formatDuration(plan.estimatedDurationSeconds)}`;
}

export function listSavedWalks(storage?: StorageLike): SavedWalk[] {
  const store = getStorage(storage);
  if (!store) return [];
  return readStore(store);
}

export function getSavedWalk(id: string, storage?: StorageLike): SavedWalk | null {
  return listSavedWalks(storage).find((walk) => walk.id === id) ?? null;
}

/**
 * Newest first. Caps at MAX_SAVED_WALKS. If localStorage quota is hit,
 * drops the oldest walks until the new one fits.
 */
export function saveWalk(
  draft: SavedWalkDraft,
  storage?: StorageLike,
): { walk: SavedWalk; dropped: number } | null {
  const store = getStorage(storage);
  if (!store || !draft.start || !draft.routePlan) return null;

  const name = draft.name.trim() || defaultSavedWalkName(draft.routePlan, draft.walkShape);
  const walk: SavedWalk = {
    ...draft,
    name,
    viaPoints: draft.viaPoints.map((via) => ({
      id: via.id,
      location: { ...via.location },
      sequence: via.sequence,
    })),
    id: createId(),
    savedAt: new Date().toISOString(),
  };

  let walks = [walk, ...readStore(store)];
  let dropped = Math.max(0, walks.length - MAX_SAVED_WALKS);
  walks = walks.slice(0, MAX_SAVED_WALKS);

  while (walks.length && !writeStore(walks, store)) {
    walks = walks.slice(0, -1);
    dropped += 1;
  }

  if (!walks.some((item) => item.id === walk.id)) return null;
  return { walk, dropped };
}

export function deleteSavedWalk(id: string, storage?: StorageLike) {
  const store = getStorage(storage);
  if (!store) return false;
  const walks = readStore(store).filter((walk) => walk.id !== id);
  return writeStore(walks, store);
}
