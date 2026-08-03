"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { WalkHud } from "@/components/WalkHud";
import { routePreferenceLabel } from "@/lib/route-preference";
import { pacePatternName, paceRoleLabel } from "@/lib/pace-style";
import {
  clearPlannerState,
  loadPlannerState,
  savePlannerState,
} from "@/lib/planner-storage";
import { formatDistance, formatDuration, getNearestSegmentMatch, haversineDistance } from "@/lib/route-math";
import {
  effortPreferenceLabel,
  estimateHrFromVo2,
  getDefaultSpeedBounds,
  getWorkoutCopy,
  metsFromVo2,
  vo2FromSpeedAndGrade,
} from "@/lib/training";
import type {
  EffortPreference,
  LatLng,
  RoutePlan,
  RoutePreference,
  WorkoutLevel,
} from "@/types/workout";

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
  effortPreference: EffortPreference;
  routePreference: RoutePreference;
};

type LiveStats = {
  speedMps: number;
  estimatedHr: number;
  estimatedMets: number;
  recommendation: string;
  segmentIndex: number;
  distanceToRouteMeters: number;
};

const DEFAULT_FORM: PlannerFormState = {
  age: 32,
  weightKg: 68,
  restingHr: 60,
  workoutLevel: "intermediate",
  minSpeedMps: 1,
  maxSpeedMps: 1.75,
  effortPreference: "balanced",
  routePreference: "default",
};

function readClientMounted() {
  return true;
}

function readServerMounted() {
  return false;
}

function subscribeNoop() {
  return () => {};
}

function createInitialFromStorage() {
  const stored = loadPlannerState();
  if (!stored) {
    return {
      form: DEFAULT_FORM,
      start: null as LatLng | null,
      end: null as LatLng | null,
      routePlan: null as RoutePlan | null,
      mapLocked: false,
      gpsConsent: false,
      saveNote: null as string | null,
    };
  }

  return {
    form: {
      ...DEFAULT_FORM,
      ...stored.form,
      effortPreference: stored.form.effortPreference ?? "balanced",
      routePreference: stored.form.routePreference ?? "default",
    },
    start: stored.start,
    end: stored.end,
    routePlan: stored.routePlan,
    mapLocked: Boolean(stored.mapLocked && stored.routePlan),
    gpsConsent: Boolean(stored.gpsConsent),
    saveNote: `Restored session from ${new Date(stored.savedAt).toLocaleString()}`,
  };
}

export function WorkoutPlanner() {
  const mounted = useSyncExternalStore(
    subscribeNoop,
    readClientMounted,
    readServerMounted,
  );

  if (!mounted) {
    return (
      <div className={styles.page}>
        <section className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>Aerobic route pacing</p>
            <h1>Walking optimizer for cardio training on real routes</h1>
            <p className={styles.subtitle}>Loading your local planner session…</p>
          </div>
        </section>
      </div>
    );
  }

  return <WorkoutPlannerClient />;
}

