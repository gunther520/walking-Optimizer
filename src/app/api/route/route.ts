import { NextResponse } from "next/server";

import { fetchLoopRoute, fetchWalkingRoute, MAX_AVOIDANCE_VIAS } from "@/lib/graphhopper";
import { buildRoutePlan } from "@/lib/optimizer";
import { routePreferenceLabel } from "@/lib/route-preference";
import { getDefaultSpeedBounds } from "@/lib/training";
import {
  outAndBackTurnaroundMeters,
  parseWalkShape,
  targetDistanceMeters,
  typicalWalkSpeedMps,
  type WalkShape,
} from "@/lib/time-budget";
import {
  buildCumulativeDistances,
  pointAtDistanceAlongRoute,
} from "@/lib/via-points";
import {
  dedupeHazards,
  filterHazardsOnPath,
  findOSMHazardsAlongRoute,
} from "@/lib/osm-hazards";
import type {
  LatLng,
  RoutePreference,
  WorkoutLevel,
  WorkoutProfile,
} from "@/types/workout";

type RouteRequestBody = {
  start: { lat: number; lng: number };
  end?: { lat: number; lng: number };
  direction?: { lat: number; lng: number };
  vias?: Array<{ lat: number; lng: number }>;
  walkShape?: WalkShape;
  targetMinutes?: number;
  loopSeed?: number;
  heading?: number;
  /** Default true. Via-only rebuilds skip Overpass to save time and credits. */
  includeOsmHazards?: boolean;
  profile: {
    age: number;
    weightKg: number;
    restingHr?: number;
    workoutLevel: WorkoutLevel;
    minSpeedMps?: number;
    maxSpeedMps?: number;
    effortPreference?: "conserve" | "balanced" | "challenge";
    routePreference?: RoutePreference;
  };
};

