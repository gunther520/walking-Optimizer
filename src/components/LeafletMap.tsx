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
import {
  FOLLOW_MIN_ZOOM,
  shouldPanToFollow,
} from "@/lib/walk-follow";
import type { PathHandle, ViaWaypoint } from "@/lib/via-points";
import { formatSplitLabel, type SplitMarker } from "@/lib/walk-splits";
import type { TurnGuidance, TurnSignKind } from "@/lib/turns";
import { turnSignKind } from "@/lib/turns";
import type { RejoinGuidance } from "@/lib/walk-follow";

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
  /** Walked portion of the route (clock or on-path GPS). */
  walkedPath?: LatLng[];
  walkerOnPath?: LatLng | null;
  /** Click the planned path to drop an avoidance via off that street. */
  onPathClicked?: (point: LatLng) => void;
  headingPoint?: LatLng | null;
  endLabel?: string;
  /** Pan the map to this GPS fix while follow is on. */
  followTarget?: LatLng | null;
  followEnabled?: boolean;
  /** Bump after Recenter so follow re-zooms even if the target did not move. */
  followNonce?: number;
  onFollowInterrupted?: () => void;
  /** Compass heading in degrees, 0 = north. */
  gpsHeadingDeg?: number | null;
  splitMarkers?: SplitMarker[];
  nextTurn?: TurnGuidance | null;
  rejoin?: RejoinGuidance | null;
  mapTheme?: "light" | "dark";
  /** Rotate the map so this geographic heading is screen-up. */
  headingUpDeg?: number | null;
  /** Bump when the map container size changes (e.g. walk nav). */
  layoutNonce?: number;
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

function FollowWalker({
  target,
  enabled,
  followNonce = 0,
  onFollowInterrupted,
}: {
  target: LatLng | null;
  enabled: boolean;
  followNonce?: number;
  onFollowInterrupted?: () => void;
}) {
  const map = useMap();
  const lastPanRef = useRef<LatLng | null>(null);
  const wasEnabledRef = useRef(false);

  useMapEvents({
    dragstart() {
      if (enabled) onFollowInterrupted?.();
    },
  });

  useEffect(() => {
    wasEnabledRef.current = false;
    lastPanRef.current = null;
  }, [followNonce]);

  useEffect(() => {
    if (!enabled || !target) {
      wasEnabledRef.current = false;
      lastPanRef.current = null;
      return;
    }

    const starting = !wasEnabledRef.current;
    wasEnabledRef.current = true;

    if (starting) {
      const zoom = Math.max(map.getZoom(), FOLLOW_MIN_ZOOM);
      map.setView([target.lat, target.lng], zoom, { animate: true });
      lastPanRef.current = target;
      return;
    }

    if (!shouldPanToFollow(lastPanRef.current, target)) return;
    lastPanRef.current = target;
    map.panTo([target.lat, target.lng], { animate: true, duration: 0.35 });
  }, [enabled, target, map, followNonce]);

  return null;
}

function InvalidateOnChange({ nonce }: { nonce: number }) {
  const map = useMap();
  useEffect(() => {
    const id = window.setTimeout(() => map.invalidateSize(), 80);
    return () => window.clearTimeout(id);
  }, [map, nonce]);
  return null;
}

function createYouIcon(headingDeg: number | null) {
  const rotation =
    headingDeg != null && Number.isFinite(headingDeg)
      ? `rotate(${Math.round(headingDeg)}deg)`
      : "none";
  const arrow =
    headingDeg != null && Number.isFinite(headingDeg)
      ? `<div style="
            position: absolute;
            top: -2px;
            left: 50%;
            width: 0;
            height: 0;
            border-left: 6px solid transparent;
            border-right: 6px solid transparent;
            border-bottom: 10px solid #d97706;
            transform: translate(-50%, -100%);
          "></div>`
      : "";

  return L.divIcon({
    className: "you-icon",
    html: `
      <div style="
        position: relative;
        width: 28px;
        height: 28px;
        transform: translate(-50%, -50%) ${rotation};
      ">
        ${arrow}
        <div style="
          width: 16px;
          height: 16px;
          margin: 6px auto 0;
          border-radius: 50%;
          background: #f59e0b;
          border: 2px solid #fff;
          box-shadow: 0 1px 4px rgba(0,0,0,0.35);
        "></div>
      </div>
    `,
    iconSize: [28, 28],
    iconAnchor: [0, 0],
  });
}

function createKmIcon(label: string) {
  return L.divIcon({
    className: "km-icon",
    html: `
      <div style="
        min-width: 22px;
        height: 22px;
        padding: 0 5px;
        display: grid;
        place-items: center;
        border-radius: 999px;
        background: #10213a;
        color: #fff;
        font-size: 11px;
        font-weight: 700;
        line-height: 1;
        box-shadow: 0 1px 4px rgba(0,0,0,0.35);
        transform: translate(-50%, -50%);
      ">${label}</div>
    `,
    iconSize: [22, 22],
    iconAnchor: [0, 0],
  });
}

