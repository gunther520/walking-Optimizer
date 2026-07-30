"use client";

import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";

import type { LatLng, OSMHazardKind, PaceRole, RouteHazard, SegmentPlan } from "@/types/workout";
import type { Map as LeafletMapType } from "leaflet";

type LeafletMapProps = {
  start: LatLng | null;
  end: LatLng | null;
  routePoints: LatLng[];
  segmentSpeedPlan: SegmentPlan[] | null;
  hazards: RouteHazard[];
  currentPosition: LatLng | null;
  onPickPoint: (point: LatLng) => void;
  /** When true: no point picking, map interactions frozen, camera fits the route. */
  locked: boolean;
};

function ClickHandler({
  onPickPoint,
  enabled,
}: {
  onPickPoint: (point: LatLng) => void;
  enabled: boolean;
}) {
  useMapEvents({
    click(event) {
      if (!enabled) return;
      onPickPoint({
        lat: event.latlng.lat,
        lng: event.latlng.lng,
      });
    },
  });

  return null;
}

function FitRouteBounds({
  routePoints,
  locked,
}: {
  routePoints: LatLng[];
  locked: boolean;
}) {
  const map = useMap();

  useEffect(() => {
    if (!locked || routePoints.length < 2) return;

    const bounds = L.latLngBounds(
      routePoints.map((point) => [point.lat, point.lng] as [number, number]),
    );
    map.fitBounds(bounds, {
      padding: [48, 48],
      maxZoom: 17,
      animate: true,
    });
  }, [locked, map, routePoints]);

  return null;
}

function MapInteractionLock({ locked }: { locked: boolean }) {
  const map = useMap();

  useEffect(() => {
    if (locked) {
      map.dragging.disable();
      map.scrollWheelZoom.disable();
      map.doubleClickZoom.disable();
      map.boxZoom.disable();
      map.keyboard.disable();
      map.touchZoom.disable();
      const container = map.getContainer();
      container.style.cursor = "default";
    } else {
      map.dragging.enable();
      map.scrollWheelZoom.enable();
      map.doubleClickZoom.enable();
      map.boxZoom.enable();
      map.keyboard.enable();
      map.touchZoom.enable();
      const container = map.getContainer();
      container.style.cursor = "";
    }
  }, [locked, map]);

  return null;
}

function createHazardIcon(kind: OSMHazardKind) {
  if (kind === "stairs") {
    return L.divIcon({
      className: "hazard-icon",
      html: `
        <div style="
          width: 28px;
          height: 28px;
          display: grid;
          place-items: center;
          font-size: 24px;
          line-height: 1;
          color: #7c3aed;
          text-shadow: 0 0 2px #fff, 0 1px 2px rgba(0,0,0,0.35);
          transform: translate(-50%, -50%);
        ">★</div>
      `,
      iconSize: [28, 28],
      iconAnchor: [0, 0],
    });
  }

  if (kind === "elevator") {
    return L.divIcon({
      className: "hazard-icon",
      html: `
        <div style="
          width: 0;
          height: 0;
          border-left: 12px solid transparent;
          border-right: 12px solid transparent;
          border-bottom: 22px solid #0f766e;
          filter: drop-shadow(0 1px 2px rgba(0,0,0,0.35));
          transform: translate(-50%, -50%);
        "></div>
      `,
      iconSize: [24, 22],
      iconAnchor: [0, 0],
    });
  }

  return L.divIcon({
    className: "hazard-icon",
    html: `
      <div style="
        width: 18px;
        height: 22px;
        background: #e11d48;
        border: 2px solid #fff;
        border-radius: 2px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.35);
        transform: translate(-50%, -50%);
      "></div>
    `,
    iconSize: [18, 22],
    iconAnchor: [0, 0],
  });
}

