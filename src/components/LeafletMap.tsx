"use client";

import { useEffect, useRef } from "react";

import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMapEvents } from "react-leaflet";

import type { LatLng } from "@/types/workout";
import type { Map as LeafletMapType } from "leaflet";

type LeafletMapProps = {
  start: LatLng | null;
  end: LatLng | null;
  routePoints: LatLng[];
  currentPosition: LatLng | null;
  onPickPoint: (point: LatLng) => void;
};

function ClickHandler({ onPickPoint }: { onPickPoint: (point: LatLng) => void }) {
  useMapEvents({
    click(event) {
      onPickPoint({
        lat: event.latlng.lat,
        lng: event.latlng.lng,
      });
    },
  });

  return null;
}

export function LeafletMap({
  start,
  end,
  routePoints,
  currentPosition,
  onPickPoint,
}: LeafletMapProps) {
  const mapRef = useRef<LeafletMapType | null>(null);
  const mounted = typeof window !== "undefined";
  const polyline = routePoints.map((point) => [point.lat, point.lng] as [number, number]);

  useEffect(() => {
    // React dev-mode can mount/unmount twice; explicitly remove Leaflet to avoid
    // "Map container is being reused by another instance" errors.
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
      <ClickHandler onPickPoint={onPickPoint} />
      {polyline.length > 1 ? (
        <Polyline positions={polyline} pathOptions={{ color: "#2f6fed", weight: 5 }} />
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