function turnManeuverOffset(kind: TurnSignKind) {
  if (kind === "slightLeft") return -45;
  if (kind === "left") return -90;
  if (kind === "sharpLeft") return -135;
  if (kind === "keepLeft") return -30;
  if (kind === "slightRight") return 45;
  if (kind === "right") return 90;
  if (kind === "sharpRight") return 135;
  if (kind === "keepRight") return 30;
  if (kind === "uturn") return 180;
  return 0;
}

function createTurnIcon(kind: TurnSignKind, headingDeg: number, approaching: boolean) {
  const color = approaching ? "#ea580c" : "#2455d6";
  const rotation = `rotate(${Math.round(headingDeg + turnManeuverOffset(kind))}deg)`;
  const inner =
    kind === "roundabout"
      ? `<div style="
            width: 36px;
            height: 36px;
            display: grid;
            place-items: center;
            font-size: 26px;
            font-weight: 800;
            color: ${color};
            transform: translate(-50%, -50%) rotate(${Math.round(headingDeg)}deg);
            filter: drop-shadow(0 1px 3px rgba(0,0,0,0.4));
          ">↻</div>`
      : kind === "arrive"
        ? `<div style="
              width: 18px;
              height: 18px;
              transform: translate(-50%, -50%);
              background: ${color};
              border: 2px solid #fff;
              border-radius: 4px;
              box-shadow: 0 1px 4px rgba(0,0,0,0.35);
            "></div>`
        : `<div style="
            width: 36px;
            height: 36px;
            transform: translate(-50%, -50%) ${rotation};
            filter: drop-shadow(0 1px 3px rgba(0,0,0,0.4));
          ">
            <div style="
              width: 0;
              height: 0;
              margin: 0 auto;
              border-left: 10px solid transparent;
              border-right: 10px solid transparent;
              border-bottom: 16px solid ${color};
            "></div>
            <div style="
              width: 12px;
              height: 12px;
              margin: 1px auto 0;
              border-radius: 50%;
              background: ${color};
              border: 2px solid #fff;
            "></div>
          </div>`;
  return L.divIcon({
    className: "turn-icon",
    html: inner,
    iconSize: [36, 36],
    iconAnchor: [0, 0],
  });
}

