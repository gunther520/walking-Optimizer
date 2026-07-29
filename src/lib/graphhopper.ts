import { buildSegments } from "@/lib/route-math";
import type { LatLng } from "@/types/workout";

type GraphHopperInstruction = {
  text: string;
};

type GraphHopperPath = {
  points: {
    coordinates: [number, number, number?][];
  };
  instructions?: GraphHopperInstruction[];
};

type GraphHopperResponse = {
  paths?: GraphHopperPath[];
  message?: string;
  hints?: { message?: string }[];
};

export async function fetchWalkingRoute(start: LatLng, end: LatLng) {
  const apiKey = process.env.GRAPHOPPER_KEY;

  if (!apiKey) {
    throw new Error("Missing GRAPHOPPER_KEY environment variable.");
  }

  const response = await fetch(
    `https://graphhopper.com/api/1/route?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        profile: "foot",
        points: [
          [start.lng, start.lat],
          [end.lng, end.lat],
        ],
        elevation: true,
        instructions: true,
        calc_points: true,
        points_encoded: false,
      }),
      cache: "no-store",
    },
  );

  const data = (await response.json()) as GraphHopperResponse;

  if (!response.ok) {
    throw new Error(
      data.message ??
        data.hints?.[0]?.message ??
        "Unable to fetch route from GraphHopper.",
    );
  }

  const path = data.paths?.[0];
  if (!path?.points?.coordinates?.length) {
    throw new Error("GraphHopper returned an empty walking route.");
  }

  const points = path.points.coordinates.map(([lng, lat, ele]) => ({
    lat,
    lng,
    ele,
  }));

  return {
    points,
    segments: buildSegments(points),
    instructions:
      path.instructions?.map((instruction) => instruction.text).filter(Boolean) ??
      [],
  };
}
