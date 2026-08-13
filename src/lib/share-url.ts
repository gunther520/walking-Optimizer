import { destinationPoint, parseWalkShape, type WalkShape } from "@/lib/time-budget";
import type { LatLng, RoutePreference } from "@/types/workout";

export type ShareWalkState = {
  start: LatLng;
  end: LatLng | null;
  headingDeg: number | null;
  vias: LatLng[];
  walkShape: WalkShape;
  targetMinutes: number;
  loopSeed: number;
  routePreference: RoutePreference;
};

export type ShareWalkInput = {
  start: LatLng | null;
  end: LatLng | null;
  headingDeg?: number | null;
  vias: LatLng[];
  walkShape: WalkShape;
  targetMinutes: number;
  loopSeed: number;
  routePreference: RoutePreference;
};

/** ~1.1 m — compact enough for a URL, stable enough to rebuild. */
function roundCoord(value: number) {
  return Math.round(value * 1e5) / 1e5;
}

function formatCoord(point: LatLng) {
  return `${roundCoord(point.lat)},${roundCoord(point.lng)}`;
}

function parseCoordPair(raw: string | null): LatLng | null {
  if (!raw) return null;
  const [latRaw, lngRaw] = raw.split(",");
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function parseWalkShapeParam(value: string | null): WalkShape {
  if (value === "ob" || value === "out" || value === "out_and_back") {
    return "out_and_back";
  }
  if (value === "loop") return "loop";
  return parseWalkShape(value);
}

function parseRoutePreference(value: string | null): RoutePreference {
  if (value === "stairs" || value === "quiet" || value === "avoid_stairs") {
    return "avoid_stairs";
  }
  if (value === "flat" || value === "prefer_flat") return "prefer_flat";
  return "default";
}

function encodeWalkShape(shape: WalkShape) {
  if (shape === "out_and_back") return "ob";
  if (shape === "loop") return "loop";
  return "pt";
}

function encodeRoutePreference(preference: RoutePreference) {
  if (preference === "avoid_stairs") return "stairs";
  if (preference === "prefer_flat") return "flat";
  return null;
}

/** True when the query has a start coordinate (`s=`). */
export function hasShareSearch(search: string) {
  const q = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  return parseCoordPair(q.get("s")) != null;
}

export function parseShareSearch(search: string): ShareWalkState | null {
  const q = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  const start = parseCoordPair(q.get("s"));
  if (!start) return null;

  const walkShape = parseWalkShapeParam(q.get("w"));
  const end = parseCoordPair(q.get("e"));
  const headingRaw = Number(q.get("h"));
  const headingDeg =
    Number.isFinite(headingRaw) && q.has("h")
      ? ((headingRaw % 360) + 360) % 360
      : null;
  const minutesRaw = Number(q.get("t"));
  const seedRaw = Number(q.get("k"));
  const vias = (q.get("v") ?? "")
    .split(";")
    .map((part) => parseCoordPair(part))
    .filter((point): point is LatLng => point != null);

  return {
    start,
    end: walkShape === "loop" ? null : end,
    headingDeg,
    vias,
    walkShape,
    targetMinutes: Number.isFinite(minutesRaw)
      ? Math.min(180, Math.max(8, minutesRaw))
      : 40,
    loopSeed: Number.isFinite(seedRaw) ? Math.max(0, Math.round(seedRaw)) : 0,
    routePreference: parseRoutePreference(q.get("p")),
  };
}

export function buildShareSearch(state: ShareWalkInput): string {
  if (!state.start) return "";

  const q = new URLSearchParams();
  q.set("s", formatCoord(state.start));

  if (state.walkShape !== "point_to_point") {
    q.set("w", encodeWalkShape(state.walkShape));
    q.set(
      "t",
      String(Math.round(Math.min(180, Math.max(8, state.targetMinutes)))),
    );
  }

  if (state.walkShape !== "loop" && state.end) {
    q.set("e", formatCoord(state.end));
  }

  if (
    state.walkShape === "loop" &&
    state.headingDeg != null &&
    Number.isFinite(state.headingDeg)
  ) {
    q.set("h", String(Math.round(state.headingDeg) % 360));
  }

  if (state.walkShape === "loop" && state.loopSeed) {
    q.set("k", String(Math.round(state.loopSeed)));
  }

  const preference = encodeRoutePreference(state.routePreference);
  if (preference) q.set("p", preference);

  if (state.vias.length) {
    q.set("v", state.vias.map(formatCoord).join(";"));
  }

  // Keep commas/semicolons readable in the address bar.
  return q.toString().replace(/%2C/gi, ",").replace(/%3B/gi, ";");
}

export function shareUrlFromState(
  origin: string,
  pathname: string,
  state: ShareWalkInput,
) {
  const search = buildShareSearch(state);
  return `${origin}${pathname}${search ? `?${search}` : ""}`;
}

export function applyShareToHistory(search: string) {
  if (typeof window === "undefined") return;
  const next = search
    ? `${window.location.pathname}?${search}`
    : window.location.pathname;
  const current = `${window.location.pathname}${window.location.search}`;
  if (current !== next) {
    window.history.replaceState(null, "", next);
  }
}

/** Reconstruct a heading marker ~280 m from start so the map can show it. */
export function headingPointFromShare(
  start: LatLng,
  headingDeg: number | null,
): LatLng | null {
  if (headingDeg == null || !Number.isFinite(headingDeg)) return null;
  return destinationPoint(start, headingDeg, 280);
}