function parseRoutePreference(value: unknown): RoutePreference {
  if (
    value === "default" ||
    value === "avoid_stairs" ||
    value === "prefer_flat"
  ) {
    return value;
  }
  return "default";
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RouteRequestBody;
    const defaults = getDefaultSpeedBounds(body.profile.workoutLevel);

    const preference = body.profile.effortPreference;
    const effortPreference =
      preference === "conserve" ||
      preference === "balanced" ||
      preference === "challenge"
        ? preference
        : "balanced";
    const routePreference = parseRoutePreference(body.profile.routePreference);

    const profile: WorkoutProfile = {
      age: Number(body.profile.age),
      weightKg: Number(body.profile.weightKg),
      restingHr: Number(body.profile.restingHr ?? 60),
      workoutLevel: body.profile.workoutLevel,
      minSpeedMps: Number(body.profile.minSpeedMps ?? defaults.minSpeedMps),
      maxSpeedMps: Number(body.profile.maxSpeedMps ?? defaults.maxSpeedMps),
      effortPreference,
      routePreference,
    };

    const walkShape = parseWalkShape(body.walkShape);
    const targetMinutes = Number(body.targetMinutes ?? 40);
    const loopSeed = Number(body.loopSeed ?? 0);
    const heading =
      typeof body.heading === "number" && Number.isFinite(body.heading)
        ? body.heading
        : undefined;

    if (!body.start) {
      return NextResponse.json(
        { error: "A start point is required." },
        { status: 400 },
      );
    }
    if (walkShape !== "loop" && !body.end && !body.direction) {
      return NextResponse.json(
        { error: "Start and end points are required." },
        { status: 400 },
      );
    }

    const vias = (body.vias ?? [])
      .filter(
        (via) =>
          typeof via?.lat === "number" &&
          typeof via?.lng === "number" &&
          Number.isFinite(via.lat) &&
          Number.isFinite(via.lng),
      )
      .slice(0, MAX_AVOIDANCE_VIAS);

    const includeOsmHazards = body.includeOsmHazards !== false;
    const targetMeters = targetDistanceMeters(
      targetMinutes,
      typicalWalkSpeedMps(profile.minSpeedMps, profile.maxSpeedMps),
    );

    type Routed = Awaited<ReturnType<typeof fetchWalkingRoute>>;
    let route: Routed;
    let turnaround: LatLng | undefined;
    const shapeNotes: string[] = [];

    if (walkShape === "loop") {
      if (vias.length) {
        route = await fetchWalkingRoute(body.start, body.start, routePreference, vias);
        shapeNotes.push(
          `Timed loop (~${Math.round(targetMinutes)} min) rebuilt through ${vias.length} via(s).`,
        );
      } else {
        route = await fetchLoopRoute(
          body.start,
          routePreference,
          targetMeters,
          Number.isFinite(loopSeed) ? loopSeed : 0,
          heading,
        );
        shapeNotes.push(`Timed loop targeting ~${Math.round(targetMinutes)} min.`);
      }
    } else if (walkShape === "out_and_back") {
      const direction = body.direction ?? body.end;
      if (!direction) {
        return NextResponse.json(
          { error: "Click a turnaround direction for the out-and-back walk." },
          { status: 400 },
        );
      }
      if (vias.length) {
        route = await fetchWalkingRoute(body.start, body.start, routePreference, vias);
        shapeNotes.push(
          `Out-and-back (~${Math.round(targetMinutes)} min) rebuilt through ${vias.length} via(s).`,
        );
      } else {
        const outbound = await fetchWalkingRoute(
          body.start,
          direction,
          routePreference,
          [],
        );
        const { totalMeters } = buildCumulativeDistances(outbound.segments);
        const along = outAndBackTurnaroundMeters(totalMeters, targetMeters);
        const hit = pointAtDistanceAlongRoute(outbound.segments, along);
        if (!hit) {
          return NextResponse.json(
            { error: "Could not place a turnaround on that direction." },
            { status: 400 },
          );
        }
        turnaround = hit.location;
        route = await fetchWalkingRoute(
          body.start,
          body.start,
          routePreference,
          [hit.location],
        );
        const short =
          totalMeters * 2 + 1 < targetMeters * 0.85
            ? ` Direction is shorter than the time budget — pick a farther point or use a loop.`
            : "";
        shapeNotes.push(
          `Out-and-back targeting ~${Math.round(targetMinutes)} min.${short}`,
        );
      }
    } else {
      if (!body.end) {
        return NextResponse.json(
          { error: "Start and end points are required." },
          { status: 400 },
        );
      }
      route = await fetchWalkingRoute(
        body.start,
        body.end,
        routePreference,
        vias,
      );
    }

    // Never block the walk plan on Overpass — GraphHopper hazards alone are enough.
    // Via-only rebuilds skip Overpass: stairs still come from GraphHopper road_class.
    const osmTimedOut = {
      hazards: [] as Awaited<
        ReturnType<typeof findOSMHazardsAlongRoute>
      >["hazards"],
      debug: {
        overpassOk: false,
        overpassError: "Overpass timed out; using GraphHopper hazards only.",
        rawOsmCount: 0,
        onPathOsmCount: 0,
      },
    };
    const osmSkipped = {
      hazards: [] as typeof osmTimedOut.hazards,
      debug: {
        overpassOk: true,
        overpassError: undefined as string | undefined,
        rawOsmCount: 0,
        onPathOsmCount: 0,
      },
    };
    const osm = includeOsmHazards
      ? await Promise.race([
          findOSMHazardsAlongRoute(route.points, route.segments),
          new Promise<typeof osmTimedOut>((resolve) => {
            setTimeout(() => resolve(osmTimedOut), 7000);
          }),
        ])
      : osmSkipped;

    const hazards = filterHazardsOnPath(
      dedupeHazards([...route.routeHazards, ...osm.hazards]),
      route.segments,
    );

    const plan = buildRoutePlan(
      route.points,
      route.segments,
      route.instructions,
      profile,
      hazards,
    );

    const degradedNote = includeOsmHazards
      ? osm.debug.overpassOk
        ? []
        : [
            `OSM hazard lookup degraded${
              osm.debug.overpassError ? `: ${osm.debug.overpassError}` : ""
            }. Plan still built with GraphHopper on-path stairs.`,
          ]
      : ["OSM lookup skipped on via adjustment (GraphHopper stairs still applied)."];

    const preferenceNotes = [
      `Path preference: ${routePreferenceLabel(route.usedPreference)}`,
      ...shapeNotes,
      ...(vias.length
        ? [
            `Avoidance vias: ${vias.length} waypoint(s) forced into the path` +
              (vias.length > 3
                ? " (chained GraphHopper requests for free-tier 5-location limit)"
                : ""),
          ]
        : []),
      ...(route.chunkStats && route.chunkStats.cached > 0
        ? [
            `GraphHopper: reused ${route.chunkStats.cached} unchanged path chunk(s), fetched ${route.chunkStats.fetched}.`,
          ]
        : []),
      ...(route.fallbackNote ? [route.fallbackNote] : []),
    ];

    return NextResponse.json({
      ...plan,
      usedRoutePreference: route.usedPreference,
      snappedVias: route.snappedVias,
      chunkStats: route.chunkStats,
      turnaround,
      walkShape,
      instructionSummary: [
        ...preferenceNotes,
        ...degradedNote,
        ...plan.instructionSummary,
      ],
      hazardDebug: {
        graphHopperCount: route.routeHazards.length,
        osmRawCount: osm.debug.rawOsmCount,
        osmOnPathCount: osm.debug.onPathOsmCount,
        overpassOk: osm.debug.overpassOk,
        overpassError: osm.debug.overpassError,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected route planning error.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