function createRejoinIcon(headingDeg: number) {
  const rotation = `rotate(${Math.round(headingDeg)}deg)`;
  return L.divIcon({
    className: "turn-icon",
    html: `
      <div style="
        width: 34px;
        height: 34px;
        transform: translate(-50%, -50%) ${rotation};
        filter: drop-shadow(0 1px 3px rgba(0,0,0,0.4));
      ">
        <div style="
          width: 0;
          height: 0;
          margin: 0 auto;
          border-left: 9px solid transparent;
          border-right: 9px solid transparent;
          border-bottom: 16px solid #d97706;
        "></div>
      </div>
    `,
    iconSize: [34, 34],
    iconAnchor: [0, 0],
  });
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
  walkedPath = [],
  walkerOnPath = null,
  onPathClicked,
  headingPoint = null,
  endLabel = "End",
  followTarget = null,
  followEnabled = false,
  followNonce = 0,
  onFollowInterrupted,
  gpsHeadingDeg = null,
  splitMarkers = [],
  nextTurn = null,
  rejoin = null,
  mapTheme = "light",
  headingUpDeg = null,
  layoutNonce = 0,
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
  const headingBucket =
    gpsHeadingDeg != null && Number.isFinite(gpsHeadingDeg)
      ? Math.round(gpsHeadingDeg / 5) * 5
      : null;
  const youIcon = useMemo(
    () => createYouIcon(headingBucket),
    [headingBucket],
  );
  const turnHeadingBucket =
    nextTurn != null && Number.isFinite(nextTurn.headingDeg)
      ? Math.round(nextTurn.headingDeg / 8) * 8
      : null;
  const turnKind = nextTurn ? turnSignKind(nextTurn.turn.sign) : null;
  const turnIcon = useMemo(() => {
    if (turnHeadingBucket == null || !turnKind || nextTurn == null) return null;
    return createTurnIcon(turnKind, turnHeadingBucket, nextTurn.approaching);
  }, [turnHeadingBucket, turnKind, nextTurn]);
  const rejoinHeadingBucket =
    rejoin != null && Number.isFinite(rejoin.headingDeg)
      ? Math.round(rejoin.headingDeg / 8) * 8
      : null;
  const rejoinIcon = useMemo(() => {
    if (rejoinHeadingBucket == null) return null;
    return createRejoinIcon(rejoinHeadingBucket);
  }, [rejoinHeadingBucket]);
  const mapBearingBucket =
    headingUpDeg != null && Number.isFinite(headingUpDeg)
      ? Math.round(headingUpDeg / 5) * 5
      : null;
  const headingUp = mapBearingBucket != null;
  const darkTiles = mapTheme === "dark";

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

  const pathClickHandlers =
    !pickingEnabled && onPathClicked
      ? {
          click(event: L.LeafletMouseEvent) {
            L.DomEvent.stopPropagation(event);
            onPathClicked({
              lat: event.latlng.lat,
              lng: event.latlng.lng,
            });
          },
        }
      : undefined;

  return (
    <div
      style={{
        height: "100%",
        width: "100%",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <div
        style={
          headingUp
            ? {
                position: "absolute",
                inset: "-30%",
                transform: `rotate(${-mapBearingBucket}deg)`,
                transformOrigin: "center center",
              }
            : { height: "100%", width: "100%" }
        }
      >
    <MapContainer
      center={[22.3193, 114.1694]}
      zoom={13}
      scrollWheelZoom={!headingUp}
      dragging={!headingUp}
      zoomControl={!headingUp}
      style={{ height: "100%", width: "100%" }}
      ref={(map) => {
        mapRef.current = map;
      }}
    >
      <TileLayer
        attribution={
          darkTiles
            ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
            : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }
        url={
          darkTiles
            ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        }
      />
      <InvalidateOnChange nonce={layoutNonce} />
      <FitRouteBounds routePoints={routePoints} fitNonce={fitNonce} />
      <FollowWalker
        target={followTarget}
        enabled={followEnabled}
        followNonce={followNonce}
        onFollowInterrupted={onFollowInterrupted}
      />
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
                  className: pathClickHandlers ? "route-path-clickable" : undefined,
                }}
                eventHandlers={pathClickHandlers}
              >
                <Tooltip direction="top" offset={[0, -10]} opacity={1} permanent={false}>
                  {pathClickHandlers
                    ? `${group.label} · click to dodge this street`
                    : group.label}
                </Tooltip>
              </Polyline>
            ));
          })()
        : routePoints.length > 1 ? (
            <Polyline
              positions={routePoints.map(
                (point) => [point.lat, point.lng] as [number, number],
              )}
              pathOptions={{
                color: "#2f6fed",
                weight: 5,
                className: pathClickHandlers ? "route-path-clickable" : undefined,
              }}
              eventHandlers={pathClickHandlers}
            />
          ) : null}

      {walkedPath.length > 1 ? (
        <Polyline
          positions={walkedPath.map(
            (point) => [point.lat, point.lng] as [number, number],
          )}
          pathOptions={{ color: "#1e3a8a", weight: 9, opacity: 0.45 }}
          interactive={false}
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

      {splitMarkers.map((marker) => (
        <Marker
          key={`km-${marker.alongMeters}`}
          position={[marker.location.lat, marker.location.lng]}
          icon={createKmIcon(formatSplitLabel(marker.alongMeters))}
          zIndexOffset={200}
        >
          <Tooltip direction="top" offset={[0, -12]}>
            {marker.alongMeters >= 1000
              ? `${formatSplitLabel(marker.alongMeters)} km`
              : `${Math.round(marker.alongMeters)} m`}
          </Tooltip>
        </Marker>
      ))}
      {nextTurn && turnIcon ? (
        <Marker
          position={[nextTurn.location.lat, nextTurn.location.lng]}
          icon={turnIcon}
          zIndexOffset={900}
          interactive={false}
        >
          <Tooltip direction="top" offset={[0, -14]}>
            {nextTurn.turn.text}
          </Tooltip>
        </Marker>
      ) : null}
      {rejoin && rejoinIcon ? (
        <>
          <Polyline
            positions={[
              [rejoin.from.lat, rejoin.from.lng],
              [rejoin.onto.lat, rejoin.onto.lng],
            ]}
            pathOptions={{
              color: "#d97706",
              weight: 4,
              dashArray: "8 8",
              opacity: 0.9,
            }}
            interactive={false}
          />
          <Marker
            position={[rejoin.onto.lat, rejoin.onto.lng]}
            icon={rejoinIcon}
            zIndexOffset={850}
            interactive={false}
          >
            <Tooltip direction="top" offset={[0, -12]}>
              Rejoin path
            </Tooltip>
          </Marker>
        </>
      ) : null}
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
            {endLabel}
          </Tooltip>
        </CircleMarker>
      ) : null}
      {headingPoint ? (
        <CircleMarker
          center={[headingPoint.lat, headingPoint.lng]}
          radius={8}
          pathOptions={{ color: "#7c3aed", fillColor: "#7c3aed", fillOpacity: 0.9 }}
        >
          <Tooltip direction="top" offset={[0, -10]} permanent>
            This way
          </Tooltip>
        </CircleMarker>
      ) : null}
      {currentPosition ? (
        <Marker
          position={[currentPosition.lat, currentPosition.lng]}
          icon={youIcon}
          zIndexOffset={600}
        >
          <Tooltip direction="top" offset={[0, -12]}>
            You
          </Tooltip>
        </Marker>
      ) : null}
      {walkerOnPath ? (
        <CircleMarker
          center={[walkerOnPath.lat, walkerOnPath.lng]}
          radius={10}
          pathOptions={{
            color: "#fff",
            weight: 3,
            fillColor: "#0ea5e9",
            fillOpacity: 0.95,
          }}
        >
          <Tooltip direction="top" offset={[0, -10]} permanent>
            On path
          </Tooltip>
        </CircleMarker>
      ) : null}
    </MapContainer>
      </div>
    </div>
  );
}