export function LeafletMap({
  start,
  end,
  routePoints,
  segmentSpeedPlan,
  hazards,
  currentPosition,
  onPickPoint,
  locked,
}: LeafletMapProps) {
  const mapRef = useRef<LeafletMapType | null>(null);
  const mounted = typeof window !== "undefined";
  const hazardIcons = useMemo(
    () => ({
      stairs: createHazardIcon("stairs"),
      elevator: createHazardIcon("elevator"),
      trafficSignal: createHazardIcon("trafficSignal"),
    }),
    [],
  );

  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  if (!mounted) {
    return null;
  }

  const speedValues = segmentSpeedPlan?.map((p) => p.targetSpeedMps) ?? [];
  const minSpeed = speedValues.length ? Math.min(...speedValues) : 0;
  const maxSpeed = speedValues.length ? Math.max(...speedValues) : 0;
  const speedRange = Math.max(1e-6, maxSpeed - minSpeed);

  function getSegmentColorAndLabel(paceRole: PaceRole | undefined, speedMps: number) {
    if (paceRole === "rest") {
      return { color: "#2563eb", label: "Rest / recover" };
    }
    if (paceRole === "push") {
      return { color: "#ef4444", label: "Push (cardio)" };
    }
    if (paceRole === "steady") {
      return { color: "#22c55e", label: "Steady cardio" };
    }

    const fraction = (speedMps - minSpeed) / speedRange;
    if (fraction < 0.33) return { color: "#2563eb", label: "Rest / recover" };
    if (fraction < 0.66) return { color: "#22c55e", label: "Steady cardio" };
    return { color: "#ef4444", label: "Push (cardio)" };
  }

  return (
    <MapContainer
      center={[22.3193, 114.1694]}
      zoom={13}
      scrollWheelZoom
      style={{ height: "100%", width: "100%" }}
      ref={(map) => {
        mapRef.current = map;
      }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapInteractionLock locked={locked} />
      <FitRouteBounds routePoints={routePoints} locked={locked} />
      <ClickHandler onPickPoint={onPickPoint} enabled={!locked} />

      {segmentSpeedPlan && segmentSpeedPlan.length && routePoints.length > 2
        ? (() => {
            const groups: {
              key: string;
              color: string;
              label: string;
              positions: [number, number][];
            }[] = [];

            let runStart = 0;
            for (let i = 1; i <= segmentSpeedPlan.length; i += 1) {
              const prev = segmentSpeedPlan[i - 1];
              const curr = segmentSpeedPlan[i];
              const roleChanged =
                !curr ||
                curr.paceRole !== prev.paceRole ||
                Math.abs(curr.targetSpeedMps - prev.targetSpeedMps) > 0.35;

              if (!roleChanged) continue;

              const { color, label } = getSegmentColorAndLabel(
                prev.paceRole,
                prev.targetSpeedMps,
              );
              const positions: [number, number][] = [];
              for (let p = runStart; p <= i; p += 1) {
                const point = routePoints[p];
                if (point) positions.push([point.lat, point.lng]);
              }
              if (positions.length > 1) {
                groups.push({
                  key: `${runStart}-${i}-${prev.paceRole}`,
                  color,
                  label,
                  positions,
                });
              }
              runStart = i;
            }

            return groups.map((group) => (
              <Polyline
                key={group.key}
                positions={group.positions}
                pathOptions={{ color: group.color, weight: 6 }}
              >
                <Tooltip direction="top" offset={[0, -10]} opacity={1} permanent={false}>
                  {group.label}
                </Tooltip>
              </Polyline>
            ));
          })()
        : routePoints.length > 1 ? (
            <Polyline
              positions={routePoints.map(
                (point) => [point.lat, point.lng] as [number, number],
              )}
              pathOptions={{ color: "#2f6fed", weight: 5 }}
            />
          ) : null}

      {hazards.map((hazard) => (
        <Marker
          key={`${hazard.kind}-${hazard.segmentIndex}-${hazard.location.lat.toFixed(5)}-${hazard.location.lng.toFixed(5)}`}
          position={[hazard.location.lat, hazard.location.lng]}
          icon={hazardIcons[hazard.kind]}
          zIndexOffset={500}
        />
      ))}

      {start ? (
        <CircleMarker center={[start.lat, start.lng]} radius={9} pathOptions={{ color: "#16a34a" }}>
          <Tooltip direction="top" offset={[0, -10]} permanent>
            Start
          </Tooltip>
        </CircleMarker>
      ) : null}
      {end ? (
        <CircleMarker center={[end.lat, end.lng]} radius={9} pathOptions={{ color: "#dc2626" }}>
          <Tooltip direction="top" offset={[0, -10]} permanent>
            End
          </Tooltip>
        </CircleMarker>
      ) : null}
      {currentPosition ? (
        <CircleMarker
          center={[currentPosition.lat, currentPosition.lng]}
          radius={8}
          pathOptions={{ color: "#f59e0b", fillColor: "#f59e0b", fillOpacity: 0.9 }}
        >
          <Tooltip direction="top" offset={[0, -10]}>
            You
          </Tooltip>
        </CircleMarker>
      ) : null}
    </MapContainer>
  );
}
