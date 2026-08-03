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

/** Place drag handles near the middle of each pace block (user-facing segment). */
export function buildPathHandles(
  plan: RoutePlan,
  viaPoints: ViaWaypoint[],
): PathHandle[] {
  const blocks = plan.paceBlocks ?? [];
  if (!blocks.length || plan.points.length < 2) return [];

  const handles: PathHandle[] = [];

  for (const block of blocks) {
    const midSeg = Math.floor(
      (block.startSegmentIndex + block.endSegmentIndex) / 2,
    );
    const point =
      plan.points[Math.min(midSeg, plan.points.length - 1)] ??
      plan.segments[midSeg]?.start;
    if (!point) continue;

    // Skip if an existing via is already near this handle.
    const nearVia = viaPoints.some(
      (via) => haversineDistance(via.location, point) < 35,
    );
    if (nearVia) continue;

    handles.push({
      id: `handle-${block.index}-${midSeg}`,
      location: { lat: point.lat, lng: point.lng },
      segmentIndex: midSeg,
    });
  }

  return handles;
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
