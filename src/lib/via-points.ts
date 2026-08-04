import type { LatLng, RoutePlan } from "@/types/workout";
import { getNearestSegmentMatch, haversineDistance } from "@/lib/route-math";

export type ViaWaypoint = {
  id: string;
  location: LatLng;
};

export type PathHandle = {
  id: string;
  location: LatLng;
  /** Densified segment index near this handle — used to order new vias. */
  segmentIndex: number;
};

function createId() {
  return `via-${Math.random().toString(36).slice(2, 10)}`;
}

function isNearExistingVia(point: LatLng, viaPoints: ViaWaypoint[], meters = 40) {
  return viaPoints.some((via) => haversineDistance(via.location, point) < meters);
}

/** Place drag handles along the path so users can dodge blocked roads. */
export function buildPathHandles(
  plan: RoutePlan,
  viaPoints: ViaWaypoint[],
): PathHandle[] {
  if (plan.points.length < 2 || !plan.segments.length) return [];

  const handles: PathHandle[] = [];
  const seenSeg = new Set<number>();

  function pushHandle(segmentIndex: number, location: LatLng, id: string) {
    const clamped = Math.max(
      0,
      Math.min(segmentIndex, plan.segments.length - 1),
    );
    if (seenSeg.has(clamped)) return;
    if (isNearExistingVia(location, viaPoints)) return;
    seenSeg.add(clamped);
    handles.push({
      id,
      location: { lat: location.lat, lng: location.lng },
      segmentIndex: clamped,
    });
  }

  // 1) Midpoint of each pace block (user-facing interval).
  for (const block of plan.paceBlocks ?? []) {
    const midSeg = Math.floor(
      (block.startSegmentIndex + block.endSegmentIndex) / 2,
    );
    const point =
      plan.points[Math.min(midSeg, plan.points.length - 1)] ??
      plan.segments[midSeg]?.start;
    if (!point) continue;
    pushHandle(midSeg, point, `handle-block-${block.index}-${midSeg}`);
  }

  // 2) Extra samples every ~150 m so long edges always have a grab point.
  let walked = 0;
  let nextAt = 75;
  for (const segment of plan.segments) {
    walked += segment.distanceMeters;
    while (walked >= nextAt) {
      pushHandle(
        segment.index,
        segment.end,
        `handle-sample-${segment.index}-${Math.round(nextAt)}`,
      );
      nextAt += 150;
    }
  }

  // Cap so the map stays usable on phones.
  return handles.slice(0, 24);
}

/** Keep vias ordered along the current path geometry. */
export function sortViasAlongRoute(
  vias: ViaWaypoint[],
  plan: RoutePlan | null,
): ViaWaypoint[] {
  if (!plan?.segments.length) return vias;

  return [...vias].sort((a, b) => {
    const aMatch = getNearestSegmentMatch(a.location, plan.segments);
    const bMatch = getNearestSegmentMatch(b.location, plan.segments);
    if (aMatch.segmentIndex !== bMatch.segmentIndex) {
      return aMatch.segmentIndex - bMatch.segmentIndex;
    }
    return a.location.lat - b.location.lat;
  });
}

export function upsertViaFromHandle(
  vias: ViaWaypoint[],
  handle: PathHandle,
  droppedAt: LatLng,
  plan: RoutePlan | null,
): ViaWaypoint[] {
  void handle;
  const next: ViaWaypoint[] = [
    ...vias,
    { id: createId(), location: droppedAt },
  ];
  return sortViasAlongRoute(next, plan);
}

export function updateViaLocation(
  vias: ViaWaypoint[],
  viaId: string,
  location: LatLng,
  plan: RoutePlan | null,
): ViaWaypoint[] {
  const next = vias.map((via) =>
    via.id === viaId ? { ...via, location } : via,
  );
  return sortViasAlongRoute(next, plan);
}

export function removeVia(vias: ViaWaypoint[], viaId: string): ViaWaypoint[] {
  return vias.filter((via) => via.id !== viaId);
}
