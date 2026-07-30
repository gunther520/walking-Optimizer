import { NextResponse } from "next/server";

import { fetchWalkingRoute } from "@/lib/graphhopper";
import { buildRoutePlan } from "@/lib/optimizer";
import { getDefaultSpeedBounds } from "@/lib/training";
import {
  dedupeHazards,
  filterHazardsOnPath,
  findOSMHazardsAlongRoute,
} from "@/lib/osm-hazards";
import type { WorkoutLevel, WorkoutProfile } from "@/types/workout";

type RouteRequestBody = {
  start: { lat: number; lng: number };
  end: { lat: number; lng: number };
  profile: {
    age: number;
    weightKg: number;
    restingHr?: number;
    workoutLevel: WorkoutLevel;
    minSpeedMps?: number;
    maxSpeedMps?: number;
  };
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RouteRequestBody;
    const defaults = getDefaultSpeedBounds(body.profile.workoutLevel);

    const profile: WorkoutProfile = {
      age: Number(body.profile.age),
      weightKg: Number(body.profile.weightKg),
      restingHr: Number(body.profile.restingHr ?? 60),
      workoutLevel: body.profile.workoutLevel,
      minSpeedMps: Number(body.profile.minSpeedMps ?? defaults.minSpeedMps),
      maxSpeedMps: Number(body.profile.maxSpeedMps ?? defaults.maxSpeedMps),
    };

    if (!body.start || !body.end) {
      return NextResponse.json(
        { error: "Start and end points are required." },
        { status: 400 },
      );
    }

    const route = await fetchWalkingRoute(body.start, body.end);
    const osm = await findOSMHazardsAlongRoute(route.points, route.segments);

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

    return NextResponse.json({
      ...plan,
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
