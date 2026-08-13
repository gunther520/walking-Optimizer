"use client";

import { useMemo, useState } from "react";

import { buildElevationProfile } from "@/lib/elevation-profile";
import {
  pacePatternName,
  paceRoleLabel,
  paceStrokeColor,
} from "@/lib/pace-style";
import { formatDistance } from "@/lib/route-math";
import type { OSMHazardKind, RoutePlan } from "@/types/workout";

import styles from "@/app/page.module.css";

type ElevationProfileChartProps = {
  plan: RoutePlan;
  alongMeters?: number;
};

const WIDTH = 800;
const HEIGHT = 168;
const PAD = { top: 18, right: 16, bottom: 28, left: 44 };

function hazardGlyph(kind: OSMHazardKind) {
  if (kind === "stairs") return { fill: "#7c3aed", label: "Stairs", shape: "star" as const };
  if (kind === "elevator") return { fill: "#0f766e", label: "Elevator", shape: "tri" as const };
  return { fill: "#e11d48", label: "Crossing", shape: "rect" as const };
}

export function ElevationProfileChart({
  plan,
  alongMeters = 0,
}: ElevationProfileChartProps) {
  const profile = useMemo(() => buildElevationProfile(plan), [plan]);
  const [hoverX, setHoverX] = useState<number | null>(null);

  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const eleSpan = Math.max(1, profile.maxEle - profile.minEle);

  function xAt(along: number) {
    if (profile.totalMeters <= 0) return PAD.left;
    return PAD.left + (along / profile.totalMeters) * innerW;
  }

  function yAt(elevation: number) {
    const t = (elevation - profile.minEle) / eleSpan;
    return PAD.top + innerH * (1 - t);
  }

  const points = profile.samples.map((sample) => ({
    ...sample,
    x: xAt(sample.alongMeters),
    y: yAt(sample.elevation),
  }));

  const areaPath =
    points.length > 1
      ? `M ${points[0].x} ${PAD.top + innerH} ${points
          .map((point) => `L ${point.x} ${point.y}`)
          .join(" ")} L ${points[points.length - 1].x} ${PAD.top + innerH} Z`
      : "";

  const roleRuns: Array<{ role: (typeof points)[0]["paceRole"]; d: string }> = [];
  if (points.length > 1) {
    let runStart = 0;
    for (let i = 1; i <= points.length; i += 1) {
      if (i < points.length && points[i].paceRole === points[runStart].paceRole) {
        continue;
      }
      const run = points.slice(runStart, i);
      roleRuns.push({
        role: points[runStart].paceRole,
        d: run.map((point, idx) => `${idx === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" "),
      });
      runStart = i;
    }
  }

  const hoverAlong =
    hoverX == null || profile.totalMeters <= 0
      ? null
      : Math.min(
          profile.totalMeters,
          Math.max(0, ((hoverX - PAD.left) / innerW) * profile.totalMeters),
        );
  const hoverSample =
    hoverAlong == null
      ? null
      : points.reduce((best, sample) =>
          Math.abs(sample.alongMeters - hoverAlong) <
          Math.abs(best.alongMeters - hoverAlong)
            ? sample
            : best,
        );

  const progressX =
    alongMeters > 8 && profile.totalMeters > 0 ? xAt(alongMeters) : null;

  return (
    <div className={styles.elevationCard}>
      <div className={styles.elevationHeader}>
        <h2>Elevation & hazards</h2>
        <p>
          {profile.hasElevation
            ? `Climb ${Math.round(profile.gainMeters)} m · descent ${Math.round(profile.lossMeters)} m`
            : "No elevation on this route — grade band still shows pace roles and hazards."}
        </p>
      </div>
      <svg
        className={styles.elevationSvg}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="Route elevation profile colored by pace role"
        onMouseLeave={() => setHoverX(null)}
        onMouseMove={(event) => {
          const svg = event.currentTarget;
          const rect = svg.getBoundingClientRect();
          const x = ((event.clientX - rect.left) / rect.width) * WIDTH;
          setHoverX(x);
        }}
      >
        <rect x="0" y="0" width={WIDTH} height={HEIGHT} fill="transparent" />
        <text x={PAD.left} y={14} className={styles.elevationAxis}>
          {Math.round(profile.maxEle)} m
        </text>
        <text x={PAD.left} y={HEIGHT - 8} className={styles.elevationAxis}>
          {Math.round(profile.minEle)} m
        </text>
        <text x={WIDTH - PAD.right} y={HEIGHT - 8} className={styles.elevationAxis} textAnchor="end">
          {formatDistance(profile.totalMeters)}
        </text>
        {areaPath ? (
          <path d={areaPath} fill="#dbe7f6" opacity="0.9" />
        ) : null}
        {roleRuns.map((run, index) => (
          <path
            key={`${run.role}-${index}`}
            d={run.d}
            fill="none"
            stroke={paceStrokeColor(run.role)}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={
              run.role === "push" ? undefined : run.role === "steady" ? "10 7" : "2 7"
            }
          />
        ))}
        {profile.hazards.map((hazard, index) => {
          const x = xAt(hazard.alongMeters);
          const glyph = hazardGlyph(hazard.kind);
          const y = PAD.top + 8;
          return (
            <g key={`${hazard.kind}-${index}`} transform={`translate(${x} ${y})`}>
              {glyph.shape === "star" ? (
                <polygon
                  points="0,-7 2,-2 7,-2 3,1 4,6 0,3 -4,6 -3,1 -7,-2 -2,-2"
                  fill={glyph.fill}
                />
              ) : glyph.shape === "tri" ? (
                <polygon points="0,-7 7,6 -7,6" fill={glyph.fill} />
              ) : (
                <rect x="-4" y="-6" width="8" height="12" rx="1" fill={glyph.fill} />
              )}
              <title>{glyph.label}</title>
            </g>
          );
        })}
        {progressX != null ? (
          <line
            x1={progressX}
            x2={progressX}
            y1={PAD.top}
            y2={PAD.top + innerH}
            stroke="#0ea5e9"
            strokeWidth="2"
          />
        ) : null}
        {hoverSample ? (
          <>
            <line
              x1={hoverSample.x}
              x2={hoverSample.x}
              y1={PAD.top}
              y2={PAD.top + innerH}
              stroke="#10213a"
              strokeDasharray="3 3"
              strokeWidth="1"
            />
            <circle cx={hoverSample.x} cy={hoverSample.y} r="4" fill="#10213a" />
          </>
        ) : null}
      </svg>
      <div className={styles.elevationMeta}>
        <span>
          {hoverSample
            ? `${formatDistance(hoverSample.alongMeters)} · ${Math.round(hoverSample.elevation)} m · ${(hoverSample.grade * 100).toFixed(1)}% · ${paceRoleLabel(hoverSample.paceRole)} (${pacePatternName(hoverSample.paceRole)})`
            : "Hover the profile for distance, elevation, and grade."}
        </span>
      </div>
    </div>
  );
}
