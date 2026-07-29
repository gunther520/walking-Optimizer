"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";

import { formatDistance, formatDuration, getNearestSegmentIndex, haversineDistance } from "@/lib/route-math";
import { estimateHrFromVo2, getDefaultSpeedBounds, getWorkoutCopy, metsFromVo2, vo2FromSpeedAndGrade } from "@/lib/training";
import type { LatLng, RoutePlan, WorkoutLevel } from "@/types/workout";

import styles from "@/app/page.module.css";

const LeafletMap = dynamic(
  () => import("@/components/LeafletMap").then((module) => module.LeafletMap),
  {
    ssr: false,
  },
);

type PlannerFormState = {
  age: number;
  weightKg: number;
  restingHr: number;
  workoutLevel: WorkoutLevel;
  minSpeedMps: number;
  maxSpeedMps: number;
};

type LiveStats = {
  speedMps: number;
  estimatedHr: number;
  estimatedMets: number;
  recommendation: string;
  segmentIndex: number;
};

const DEFAULT_FORM: PlannerFormState = {
  age: 32,
  weightKg: 68,
  restingHr: 60,
  workoutLevel: "intermediate",
  minSpeedMps: 1,
  maxSpeedMps: 1.75,
};

export function WorkoutPlanner() {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [start, setStart] = useState<LatLng | null>(null);
  const [end, setEnd] = useState<LatLng | null>(null);
  const [routePlan, setRoutePlan] = useState<RoutePlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPosition, setCurrentPosition] = useState<LatLng | null>(null);
  const [liveStats, setLiveStats] = useState<LiveStats | null>(null);
  const lastFixRef = useRef<{ point: LatLng; timestamp: number } | null>(null);

  useEffect(() => {
    if (!routePlan || !("geolocation" in navigator)) {
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const nextPoint = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };

        setCurrentPosition(nextPoint);

        const previous = lastFixRef.current;
        const now = position.timestamp;
        let speedMps = Math.max(0, position.coords.speed ?? 0);

        if (!speedMps && previous) {
          const distance = haversineDistance(previous.point, nextPoint);
          const elapsedSeconds = Math.max(1, (now - previous.timestamp) / 1000);
          speedMps = distance / elapsedSeconds;
        }

        lastFixRef.current = { point: nextPoint, timestamp: now };

        if (!routePlan.segments.length) {
          return;
        }

        const segmentIndex = getNearestSegmentIndex(nextPoint, routePlan.segments);
        const segment = routePlan.segments[segmentIndex];
        const target = routePlan.speedPlan[segmentIndex];
        const vo2 = vo2FromSpeedAndGrade(speedMps || target.targetSpeedMps, Math.max(-0.08, segment.grade));
        const estimatedHr = estimateHrFromVo2(
          {
            age: form.age,
            weightKg: form.weightKg,
            restingHr: form.restingHr,
            workoutLevel: form.workoutLevel,
            minSpeedMps: form.minSpeedMps,
            maxSpeedMps: form.maxSpeedMps,
          },
          vo2,
        );

        const delta = speedMps - target.targetSpeedMps;
        const recommendation =
          delta > 0.12
            ? "Ease off slightly on this segment."
            : delta < -0.12
              ? "Push a bit faster to stay aerobic."
              : "You are close to the planned aerobic pace.";

        setLiveStats({
          speedMps: speedMps || target.targetSpeedMps,
          estimatedHr,
          estimatedMets: metsFromVo2(vo2),
          recommendation,
          segmentIndex,
        });
      },
      (geoError) => {
        setError(geoError.message || "Geolocation permission was denied.");
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 },
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [form, routePlan]);

  const summaryCards = useMemo(() => {
    if (!routePlan) {
      return [];
    }

    const uphillCount = routePlan.segments.filter((segment) => segment.grade > 0.03).length;
    const downhillCount = routePlan.segments.filter((segment) => segment.grade < -0.03).length;

    return [
      {
        label: "Estimated duration",
        value: formatDuration(routePlan.estimatedDurationSeconds),
      },
      {
        label: "Route distance",
        value: formatDistance(routePlan.totalDistanceMeters),
      },
      {
        label: "Aerobic target zone",
        value: `${routePlan.zoneBand.minHr}-${routePlan.zoneBand.maxHr} bpm`,
      },
      {
        label: "Terrain shifts",
        value: `${uphillCount} uphill / ${downhillCount} downhill`,
      },
    ];
  }, [routePlan]);

  function handleMapPick(point: LatLng) {
    setError(null);

    if (!start || (start && end)) {
      setStart(point);
      setEnd(null);
      setRoutePlan(null);
      setLiveStats(null);
      return;
    }

    setEnd(point);
  }

  async function handleBuildRoute() {
    if (!start || !end) {
      setError("Pick both a start and end point on the map first.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/route", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          start,
          end,
          profile: form,
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Unable to create the walking plan.");
      }

      setRoutePlan(result as RoutePlan);
      setLiveStats(null);
      lastFixRef.current = null;
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to create the walking plan.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Aerobic route pacing</p>
          <h1>Walking optimizer for cardio training on real routes</h1>
          <p className={styles.subtitle}>
            Click two map points, choose a fitness profile, and get a walking route that
            speeds up or slows down by terrain to keep the workout in an estimated aerobic zone.
          </p>
        </div>
        <div className={styles.callout}>
          <strong>Estimated guidance only</strong>
          <span>
            HR and intensity are inferred from pace and grade. They are not medical advice or a
            substitute for a wearable HR monitor.
          </span>
        </div>
      </section>

      <main className={styles.grid}>
        <aside className={styles.sidebar}>
          <div className={styles.card}>
            <h2>Profile</h2>
            <p className={styles.cardText}>
              {getWorkoutCopy(form.workoutLevel)} with a live speed target tuned to route slope.
            </p>

            <label className={styles.field}>
              <span>Workout level</span>
              <select
                value={form.workoutLevel}
                onChange={(event) => {
                  const workoutLevel = event.target.value as WorkoutLevel;
                  const defaults = getDefaultSpeedBounds(workoutLevel);
                  setForm((current) => ({
                    ...current,
                    workoutLevel,
                    minSpeedMps: defaults.minSpeedMps,
                    maxSpeedMps: defaults.maxSpeedMps,
                  }));
                }}
              >
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
              </select>
            </label>

            <div className={styles.twoUp}>
              <label className={styles.field}>
                <span>Age</span>
                <input
                  type="number"
                  min="18"
                  max="90"
                  value={form.age}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, age: Number(event.target.value) }))
                  }
                />
              </label>
              <label className={styles.field}>
                <span>Weight (kg)</span>
                <input
                  type="number"
                  min="35"
                  max="200"
                  value={form.weightKg}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, weightKg: Number(event.target.value) }))
                  }
                />
              </label>
            </div>

            <div className={styles.twoUp}>
              <label className={styles.field}>
                <span>Resting HR</span>
                <input
                  type="number"
                  min="40"
                  max="120"
                  value={form.restingHr}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, restingHr: Number(event.target.value) }))
                  }
                />
              </label>
              <label className={styles.field}>
                <span>Max speed (m/s)</span>
                <input
                  type="number"
                  min="1"
                  max="2.5"
                  step="0.05"
                  value={form.maxSpeedMps}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, maxSpeedMps: Number(event.target.value) }))
                  }
                />
              </label>
            </div>

            <button className={styles.primaryButton} onClick={handleBuildRoute} disabled={loading}>
              {loading ? "Building route..." : "Build aerobic walking plan"}
            </button>
          </div>

          <div className={styles.card}>
            <h2>Map steps</h2>
            <ol className={styles.steps}>
              <li>Click the map once to set a start point.</li>
              <li>Click a second time to set the destination.</li>
              <li>Build the route to calculate segment pace changes.</li>
              <li>Allow geolocation to see live pace guidance.</li>
            </ol>
          </div>

          {liveStats ? (
            <div className={styles.card}>
              <h2>Live stats</h2>
              <div className={styles.metricList}>
                <div>
                  <span>Current speed</span>
                  <strong>{liveStats.speedMps.toFixed(2)} m/s</strong>
                </div>
                <div>
                  <span>Estimated HR</span>
                  <strong>{liveStats.estimatedHr} bpm</strong>
                </div>
                <div>
                  <span>Estimated intensity</span>
                  <strong>{liveStats.estimatedMets.toFixed(1)} METs</strong>
                </div>
                <div>
                  <span>Current segment</span>
                  <strong>#{liveStats.segmentIndex + 1}</strong>
                </div>
              </div>
              <p className={styles.recommendation}>{liveStats.recommendation}</p>
            </div>
          ) : null}

          {error ? <div className={styles.errorBox}>{error}</div> : null}
        </aside>

        <section className={styles.mapPanel}>
          <div className={styles.mapFrame}>
            <LeafletMap
              start={start}
              end={end}
              routePoints={routePlan?.points ?? []}
              currentPosition={currentPosition}
              onPickPoint={handleMapPick}
            />
          </div>

          <div className={styles.bottomPanel}>
            <div className={styles.statsGrid}>
              {summaryCards.map((card) => (
                <div key={card.label} className={styles.statCard}>
                  <span>{card.label}</span>
                  <strong>{card.value}</strong>
                </div>
              ))}
            </div>

            {routePlan ? (
              <div className={styles.card}>
                <h2>Segment pacing preview</h2>
                <div className={styles.segmentTable}>
                  {routePlan.speedPlan.slice(0, 8).map((segment) => {
                    const terrain = routePlan.segments[segment.segmentIndex];
                    return (
                      <div key={segment.segmentIndex} className={styles.segmentRow}>
                        <span>Seg {segment.segmentIndex + 1}</span>
                        <span>{segment.targetSpeedMps.toFixed(2)} m/s</span>
                        <span>{(terrain.grade * 100).toFixed(1)}% grade</span>
                        <span>{segment.estimatedHr} bpm est.</span>
                      </div>
                    );
                  })}
                </div>
                {routePlan.instructionSummary.length ? (
                  <div className={styles.instructions}>
                    <h3>Route instructions</h3>
                    <ul>
                      {routePlan.instructionSummary.slice(0, 6).map((instruction, idx) => (
                        <li key={`${instruction}-${idx}`}>{instruction}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className={styles.placeholderCard}>
                Route metrics and segment-by-segment pacing will appear here after you build a
                plan.
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
