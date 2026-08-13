import { formatDuration } from "@/lib/route-math";
import type { StorageLike } from "@/lib/saved-walks";
import type { WalkShape } from "@/lib/time-budget";

export const MAX_WALK_LOGS = 16;
const STORAGE_KEY = "walking-optimizer:walk-log:v1";
const SIMILAR_DISTANCE_FRACTION = 0.15;

export type WalkFinishSplit = {
  label: string;
  plannedSeconds: number;
  actualSeconds: number;
};

export type WalkFinishStats = {
  distanceMeters: number;
  elapsedSeconds: number;
  plannedSeconds: number;
  kcal: number;
  splits: WalkFinishSplit[];
};

export type WalkFinishDraft = WalkFinishStats & {
  name: string;
  walkShape: WalkShape;
};

export type WalkFinishRecord = WalkFinishDraft & {
  id: string;
  finishedAt: string;
};

type WalkLogStore = {
  version: 1;
  logs: WalkFinishRecord[];
};

function getStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function createId() {
  return `log-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isRecord(value: unknown): value is WalkFinishRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as WalkFinishRecord;
  return (
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    typeof record.elapsedSeconds === "number" &&
    typeof record.distanceMeters === "number" &&
    Array.isArray(record.splits)
  );
}

function readStore(storage: StorageLike): WalkFinishRecord[] {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as WalkLogStore;
    if (parsed?.version !== 1 || !Array.isArray(parsed.logs)) return [];
    return parsed.logs.filter(isRecord);
  } catch {
    return [];
  }
}

function writeStore(logs: WalkFinishRecord[], storage: StorageLike) {
  try {
    const payload: WalkLogStore = { version: 1, logs };
    storage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function listWalkLogs(storage?: StorageLike): WalkFinishRecord[] {
  const store = getStorage(storage);
  if (!store) return [];
  return readStore(store);
}

export function formatPlanDelta(elapsedSeconds: number, plannedSeconds: number) {
  const delta = Math.round(elapsedSeconds - plannedSeconds);
  if (Math.abs(delta) < 8) return "on plan";
  if (delta < 0) return `${formatDuration(-delta)} faster than plan`;
  return `${formatDuration(delta)} slower than plan`;
}

export function similarDistance(
  aMeters: number,
  bMeters: number,
  fraction = SIMILAR_DISTANCE_FRACTION,
) {
  const basis = Math.max(aMeters, bMeters, 1);
  return Math.abs(aMeters - bMeters) / basis <= fraction;
}

export function compareToPrevious(
  current: WalkFinishRecord,
  logs: WalkFinishRecord[],
) {
  const prior = logs.find(
    (log) =>
      log.id !== current.id &&
      log.walkShape === current.walkShape &&
      similarDistance(log.distanceMeters, current.distanceMeters),
  );
  if (!prior) return null;
  const delta = Math.round(current.elapsedSeconds - prior.elapsedSeconds);
  const when = new Date(prior.finishedAt).toLocaleDateString();
  if (Math.abs(delta) < 8) {
    return `About the same time as ${when}`;
  }
  if (delta < 0) {
    return `${formatDuration(-delta)} faster than ${when}`;
  }
  return `${formatDuration(delta)} slower than ${when}`;
}

export function saveWalkLog(
  draft: WalkFinishDraft,
  storage?: StorageLike,
): { record: WalkFinishRecord; dropped: number } | null {
  const store = getStorage(storage);
  if (!store) return null;

  const record: WalkFinishRecord = {
    ...draft,
    name: draft.name.trim() || "Walk",
    kcal: Math.max(0, Math.round(draft.kcal)),
    elapsedSeconds: Math.max(0, Math.round(draft.elapsedSeconds)),
    plannedSeconds: Math.max(0, Math.round(draft.plannedSeconds)),
    distanceMeters: Math.max(0, draft.distanceMeters),
    splits: draft.splits.map((split) => ({
      label: split.label,
      plannedSeconds: Math.max(0, Math.round(split.plannedSeconds)),
      actualSeconds: Math.max(0, Math.round(split.actualSeconds)),
    })),
    id: createId(),
    finishedAt: new Date().toISOString(),
  };

  const existing = readStore(store);
  const newest = existing[0];
  if (
    newest &&
    newest.name === record.name &&
    newest.walkShape === record.walkShape &&
    Math.abs(newest.elapsedSeconds - record.elapsedSeconds) <= 2 &&
    similarDistance(newest.distanceMeters, record.distanceMeters) &&
    Date.now() - Date.parse(newest.finishedAt) < 4000
  ) {
    return { record: newest, dropped: 0 };
  }

  let logs = [record, ...existing];
  let dropped = Math.max(0, logs.length - MAX_WALK_LOGS);
  logs = logs.slice(0, MAX_WALK_LOGS);

  while (logs.length && !writeStore(logs, store)) {
    logs = logs.slice(0, -1);
    dropped += 1;
  }

  if (!logs.some((item) => item.id === record.id)) return null;
  return { record, dropped };
}

export function deleteWalkLog(id: string, storage?: StorageLike) {
  const store = getStorage(storage);
  if (!store) return false;
  const logs = readStore(store).filter((log) => log.id !== id);
  return writeStore(logs, store);
}
