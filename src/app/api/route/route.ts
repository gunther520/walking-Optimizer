import { NextResponse } from "next/server";

import { fetchWalkingRoute, MAX_AVOIDANCE_VIAS } from "@/lib/graphhopper";
import { buildRoutePlan } from "@/lib/optimizer";
import { routePreferenceLabel } from "@/lib/route-preference";
import { getDefaultSpeedBounds } from "@/lib/training";
import {
  dedupeHazards,
  filterHazardsOnPath,
  findOSMHazardsAlongRoute,
} from "@/lib/osm-hazards";
import type {
  RoutePreference,
  WorkoutLevel,
  WorkoutProfile,
} from "@/types/workout";

type RouteRequestBody = {
  start: { lat: number; lng: number };
  end: { lat: number; lng: number };
  vias?: Array<{ lat: number; lng: number }>;
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

    if (!body.start || !body.end) {
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

    const route = await fetchWalkingRoute(
      body.start,
      body.end,
      routePreference,
      vias,
    );

    // Never block the walk plan on Overpass — GraphHopper hazards alone are enough.
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
    const osm = await Promise.race([
      findOSMHazardsAlongRoute(route.points, route.segments),
      new Promise<typeof osmTimedOut>((resolve) => {
        setTimeout(() => resolve(osmTimedOut), 7000);
      }),
    ]);

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

    const degradedNote = osm.debug.overpassOk
      ? []
      : [
          `OSM hazard lookup degraded${
            osm.debug.overpassError ? `: ${osm.debug.overpassError}` : ""
          }. Plan still built with GraphHopper on-path stairs.`,
        ];

    const preferenceNotes = [
      `Path preference: ${routePreferenceLabel(route.usedPreference)}`,
      ...(vias.length
        ? [
            `Avoidance vias: ${vias.length} waypoint(s) forced into the path` +
              (vias.length > 3
                ? " (chained GraphHopper requests for free-tier 5-location limit)"
                : ""),
          ]
        : []),
      ...(route.fallbackNote ? [route.fallbackNote] : []),
    ];

    return NextResponse.json({
      ...plan,
      usedRoutePreference: route.usedPreference,
      snappedVias: route.snappedVias,
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
