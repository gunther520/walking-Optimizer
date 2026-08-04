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
import {
  paceDashArray,
  pacePatternName,
  paceRoleLabel,
  paceStrokeColor,
} from "@/lib/pace-style";
import type { PathHandle, ViaWaypoint } from "@/lib/via-points";

type LeafletMapProps = {
  start: LatLng | null;
  end: LatLng | null;
  routePoints: LatLng[];
  segmentSpeedPlan: SegmentPlan[] | null;
  hazards: RouteHazard[];
  currentPosition: LatLng | null;
  onPickPoint: (point: LatLng) => void;
  /** When true, map clicks set start/end. When false, clicks won't change endpoints. */
  pickingEnabled: boolean;
  viaPoints: ViaWaypoint[];
  pathHandles: PathHandle[];
  onViaMoved: (viaId: string, location: LatLng) => void;
  onViaRemoved: (viaId: string) => void;
  onHandleDropped: (handle: PathHandle, location: LatLng) => void;
  /** Bump to re-fit the camera to the route. */
  fitNonce: number;
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
  fitNonce,
}: {
  routePoints: LatLng[];
  fitNonce: number;
}) {
  const map = useMap();

  useEffect(() => {
    if (!fitNonce || routePoints.length < 2) return;

    const bounds = L.latLngBounds(
      routePoints.map((point) => [point.lat, point.lng] as [number, number]),
    );
    map.fitBounds(bounds, {
      padding: [48, 48],
      maxZoom: 17,
      animate: true,
    });
  }, [fitNonce, map, routePoints]);

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

function createViaIcon() {
  return L.divIcon({
    className: "via-icon",
    html: `
      <div style="
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: #f59e0b;
        border: 3px solid #fff;
        box-shadow: 0 1px 5px rgba(0,0,0,0.45);
        transform: translate(-50%, -50%);
        cursor: grab;
      "></div>
    `,
    iconSize: [22, 22],
    iconAnchor: [0, 0],
  });
}

function createHandleIcon() {
  return L.divIcon({
    className: "path-handle-icon",
    html: `
      <div style="
        width: 22px;
        height: 22px;
        border-radius: 5px;
        background: #1d4ed8;
        border: 3px solid #fff;
        box-shadow: 0 1px 6px rgba(0,0,0,0.5);
        transform: translate(-50%, -50%);
        cursor: grab;
        display: grid;
        place-items: center;
        color: #fff;
        font-size: 12px;
        font-weight: 800;
        line-height: 1;
      ">⋮⋮</div>
    `,
    iconSize: [22, 22],
    iconAnchor: [0, 0],
  });
}

function DraggableViaMarker({
  via,
  onMoved,
  onRemoved,
}: {
  via: ViaWaypoint;
  onMoved: (viaId: string, location: LatLng) => void;
  onRemoved: (viaId: string) => void;
}) {
  const map = useMap();
  const icon = useMemo(() => createViaIcon(), []);

  return (
    <Marker
      position={[via.location.lat, via.location.lng]}
      icon={icon}
      draggable
      zIndexOffset={800}
      eventHandlers={{
        dragstart() {
          map.dragging.disable();
        },
        dragend(event) {
          map.dragging.enable();
          const marker = event.target as L.Marker;
          const { lat, lng } = marker.getLatLng();
          onMoved(via.id, { lat, lng });
        },
        dblclick(event) {
          L.DomEvent.stopPropagation(event);
          onRemoved(via.id);
        },
      }}
    >
      <Tooltip direction="top" offset={[0, -10]}>
        Via — drag to dodge a blockage · double-click to remove
      </Tooltip>
    </Marker>
  );
}

function DraggableHandleMarker({
  handle,
  onDropped,
}: {
  handle: PathHandle;
  onDropped: (handle: PathHandle, location: LatLng) => void;
}) {
  const map = useMap();
  const icon = useMemo(() => createHandleIcon(), []);

  return (
    <Marker
      position={[handle.location.lat, handle.location.lng]}
      icon={icon}
      draggable
      zIndexOffset={700}
      eventHandlers={{
        dragstart() {
          map.dragging.disable();
        },
        dragend(event) {
          map.dragging.enable();
          const marker = event.target as L.Marker;
          const { lat, lng } = marker.getLatLng();
          onDropped(handle, { lat, lng });
        },
      }}
    >
      <Tooltip direction="top" offset={[0, -8]}>
        Drag off the blocked road to reroute
      </Tooltip>
    </Marker>
  );
}

export function LeafletMap({
  start,
  end,
  routePoints,
  segmentSpeedPlan,
  hazards,
  currentPosition,
  onPickPoint,
  pickingEnabled,
  viaPoints,
  pathHandles,
  onViaMoved,
  onViaRemoved,
  onHandleDropped,
  fitNonce,
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

  function getSegmentStyle(paceRole: PaceRole | undefined, speedMps: number) {
    const role: PaceRole =
      paceRole ??
      (() => {
        const fraction = (speedMps - minSpeed) / speedRange;
        if (fraction < 0.33) return "rest";
        if (fraction < 0.66) return "steady";
        return "push";
      })();

    return {
      color: paceStrokeColor(role),
      dashArray: paceDashArray(role),
      label: `${paceRoleLabel(role)} (${pacePatternName(role)})`,
      role,
    };
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
      <FitRouteBounds routePoints={routePoints} fitNonce={fitNonce} />
      <ClickHandler onPickPoint={onPickPoint} enabled={pickingEnabled} />

      {segmentSpeedPlan && segmentSpeedPlan.length && routePoints.length > 2
        ? (() => {
            const groups: {
              key: string;
              color: string;
              dashArray?: string;
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

              const style = getSegmentStyle(prev.paceRole, prev.targetSpeedMps);
              const positions: [number, number][] = [];
              for (let p = runStart; p <= i; p += 1) {
                const point = routePoints[p];
                if (point) positions.push([point.lat, point.lng]);
              }
              if (positions.length > 1) {
                groups.push({
                  key: `${runStart}-${i}-${prev.paceRole}`,
                  color: style.color,
                  dashArray: style.dashArray,
                  label: style.label,
                  positions,
                });
              }
              runStart = i;
            }

            return groups.map((group) => (
              <Polyline
                key={group.key}
                positions={group.positions}
                pathOptions={{
                  color: group.color,
                  weight: group.dashArray ? 6 : 7,
                  dashArray: group.dashArray,
                }}
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

      {pathHandles.map((handle) => (
        <DraggableHandleMarker
          key={handle.id}
          handle={handle}
          onDropped={onHandleDropped}
        />
      ))}

      {viaPoints.map((via) => (
        <DraggableViaMarker
          key={via.id}
          via={via}
          onMoved={onViaMoved}
          onRemoved={onViaRemoved}
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
