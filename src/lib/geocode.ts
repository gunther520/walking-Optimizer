import type { LatLng } from "@/types/workout";

export type GeocodeHit = {
  label: string;
  location: LatLng;
};

type NominatimHit = {
  lat?: string;
  lon?: string;
  display_name?: string;
};

export function parseNominatimResults(raw: unknown): GeocodeHit[] {
  if (!Array.isArray(raw)) return [];
  const hits: GeocodeHit[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as NominatimHit;
    const lat = Number(rec.lat);
    const lng = Number(rec.lon);
    const label = rec.display_name?.trim() ?? "";
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !label) continue;
    hits.push({ label, location: { lat, lng } });
  }
  return hits;
}