function WorkoutPlannerClient() {
  const initial = useMemo(() => createInitialFromStorage(), []);
  const [form, setForm] = useState(initial.form);
  const [start, setStart] = useState<LatLng | null>(initial.start);
  const [end, setEnd] = useState<LatLng | null>(initial.end);
  const [routePlan, setRoutePlan] = useState<RoutePlan | null>(initial.routePlan);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPosition, setCurrentPosition] = useState<LatLng | null>(null);
  const [liveStats, setLiveStats] = useState<LiveStats | null>(null);
  const [mapLocked, setMapLocked] = useState(initial.mapLocked);
  const [gpsConsent, setGpsConsent] = useState(initial.gpsConsent);
  const [saveNote, setSaveNote] = useState<string | null>(initial.saveNote);
  const lastFixRef = useRef<{ point: LatLng; timestamp: number } | null>(null);

  useEffect(() => {
    savePlannerState({
      form,
      start,
      end,
      routePlan,
      mapLocked,
      gpsConsent,
    });
  }, [form, start, end, routePlan, mapLocked, gpsConsent]);

  useEffect(() => {
    if (!gpsConsent || !routePlan || !("geolocation" in navigator)) {
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

        const nearest = getNearestSegmentMatch(nextPoint, routePlan.segments);
        const segmentIndex = nearest.segmentIndex;
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
            effortPreference: form.effortPreference,
          },
          vo2,
        );

        const delta = speedMps - target.targetSpeedMps;
        const roleHint =
          target.paceRole === "push"
            ? "Push interval — pick up the pace for cardio."
            : target.paceRole === "rest"
              ? "Recovery interval — ease off and breathe."
              : "Steady interval — hold a strong walking effort.";
        const recommendation =
          delta > 0.15
            ? `${roleHint} You are a bit fast right now.`
            : delta < -0.15
              ? `${roleHint} You are a bit slow right now.`
              : roleHint;

        setLiveStats({
          speedMps: speedMps || target.targetSpeedMps,
          estimatedHr,
          estimatedMets: metsFromVo2(vo2),
          recommendation,
          segmentIndex,
          distanceToRouteMeters: nearest.distanceMeters,
        });
      },
      (geoError) => {
        setError(geoError.message || "Geolocation permission was denied.");
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 },
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [form, routePlan, gpsConsent]);

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
    if (mapLocked) return;
    setError(null);

    // Starting a new pick sequence: keep the existing route visible until a
    // successful rebuild, so a misclick doesn't wipe the path.
    if (!start || (start && end)) {
      setStart(point);
      setEnd(null);
      setLiveStats(null);
      return;
    }

    setEnd(point);
  }

  function handleClearPoints() {
    setStart(null);
    setEnd(null);
    setRoutePlan(null);
    setLiveStats(null);
    setError(null);
    setMapLocked(false);
    setCurrentPosition(null);
    lastFixRef.current = null;
    clearPlannerState();
    setSaveNote("Cleared local session.");
  }

  function handleEditRoutePoints() {
    setMapLocked(false);
    setError(null);
  }

  function handleEnableGps() {
    setGpsConsent(true);
    setError(null);
    setSaveNote("GPS enabled for this browser. Location stays on your device.");
  }

  function handleDisableGps() {
    setGpsConsent(false);
    setCurrentPosition(null);
    setLiveStats(null);
    lastFixRef.current = null;
  }

  const pickHint = mapLocked
    ? "Map locked on the route. Press “Change start & end” to edit points."
    : !start
      ? "Click the map to set a start point."
      : !end
        ? routePlan
          ? "Existing route kept. Click the map to set a new end point, then rebuild."
          : "Click the map to set an end point."
        : routePlan
          ? "Start and end set. Rebuild to update the locked route view."
          : "Start and end set. Build the walking plan.";

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
      setMapLocked(true);
      lastFixRef.current = null;
      setSaveNote("Plan saved in this browser for next visit.");
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

            <label className={styles.field}>
              <span>Path preference</span>
              <select
                value={form.routePreference}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    routePreference: event.target.value as RoutePreference,
                  }))
                }
              >
                <option value="default">Fastest walking route</option>
                <option value="avoid_stairs">Avoid stairs</option>
                <option value="prefer_flat">Prefer flatter paths</option>
              </select>
            </label>
            <p className={styles.cardText}>
              {routePreferenceLabel(form.routePreference)}. Rebuild after changing —
              GraphHopper may fall back to default if a preference is unsupported.
            </p>

            <label className={styles.field}>
              <span>Long-route effort</span>
              <select
                value={form.effortPreference}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    effortPreference: event.target.value as EffortPreference,
                  }))
                }
              >
                <option value="conserve">Conserve — ease bpm sooner on long walks</option>
                <option value="balanced">Balanced — default distance easing</option>
                <option value="challenge">Challenge — keep intensity higher longer</option>
              </select>
            </label>
            <p className={styles.cardText}>
              {effortPreferenceLabel(form.effortPreference)}. Rebuild the route after
              changing this.
            </p>

            <button className={styles.primaryButton} onClick={handleBuildRoute} disabled={loading}>
              {loading ? "Building route..." : "Build aerobic walking plan"}
            </button>
            <button
              className={styles.secondaryButton}
              onClick={handleEditRoutePoints}
              disabled={loading || !mapLocked}
              type="button"
            >
              Change start & end
            </button>
            <button
              className={styles.secondaryButton}
              onClick={handleClearPoints}
              disabled={loading || (!start && !end && !routePlan)}
              type="button"
            >
              Clear points & route
            </button>
            <p className={styles.pickHint}>{pickHint}</p>
            {saveNote ? <p className={styles.saveNote}>{saveNote}</p> : null}
          </div>

          <div className={styles.card}>
            <h2>Live GPS</h2>
            <p className={styles.cardText}>
              Location is optional and only used in this browser to match you to the
              planned path. It is not uploaded to a server or saved beyond this device.
            </p>
            {!gpsConsent ? (
              <button
                className={styles.primaryButton}
                type="button"
                onClick={handleEnableGps}
                disabled={!routePlan}
              >
                Enable live GPS guidance
              </button>
            ) : (
              <button
                className={styles.secondaryButton}
                type="button"
                onClick={handleDisableGps}
              >
                Turn off GPS
              </button>
            )}
            <p className={styles.pickHint}>
              {gpsConsent
                ? "GPS on — walk mode can follow your position when you are near the route."
                : "GPS off — walk mode still works on the interval clock (best for PC)."}
            </p>
          </div>

          <div className={styles.card}>
            <h2>Map steps</h2>
            <ol className={styles.steps}>
              <li>Click the map once to set a start point.</li>
              <li>Click a second time to set the destination.</li>
              <li>Choose path preference (fastest / avoid stairs / flatter).</li>
              <li>Build the route — the map locks and focuses on the path.</li>
              <li>Press “Change start & end” to unlock and pick new points.</li>
              <li>Optionally enable GPS for live pace guidance on the path.</li>
            </ol>
          </div>

          <div className={styles.card}>
            <h2>On-path markers</h2>
            <p className={styles.cardText}>
              Only features the walking path actually uses are shown. Car junction
              lights and nearby side stairs are ignored.
            </p>
            <ul className={styles.legendList}>
              <li>
                <span className={styles.legendStar} aria-hidden>
                  ★
                </span>
                Stairs on the walked path
              </li>
              <li>
                <span className={styles.legendTriangle} aria-hidden />
                Elevator / lift on path
              </li>
              <li>
                <span className={styles.legendRect} aria-hidden />
                Pedestrian crossing signal
              </li>
            </ul>
            {routePlan ? (
              <p className={styles.cardText}>
                Detected on this route: {routePlan.hazards.length}
                {routePlan.hazardDebug
                  ? ` (GraphHopper ${routePlan.hazardDebug.graphHopperCount}, OSM on-path ${routePlan.hazardDebug.osmOnPathCount}${
                      routePlan.hazardDebug.overpassOk
                        ? ""
                        : `, Overpass failed${
                            routePlan.hazardDebug.overpassError
                              ? `: ${routePlan.hazardDebug.overpassError}`
                              : ""
                          }`
                    })`
                  : ""}
              </p>
            ) : null}
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

          {routePlan ? (
            <WalkHud
              routePlan={routePlan}
              liveSegmentIndex={liveStats?.segmentIndex ?? null}
              onRoute={
                liveStats != null && liveStats.distanceToRouteMeters <= 40
              }
            />
          ) : null}

          {error ? <div className={styles.errorBox}>{error}</div> : null}
        </aside>

        <section className={styles.mapPanel}>
          <div className={`${styles.mapFrame} ${mapLocked ? styles.mapFrameLocked : ""}`}>
            <LeafletMap
              start={start}
              end={end}
              routePoints={routePlan?.points ?? []}
              segmentSpeedPlan={routePlan?.speedPlan ?? null}
              hazards={routePlan?.hazards ?? []}
              currentPosition={currentPosition}
              onPickPoint={handleMapPick}
              locked={mapLocked}
            />
            {mapLocked ? (
              <div className={styles.mapLockBadge}>Route locked</div>
            ) : null}
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
                <p className={styles.cardText}>
                  Route edges are split into ~12 m steps so each pair stays near
                  180s push (75%) + 60s recovery (25%). Zone 2 is max on Push
                  only. Longer routes ease target bpm so average effort stays
                  sustainable. Pace roles also use line patterns: push solid,
                  steady dashed, rest dotted.
                </p>
                <ul className={styles.paceLegend}>
                  <li>
                    <span className={`${styles.paceSwatch} ${styles.paceSwatchPush}`} />
                    Push · solid
                  </li>
                  <li>
                    <span className={`${styles.paceSwatch} ${styles.paceSwatchSteady}`} />
                    Steady · dashed
                  </li>
                  <li>
                    <span className={`${styles.paceSwatch} ${styles.paceSwatchRest}`} />
                    Rest · dotted
                  </li>
                </ul>
                <div className={styles.segmentTable}>
                  <div className={`${styles.segmentRow} ${styles.segmentHeader}`}>
                    <span>Interval</span>
                    <span>Zone</span>
                    <span>Distance / time</span>
                    <span>Target HR / pace</span>
                  </div>
                  {(routePlan.paceBlocks?.length
                    ? routePlan.paceBlocks
                    : []
                  ).map((block) => {
                    const roleLabel = `${paceRoleLabel(block.paceRole)} · ${pacePatternName(block.paceRole)}`;
                    const roleClass =
                      block.paceRole === "push"
                        ? styles.rolePush
                        : block.paceRole === "rest"
                          ? styles.roleRest
                          : styles.roleSteady;

                    return (
                      <div key={block.index} className={styles.segmentRow}>
                        <span>#{block.index + 1}</span>
                        <span className={roleClass}>
                          {roleLabel} · {block.zoneLabel ?? ""}
                        </span>
                        <span>
                          {formatDistance(block.distanceMeters)} /{" "}
                          {formatDuration(block.durationSeconds)}
                        </span>
                        <span>
                          ~{block.targetHr ?? block.avgHr} bpm ·{" "}
                          {block.avgSpeedMps.toFixed(2)} m/s
                        </span>
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
