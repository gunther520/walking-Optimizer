import type { LatLng, RoutePlan, RouteSegment } from "@/types/workout";
import { getNearestSegmentMatch, haversineDistance } from "@/lib/route-math";

export type ViaWaypoint = {
  id: string;
  location: LatLng;
  /**
   * Stable visit order. Set from path distance when the via is created from a
   * handle, and kept when the marker is dragged off-path for a detour.
   * Sorting by nearest-on-current-path would scramble off-path avoidance vias.
   */
  sequence: number;
};

export type PathHandle = {
  id: string;
  location: LatLng;
  /** Densified segment index near this handle — used to order new vias. */
  segmentIndex: number;
  /** Distance from route start along the polyline. */
  alongMeters: number;
};

/** Target spacing between blue drag handles along the route. */
const HANDLE_SPACING_METERS = 280;
/** Keep handles away from start/end endpoints. */
const END_MARGIN_METERS = 120;
/** Skip a handle if an avoidance via is already nearby. */
const VIA_CLEARANCE_METERS = 55;
/** Soft cap so phones stay usable on very long walks. */
const MAX_HANDLES = 18;
/** A via farther than this from the rebuilt path is treated as neglected. */
export const VIA_ON_PATH_MAX_METERS = 95;

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

/** Cumulative distances: offsets[i] = meters from start to segments[i].start */
export function buildCumulativeDistances(segments: RouteSegment[]) {
  const offsets: number[] = [];
  let walked = 0;
  for (const segment of segments) {
    offsets.push(walked);
    walked += Math.max(0, segment.distanceMeters);
  }
  return { offsets, totalMeters: walked };
}

/**
 * Point at a given distance along the polyline (meters from start).
 * Uses real cumulative segment length — never trusts plan.totalDistanceMeters alone.
 */
export function pointAtDistanceAlongRoute(
  segments: RouteSegment[],
  targetMeters: number,
  precomputed?: { offsets: number[]; totalMeters: number },
): { location: LatLng; segmentIndex: number; alongMeters: number } | null {
  if (!segments.length || targetMeters < 0) return null;

  const { offsets, totalMeters } =
    precomputed ?? buildCumulativeDistances(segments);
  if (totalMeters <= 0) return null;

  const clamped = Math.min(targetMeters, totalMeters);
  // Find last offset <= clamped
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (offsets[mid] <= clamped) lo = mid;
    else hi = mid - 1;
  }

  const segment = segments[lo];
  const span = Math.max(segment.distanceMeters, 1e-6);
  const t = Math.min(1, Math.max(0, (clamped - offsets[lo]) / span));

  return {
    location: interpolateOnSegment(segment, t),
    segmentIndex: segment.index,
    alongMeters: clamped,
  };
}

/**
 * Place drag handles evenly along the FULL polyline length.
 * Spacing ~280 m, inset from endpoints, covering start→end (not only the first half).
 */
export function buildPathHandles(
  plan: RoutePlan,
  viaPoints: ViaWaypoint[],
): PathHandle[] {
  if (plan.points.length < 2 || !plan.segments.length) return [];

  // Always measure the geometry we render — ignore a stale/wrong totalDistanceMeters.
  const cumulative = buildCumulativeDistances(plan.segments);
  const total = cumulative.totalMeters;
  if (total <= 0) return [];

  if (total < END_MARGIN_METERS * 2 + 50) {
    const mid = pointAtDistanceAlongRoute(plan.segments, total / 2, cumulative);
    if (!mid || isNearExistingVia(mid.location, viaPoints)) return [];
    return [
      {
        id: `handle-mid-${mid.segmentIndex}`,
        location: mid.location,
        segmentIndex: mid.segmentIndex,
        alongMeters: mid.alongMeters,
      },
    ];
  }

  const usable = total - END_MARGIN_METERS * 2;
  const count = Math.min(
    MAX_HANDLES,
    Math.max(1, Math.round(usable / HANDLE_SPACING_METERS)),
  );

  const handles: PathHandle[] = [];

  for (let i = 0; i < count; i += 1) {
    // Equal fractions across the usable middle of the route.
    const fraction = (i + 1) / (count + 1);
    const at = END_MARGIN_METERS + usable * fraction;
    const hit = pointAtDistanceAlongRoute(plan.segments, at, cumulative);
    if (!hit) continue;
    if (isNearExistingVia(hit.location, viaPoints)) continue;

    // Skip if too close to the previous accepted handle.
    const prev = handles[handles.length - 1];
    if (prev && hit.alongMeters - prev.alongMeters < HANDLE_SPACING_METERS * 0.55) {
      continue;
    }

    handles.push({
      id: `handle-${i}-s${hit.segmentIndex}-m${Math.round(hit.alongMeters)}`,
      location: hit.location,
      segmentIndex: hit.segmentIndex,
      alongMeters: hit.alongMeters,
    });
  }

  return handles;
}

