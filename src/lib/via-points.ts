import type { LatLng, RoutePlan, RouteSegment } from "@/types/workout";
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

/** Target spacing between blue drag handles along the route. */
const HANDLE_SPACING_METERS = 240;
/** Keep handles away from start/end endpoints. */
const END_MARGIN_METERS = 90;
/** Skip a handle if an avoidance via is already nearby. */
const VIA_CLEARANCE_METERS = 50;

function createId() {
  return `via-${Math.random().toString(36).slice(2, 10)}`;
}

function isNearExistingVia(point: LatLng, viaPoints: ViaWaypoint[]) {
  return viaPoints.some(
    (via) => haversineDistance(via.location, point) < VIA_CLEARANCE_METERS,
  );
}

function interpolateOnSegment(segment: RouteSegment, t: number): LatLng {
  return {
    lat: segment.start.lat + (segment.end.lat - segment.start.lat) * t,
    lng: segment.start.lng + (segment.end.lng - segment.start.lng) * t,
    ele:
      segment.start.ele != null && segment.end.ele != null
        ? segment.start.ele + (segment.end.ele - segment.start.ele) * t
        : segment.end.ele ?? segment.start.ele,
  };
}

/**
 * Point at a given distance along the polyline (meters from start).
 * Returns null if the distance is outside the route.
 */
export function pointAtDistanceAlongRoute(
  segments: RouteSegment[],
  targetMeters: number,
): { location: LatLng; segmentIndex: number } | null {
  if (!segments.length || targetMeters < 0) return null;

  let walked = 0;
  for (const segment of segments) {
    const next = walked + segment.distanceMeters;
    if (targetMeters <= next || segment.index === segments.length - 1) {
      const span = Math.max(segment.distanceMeters, 1e-6);
      const t = Math.min(1, Math.max(0, (targetMeters - walked) / span));
      return {
        location: interpolateOnSegment(segment, t),
        segmentIndex: segment.index,
      };
    }
    walked = next;
  }

  return null;
}

/**
 * Place drag handles evenly along the full path (not clustered at the start).
 * A bit less dense: about one handle every ~240 m, inset from start/end.
 */
export function buildPathHandles(
  plan: RoutePlan,
  viaPoints: ViaWaypoint[],
): PathHandle[] {
  if (plan.points.length < 2 || !plan.segments.length) return [];

  const total =
    plan.totalDistanceMeters ||
    plan.segments.reduce((sum, segment) => sum + segment.distanceMeters, 0);

  if (total < END_MARGIN_METERS * 2 + 40) {
    // Very short route: one middle handle if clear of vias.
    const mid = pointAtDistanceAlongRoute(plan.segments, total / 2);
    if (!mid || isNearExistingVia(mid.location, viaPoints)) return [];
    return [
      {
        id: `handle-mid-${mid.segmentIndex}`,
        location: mid.location,
        segmentIndex: mid.segmentIndex,
      },
    ];
  }

  const usable = total - END_MARGIN_METERS * 2;
  const count = Math.max(1, Math.round(usable / HANDLE_SPACING_METERS));
  const step = usable / count;

  const handles: PathHandle[] = [];

  for (let i = 0; i < count; i += 1) {
    const at = END_MARGIN_METERS + step * (i + 0.5);
    const hit = pointAtDistanceAlongRoute(plan.segments, at);
    if (!hit) continue;
    if (isNearExistingVia(hit.location, viaPoints)) continue;

    handles.push({
      id: `handle-${i}-${hit.segmentIndex}`,
      location: hit.location,
      segmentIndex: hit.segmentIndex,
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
