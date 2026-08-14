import { NextResponse } from "next/server";

import { parseNominatimResults } from "@/lib/geocode";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT =
  "WalkingOptimizer/1.0 (https://github.com/gunther520/walking-Optimizer)";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const nominatim = new URL(NOMINATIM_URL);
  nominatim.searchParams.set("q", query.slice(0, 200));
  nominatim.searchParams.set("format", "jsonv2");
  nominatim.searchParams.set("limit", "6");
  nominatim.searchParams.set("addressdetails", "0");

  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lng") ?? url.searchParams.get("lon"));
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    nominatim.searchParams.set("lat", String(lat));
    nominatim.searchParams.set("lon", String(lon));
  }

  try {
    const response = await fetch(nominatim, {
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
      cache: "no-store",
    });
    if (!response.ok) {
      return NextResponse.json(
        { error: "Place search is busy. Try again in a moment." },
        { status: 502 },
      );
    }
    const raw: unknown = await response.json();
    return NextResponse.json({ results: parseNominatimResults(raw) });
  } catch {
    return NextResponse.json(
      { error: "Could not search places right now." },
      { status: 502 },
    );
  }
}