/** Visit order for GraphHopper: stable sequence, never nearest-on-path. */
export function sortViasBySequence(vias: ViaWaypoint[]): ViaWaypoint[] {
  return [...vias].sort((a, b) => {
    if (a.sequence !== b.sequence) return a.sequence - b.sequence;
    return a.id.localeCompare(b.id);
  });
}

/** @deprecated Prefer sortViasBySequence — kept for older call sites/tests. */
export function sortViasAlongRoute(
  vias: ViaWaypoint[],
  _plan: RoutePlan | null,
): ViaWaypoint[] {
  void _plan;
  return sortViasBySequence(vias);
}

export function normalizeViaPoints(
  vias: Array<{ id: string; location: LatLng; sequence?: number }>,
): ViaWaypoint[] {
  return sortViasBySequence(
    vias.map((via, index) => ({
      id: via.id,
      location: via.location,
      sequence:
        typeof via.sequence === "number" && Number.isFinite(via.sequence)
          ? via.sequence
          : index * 1000,
    })),
  );
}

/**
 * Indices of vias that the rebuilt path does not pass near.
 * Used to detect GraphHopper responses that effectively skipped waypoints.
 */
export function findNeglectedViaIndices(
  vias: LatLng[],
  segments: RouteSegment[],
  maxMeters = VIA_ON_PATH_MAX_METERS,
): number[] {
  if (!vias.length || !segments.length) return vias.map((_, index) => index);

  const neglected: number[] = [];
  for (let index = 0; index < vias.length; index += 1) {
    const match = getNearestSegmentMatch(vias[index], segments);
    if (match.distanceMeters > maxMeters) {
      neglected.push(index);
    }
  }
  return neglected;
}

export function upsertViaFromHandle(
  vias: ViaWaypoint[],
  handle: PathHandle,
  droppedAt: LatLng,
  _plan: RoutePlan | null = null,
): ViaWaypoint[] {
  void _plan;
  // Tiny epsilon so two drops from nearby handles keep a deterministic order.
  const sequence =
    handle.alongMeters +
    vias.filter((via) => Math.abs(via.sequence - handle.alongMeters) < 1).length *
      0.01;

  const next: ViaWaypoint[] = [
    ...vias,
    { id: createId(), location: droppedAt, sequence },
  ];
  return sortViasBySequence(next);
}

export function updateViaLocation(
  vias: ViaWaypoint[],
  viaId: string,
  location: LatLng,
  _plan: RoutePlan | null = null,
): ViaWaypoint[] {
  void _plan;
  // Keep sequence so dragging off-path for a detour does not reorder visit list.
  return vias.map((via) =>
    via.id === viaId ? { ...via, location } : via,
  );
}

export function removeVia(vias: ViaWaypoint[], viaId: string): ViaWaypoint[] {
  return vias.filter((via) => via.id !== viaId);
}

export function viasSignature(vias: ViaWaypoint[]): string {
  return sortViasBySequence(vias)
    .map(
      (via) =>
        `${via.id}:${via.location.lat.toFixed(5)},${via.location.lng.toFixed(5)}`,
    )
    .join("|");
}

export function applySnappedViaLocations(
  vias: ViaWaypoint[],
  snapped: LatLng[],
): ViaWaypoint[] {
  const ordered = sortViasBySequence(vias);
  if (snapped.length !== ordered.length) return ordered;
  return ordered.map((via, index) => ({
    ...via,
    location: snapped[index],
  }));
}
