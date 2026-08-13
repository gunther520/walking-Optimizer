import type { LatLng, RoutePlan } from "@/types/workout";
import { formatDistance } from "@/lib/route-math";

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatCoord(value: number) {
  return value.toFixed(6);
}

function waypointXml(point: LatLng, name: string) {
  const ele =
    point.ele != null && Number.isFinite(point.ele)
      ? `\n    <ele>${point.ele.toFixed(1)}</ele>`
      : "";
  return `  <wpt lat="${formatCoord(point.lat)}" lon="${formatCoord(point.lng)}">
    <name>${escapeXml(name)}</name>${ele}
  </wpt>`;
}

function trackPointXml(point: LatLng) {
  const ele =
    point.ele != null && Number.isFinite(point.ele)
      ? `<ele>${point.ele.toFixed(1)}</ele>`
      : "";
  return `      <trkpt lat="${formatCoord(point.lat)}" lon="${formatCoord(point.lng)}">${ele}</trkpt>`;
}

export function buildRouteGpx(
  plan: RoutePlan,
  options?: {
    start?: LatLng | null;
    end?: LatLng | null;
    vias?: LatLng[];
    name?: string;
  },
) {
  const name =
    options?.name ??
    `Walking optimizer ${formatDistance(plan.totalDistanceMeters)}`;
  const start = options?.start ?? plan.points[0];
  const end = options?.end ?? plan.points[plan.points.length - 1];
  const vias = options?.vias ?? [];

  const waypoints = [
    start ? waypointXml(start, "Start") : "",
    ...vias.map((via, index) => waypointXml(via, `Via ${index + 1}`)),
    end ? waypointXml(end, "End") : "",
  ]
    .filter(Boolean)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Walking Optimizer" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${escapeXml(name)}</name>
    <desc>${escapeXml(
      `Estimated ${formatDistance(plan.totalDistanceMeters)} aerobic walking route.`,
    )}</desc>
  </metadata>
${waypoints}
  <trk>
    <name>${escapeXml(name)}</name>
    <trkseg>
${plan.points.map(trackPointXml).join("\n")}
    </trkseg>
  </trk>
</gpx>
`;
}

export function gpxFilename(plan: RoutePlan) {
  const stamp = new Date().toISOString().slice(0, 10);
  const meters = Math.round(plan.totalDistanceMeters);
  return `walking-optimizer-${stamp}-${meters}m.gpx`;
}

export function downloadRouteGpx(
  plan: RoutePlan,
  options?: {
    start?: LatLng | null;
    end?: LatLng | null;
    vias?: LatLng[];
    name?: string;
  },
) {
  const xml = buildRouteGpx(plan, options);
  const blob = new Blob([xml], { type: "application/gpx+xml" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = gpxFilename(plan);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
