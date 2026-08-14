"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { WalkHud } from "@/components/WalkHud";
import { ElevationProfileChart } from "@/components/ElevationProfile";
import { PlaceSearch } from "@/components/PlaceSearch";
import { downloadRouteGpx } from "@/lib/gpx";
import { buildElevationProfile } from "@/lib/elevation-profile";
import {
  applyShareToHistory,
  buildShareSearch,
  headingPointFromShare,
  parseShareSearch,
  shareUrlFromState,
} from "@/lib/share-url";
import { isSilentTurn, nextTurnGuidance } from "@/lib/turns";
import {
  headingDegrees,
  parseWalkShape,
  targetDistanceMeters,
  typicalWalkSpeedMps,
  walkShapeLabel,
  type WalkShape,
} from "@/lib/time-budget";
import { MAX_AVOIDANCE_VIAS } from "@/lib/graphhopper";
import { walkedPathPoints, type AlongPathProgress } from "@/lib/walk-along";
import { isOnRoute, ON_ROUTE_MAX_METERS, rejoinPathGuidance } from "@/lib/walk-follow";
import { buildSplitMarkers } from "@/lib/walk-splits";
import { routePreferenceLabel } from "@/lib/route-preference";
import { pacePatternName, paceRoleLabel } from "@/lib/pace-style";
import {
  clearPlannerState,
  loadPlannerState,
  savePlannerState,
} from "@/lib/planner-storage";
import {
  defaultSavedWalkName,
  deleteSavedWalk,
  getSavedWalk,
  listSavedWalks,
  MAX_SAVED_WALKS,
  saveWalk,
  type SavedWalk,
} from "@/lib/saved-walks";
import {
  compareToPrevious,
  deleteWalkLog,
  formatPlanDelta,
  listWalkLogs,
  saveWalkLog,
  type WalkFinishRecord,
  type WalkFinishStats,
} from "@/lib/walk-log";
import { formatDistance, formatDuration, getNearestSegmentMatch, haversineDistance } from "@/lib/route-math";
import {
  applySnappedViaLocations,
  buildPathHandles,
  emptyViaHistory,
  normalizeViaPoints,
  recordViaHistory,
  redoViaHistory,
  removeVia,
  sortViasBySequence,
  undoViaHistory,
  updateViaLocation,
  upsertViaFromHandle,
  viaFromBlockedPathClick,
  viasSignature,
  pointAtDistanceAlongRoute,
  type ViaHistory,
  type ViaWaypoint,
} from "@/lib/via-points";
import {
  effortPreferenceLabel,
  estimateHrFromVo2,
  getDefaultSpeedBounds,
  getWorkoutCopy,
  metsFromVo2,
  vo2FromSpeedAndGrade,
} from "@/lib/training";
import type { GeocodeHit } from "@/lib/geocode";
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
  walkShape: WalkShape;
  targetMinutes: number;
  loopSeed: number;
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
  walkShape: "point_to_point",
  targetMinutes: 40,
  loopSeed: 0,
};

const TURNAROUND_VIA_ID = "via-turnaround";

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
  const shared = parseShareSearch(window.location.search);
  const fromStorage = stored
    ? {
        form: {
          ...DEFAULT_FORM,
          ...stored.form,
          effortPreference: stored.form.effortPreference ?? "balanced",
          routePreference: stored.form.routePreference ?? "default",
          walkShape: parseWalkShape(stored.form.walkShape),
          targetMinutes: Number(stored.form.targetMinutes ?? 40),
          loopSeed: Number(stored.form.loopSeed ?? 0),
        },
        start: stored.start,
        end: stored.end,
        headingPoint: null as LatLng | null,
        routePlan: stored.routePlan,
        pickingEnabled: !(stored.routePlan && stored.mapLocked === true),
        gpsConsent: Boolean(stored.gpsConsent),
        viaPoints: normalizeViaPoints(stored.viaPoints ?? []),
        saveNote: `Restored session from ${new Date(stored.savedAt).toLocaleString()}`,
      }
    : {
        form: DEFAULT_FORM,
        start: null as LatLng | null,
        end: null as LatLng | null,
        headingPoint: null as LatLng | null,
        routePlan: null as RoutePlan | null,
        pickingEnabled: true,
        gpsConsent: false,
        viaPoints: [] as ViaWaypoint[],
        saveNote: null as string | null,
      };

  if (!shared) return fromStorage;

  return {
    form: {
      ...fromStorage.form,
      walkShape: shared.walkShape,
      targetMinutes: shared.targetMinutes,
      loopSeed: shared.loopSeed,
      routePreference: shared.routePreference,
    },
    start: shared.start,
    end: shared.end,
    headingPoint: headingPointFromShare(shared.start, shared.headingDeg),
    // Shared links do not auto-rebuild — GraphHopper credits are spent on Build.
    routePlan: null as RoutePlan | null,
    pickingEnabled: true,
    gpsConsent: fromStorage.gpsConsent,
    viaPoints: normalizeViaPoints(
      shared.vias.map((location, index) => ({
        id: `via-share-${index}`,
        location,
        sequence: index,
      })),
    ),
    saveNote:
      "Opened a shared walk. Build the route when you are ready (uses GraphHopper credits).",
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
  const [gpsConsent, setGpsConsent] = useState(initial.gpsConsent);
  const [saveNote, setSaveNote] = useState<string | null>(initial.saveNote);
  const [viaPoints, setViaPoints] = useState<ViaWaypoint[]>(initial.viaPoints);
  const [viaHistory, setViaHistory] = useState<ViaHistory>(emptyViaHistory());
  const [pickingEnabled, setPickingEnabled] = useState(initial.pickingEnabled);
  const [fitNonce, setFitNonce] = useState(initial.routePlan ? 1 : 0);
  const [headingPoint, setHeadingPoint] = useState<LatLng | null>(
    initial.headingPoint,
  );
  const [alongProgress, setAlongProgress] = useState<AlongPathProgress | null>(
    null,
  );
  const [savedWalks, setSavedWalks] = useState<SavedWalk[]>(() => listSavedWalks());
  const [saveName, setSaveName] = useState("");
  const [walkLogs, setWalkLogs] = useState<WalkFinishRecord[]>(() => listWalkLogs());
  const [finishNote, setFinishNote] = useState<string | null>(null);
  const [followWalker, setFollowWalker] = useState(true);
  const [followNonce, setFollowNonce] = useState(0);
  const [gpsHeadingDeg, setGpsHeadingDeg] = useState<number | null>(null);
  const [navMode, setNavMode] = useState(false);
  const [navDarkMap, setNavDarkMap] = useState(true);
  const [headingUpOn, setHeadingUpOn] = useState(true);
  const [layoutNonce, setLayoutNonce] = useState(0);
  const lastFixRef = useRef<{ point: LatLng; timestamp: number } | null>(null);
  const rebuildTimerRef = useRef<number | null>(null);
  const viaPointsRef = useRef<ViaWaypoint[]>(initial.viaPoints);
  const viaHistoryRef = useRef<ViaHistory>(emptyViaHistory());
  const routeRequestIdRef = useRef(0);
  const startRef = useRef(start);
  const endRef = useRef(end);
  const headingRef = useRef(headingPoint);
  const formRef = useRef(form);
  headingRef.current = headingPoint;

  viaPointsRef.current = viaPoints;
  viaHistoryRef.current = viaHistory;
  startRef.current = start;
  endRef.current = end;
  headingRef.current = headingPoint;
  formRef.current = form;

  useEffect(() => {
    if (!routePlan) return;
    setSaveName((current) =>
      current.trim()
        ? current
        : defaultSavedWalkName(routePlan, form.walkShape),
    );
  }, [routePlan, form.walkShape]);

  const handleAlongProgress = useCallback((progress: AlongPathProgress | null) => {
    setAlongProgress(progress);
  }, []);

  const walkedPath = useMemo(() => {
    if (!routePlan || !alongProgress || alongProgress.alongMeters < 8) {
      return [];
    }
    return walkedPathPoints(routePlan, alongProgress.alongMeters);
  }, [routePlan, alongProgress]);

  const splitMarkers = useMemo(
    () => (routePlan ? buildSplitMarkers(routePlan) : []),
    [routePlan],
  );

  const nextTurn = useMemo(() => {
    if (!routePlan) return null;
    return nextTurnGuidance(
      routePlan.turns ?? [],
      routePlan.segments,
      alongProgress?.alongMeters ?? 0,
    );
  }, [routePlan, alongProgress?.alongMeters]);

  const rejoin = useMemo(() => {
    if (!routePlan || !gpsConsent || !currentPosition) return null;
    return rejoinPathGuidance(currentPosition, routePlan.segments);
  }, [routePlan, gpsConsent, currentPosition]);

  const pathHeadingDeg = useMemo(() => {
    if (!routePlan?.segments.length) return null;
    const hit = pointAtDistanceAlongRoute(
      routePlan.segments,
      alongProgress?.alongMeters ?? 0,
    );
    if (!hit) return null;
    const segment =
      routePlan.segments[hit.segmentIndex] ?? routePlan.segments[0];
    return headingDegrees(segment.start, segment.end);
  }, [routePlan, alongProgress?.alongMeters]);

  const headingUpDeg =
    navMode && headingUpOn ? gpsHeadingDeg ?? pathHeadingDeg : null;
  const mapTheme = navMode && navDarkMap ? "dark" : "light";

  function commitViaPoints(next: ViaWaypoint[]) {
    const ordered = sortViasBySequence(next);
    viaPointsRef.current = ordered;
    setViaPoints(ordered);
    return ordered;
  }

  function applyUserVias(next: ViaWaypoint[]) {
    setViaHistory((history) => recordViaHistory(history, viaPointsRef.current));
    commitViaPoints(next);
    if (startRef.current && endRef.current) {
      scheduleRebuild();
    }
  }

  function resetViaHistory() {
    setViaHistory(emptyViaHistory());
  }

  useEffect(() => {
    savePlannerState({
      form,
      start,
      end,
      routePlan,
      mapLocked: !pickingEnabled && Boolean(routePlan),
      gpsConsent,
      viaPoints,
    });
  }, [form, start, end, routePlan, pickingEnabled, gpsConsent, viaPoints]);

  useEffect(() => {
    const headingDeg =
      start && headingPoint ? headingDegrees(start, headingPoint) : null;
    applyShareToHistory(
      buildShareSearch({
        start,
        end,
        headingDeg,
        vias: sortViasBySequence(viaPoints).map((via) => via.location),
        walkShape: form.walkShape,
        targetMinutes: form.targetMinutes,
        loopSeed: form.loopSeed,
        routePreference: form.routePreference,
      }),
    );
  }, [
    start,
    end,
    headingPoint,
    viaPoints,
    form.walkShape,
    form.targetMinutes,
    form.loopSeed,
    form.routePreference,
  ]);

  useEffect(() => {
    if (fitNonce > 0) setFollowWalker(false);
  }, [fitNonce]);

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

        const rawHeading = position.coords.heading;
        let nextHeading =
          rawHeading != null && Number.isFinite(rawHeading) && rawHeading >= 0
            ? rawHeading
            : null;
        if (
          nextHeading == null &&
          previous &&
          haversineDistance(previous.point, nextPoint) >= 4
        ) {
          nextHeading = headingDegrees(previous.point, nextPoint);
        }
        if (nextHeading != null) {
          setGpsHeadingDeg(nextHeading);
        }

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
    const elevation = buildElevationProfile(routePlan);

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
        label: "Climb / descent",
        value: elevation.hasElevation
          ? `+${Math.round(elevation.gainMeters)} / −${Math.round(elevation.lossMeters)} m`
          : `${uphillCount} up / ${downhillCount} down`,
      },
    ];
  }, [routePlan]);

  function handleMapPick(point: LatLng) {
    if (!pickingEnabled) return;
    setError(null);
    const shape = form.walkShape;

    if (shape === "loop") {
      if (!start || headingPoint) {
        setStart(point);
        setEnd(null);
        setHeadingPoint(null);
        commitViaPoints([]);
        resetViaHistory();
        setLiveStats(null);
        return;
      }
      setHeadingPoint(point);
      return;
    }

    // Starting a new pick sequence: keep the existing route visible until a
    // successful rebuild, so a misclick doesn't wipe the path.
    if (!start || (start && end)) {
      setStart(point);
      setEnd(null);
      setHeadingPoint(null);
      commitViaPoints([]);
      resetViaHistory();
      setLiveStats(null);
      return;
    }

    setEnd(point);
  }

  function handleClearPoints() {
    setStart(null);
    setEnd(null);
    setRoutePlan(null);
    setAlongProgress(null);
    setLiveStats(null);
    setError(null);
    setPickingEnabled(true);
    commitViaPoints([]);
    resetViaHistory();
    setHeadingPoint(null);
    setCurrentPosition(null);
    lastFixRef.current = null;
    setGpsHeadingDeg(null);
    setFollowWalker(false);
    clearPlannerState();
    setSaveName("");
    setSaveNote("Cleared local session.");
  }

  function handleEditRoutePoints() {
    setPickingEnabled(true);
    setError(null);
    setSaveNote("Click the map to set a new start, then end, then rebuild.");
  }

  function handleClearVias() {
    if (!viaPointsRef.current.length) return;
    applyUserVias([]);
  }

  const pathHandles = useMemo(
    () => (routePlan ? buildPathHandles(routePlan, viaPoints) : []),
    [routePlan, viaPoints],
  );

  const pickHint = !pickingEnabled && routePlan
    ? "Click the colored path to dodge that street, or drag a blue square. Orange circles are vias — double-click to remove. Undo with Ctrl/⌘+Z."
    : form.walkShape === "loop"
      ? !start
        ? "Click the map (or use your location) to set a start, then build a timed loop."
        : headingPoint
          ? "Start and heading set. Build the timed loop — or click again to reset start."
          : "Optional: click a second point to aim the loop, then build."
      : !start
      ? "Click the map to set a start point."
      : !end
        ? routePlan
          ? "Existing route kept. Click the map to set a new end / turnaround direction, then rebuild."
          : form.walkShape === "out_and_back"
            ? "Click the map in the direction you want to walk, then build the out-and-back."
            : "Click the map to set an end point."
        : routePlan
          ? "Start and end set. Rebuild to refresh the walking plan."
          : "Start and end set. Build the walking plan.";

  async function rebuildRoute(
    nextVias: ViaWaypoint[],
    options?: { fit?: boolean; includeOsmHazards?: boolean },
  ) {
    const startPoint = startRef.current;
    const endPoint = endRef.current;
    const shape = formRef.current.walkShape ?? "point_to_point";
    if (!startPoint) {
      setError("Pick a start point on the map first.");
      return;
    }
    if (shape !== "loop" && !endPoint) {
      setError(
        shape === "out_and_back"
          ? "Click a second map point for the out-and-back direction."
          : "Pick both a start and end point on the map first.",
      );
      return;
    }

    const orderedVias = sortViasBySequence(nextVias);
    const requestSignature = viasSignature(orderedVias);
    const requestId = ++routeRequestIdRef.current;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/route", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          start: startPoint,
          end: endPoint ?? startPoint,
          direction: shape === "out_and_back" ? endPoint : undefined,
          heading:
            headingRef.current && startPoint
              ? headingDegrees(startPoint, headingRef.current)
              : undefined,
          walkShape: shape,
          targetMinutes: formRef.current.targetMinutes,
          loopSeed: formRef.current.loopSeed,
          vias: orderedVias.map((via) => via.location),
          profile: formRef.current,
          includeOsmHazards: options?.includeOsmHazards !== false,
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Unable to create the walking plan.");
      }

      // A newer rebuild started — discard this response.
      if (requestId !== routeRequestIdRef.current) {
        return;
      }

      // Vias changed while this request was in flight — rebuild with the latest set.
      if (viasSignature(viaPointsRef.current) !== requestSignature) {
        scheduleRebuild();
        return;
      }

      const snapped = Array.isArray(result.snappedVias)
        ? (result.snappedVias as LatLng[])
        : [];
      if (snapped.length === orderedVias.length && orderedVias.length > 0) {
        commitViaPoints(applySnappedViaLocations(orderedVias, snapped));
      }

      const turnaround = result.turnaround as LatLng | undefined;
      if (
        turnaround &&
        shape === "out_and_back" &&
        !viaPointsRef.current.some((via) => via.id === TURNAROUND_VIA_ID)
      ) {
        commitViaPoints([
          ...viaPointsRef.current,
          {
            id: TURNAROUND_VIA_ID,
            location: turnaround,
            sequence: Number(result.totalDistanceMeters ?? 0) / 2,
          },
        ]);
      }

      setRoutePlan(result as RoutePlan);
      setLiveStats(null);
      setPickingEnabled(false);
      lastFixRef.current = null;
      if (options?.fit !== false) {
        setFitNonce((n) => n + 1);
      }
      setSaveNote(
        orderedVias.length
          ? `Plan updated with ${orderedVias.length} avoidance via(s).`
          : "Plan saved in this browser for next visit.",
      );
    } catch (requestError) {
      if (requestId !== routeRequestIdRef.current) {
        return;
      }
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to create the walking plan.",
      );
    } finally {
      if (requestId === routeRequestIdRef.current) {
        setLoading(false);
      }
    }
  }

  function scheduleRebuild(nextVias?: ViaWaypoint[]) {
    if (rebuildTimerRef.current != null) {
      window.clearTimeout(rebuildTimerRef.current);
    }
    rebuildTimerRef.current = window.setTimeout(() => {
      void rebuildRoute(nextVias ?? viaPointsRef.current, {
        fit: false,
        includeOsmHazards: false,
      });
    }, 400);
  }

  function handleViaMoved(viaId: string, location: LatLng) {
    applyUserVias(updateViaLocation(viaPointsRef.current, viaId, location, routePlan));
  }

  function handleViaRemoved(viaId: string) {
    applyUserVias(removeVia(viaPointsRef.current, viaId));
  }

  function handleHandleDropped(
    handle: Parameters<typeof upsertViaFromHandle>[1],
    location: LatLng,
  ) {
    if (viaPointsRef.current.length >= MAX_AVOIDANCE_VIAS) {
      setError(
        `At most ${MAX_AVOIDANCE_VIAS} avoidance vias — remove one before adding another.`,
      );
      return;
    }
    applyUserVias(
      upsertViaFromHandle(viaPointsRef.current, handle, location, routePlan),
    );
  }

  function handlePathClicked(point: LatLng) {
    if (!routePlan) return;
    if (viaPointsRef.current.length >= MAX_AVOIDANCE_VIAS) {
      setError(
        `At most ${MAX_AVOIDANCE_VIAS} avoidance vias — remove one before adding another.`,
      );
      return;
    }
    const next = viaFromBlockedPathClick(viaPointsRef.current, routePlan, point);
    if (!next) {
      setSaveNote("Click closer to the walking path to dodge that street.");
      return;
    }
    applyUserVias(next);
    setSaveNote("Dropped an avoidance via off that street. Drag it if the detour is the wrong side.");
  }

  function handleUndoVias() {
    const undone = undoViaHistory(viaHistoryRef.current, viaPointsRef.current);
    if (!undone) return;
    viaHistoryRef.current = undone.history;
    setViaHistory(undone.history);
    commitViaPoints(undone.vias);
    scheduleRebuild();
  }

  function handleRedoVias() {
    const redone = redoViaHistory(viaHistoryRef.current, viaPointsRef.current);
    if (!redone) return;
    viaHistoryRef.current = redone.history;
    setViaHistory(redone.history);
    commitViaPoints(redone.vias);
    scheduleRebuild();
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const key = event.key.toLowerCase();
      const modifier = event.metaKey || event.ctrlKey;
      if (!modifier || key !== "z") return;
      event.preventDefault();
      if (event.shiftKey) handleRedoVias();
      else handleUndoVias();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function handleBuildRoute() {
    await rebuildRoute(viaPointsRef.current, {
      fit: true,
      includeOsmHazards: true,
    });
  }

  function handleShuffleLoop() {
    const nextSeed = (formRef.current.loopSeed ?? 0) + 1;
    const nextForm = { ...formRef.current, loopSeed: nextSeed };
    formRef.current = nextForm;
    setForm(nextForm);
    void rebuildRoute(viaPointsRef.current, {
      fit: true,
      includeOsmHazards: true,
    });
  }

  function handleUseMyLocation() {
    if (!("geolocation" in navigator)) {
      setError("This browser does not support geolocation.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        setStart(point);
        setCurrentPosition(point);
        if (form.walkShape === "loop") {
          setEnd(null);
        }
        setSaveNote("Start set from your current location.");
      },
      (geoError) => {
        setError(geoError.message || "Could not read your location.");
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  function handleExportGpx() {
    if (!routePlan) return;
    downloadRouteGpx(routePlan, {
      start,
      end,
      vias: viaPoints.map((via) => via.location),
    });
    setSaveNote("Downloaded GPX for this walking route.");
  }

  async function handleCopyLink() {
    if (!start) {
      setSaveNote("Set a start point before copying a share link.");
      return;
    }
    const headingDeg =
      headingPoint && start ? headingDegrees(start, headingPoint) : null;
    const shareInput = {
      start,
      end,
      headingDeg,
      vias: sortViasBySequence(viaPoints).map((via) => via.location),
      walkShape: form.walkShape,
      targetMinutes: form.targetMinutes,
      loopSeed: form.loopSeed,
      routePreference: form.routePreference,
    };
    const url = shareUrlFromState(
      window.location.origin,
      window.location.pathname,
      shareInput,
    );
    try {
      await navigator.clipboard.writeText(url);
      applyShareToHistory(buildShareSearch(shareInput));
      setSaveNote(
        "Link copied. It opens this start, end, and vias — they still need to Build (GraphHopper credits).",
      );
    } catch {
      setError("Could not copy the link. Copy the address bar instead.");
    }
  }

  function handleSaveWalk() {
    if (!routePlan || !start) {
      setSaveNote("Build a walking plan before saving it.");
      return;
    }
    const result = saveWalk({
      name: saveName,
      start,
      end,
      headingPoint,
      viaPoints: sortViasBySequence(viaPoints),
      routePlan,
      walkShape: form.walkShape,
      targetMinutes: form.targetMinutes,
      loopSeed: form.loopSeed,
      routePreference: form.routePreference,
    });
    if (!result) {
      setError("Could not save this walk in the browser (storage may be full).");
      return;
    }
    setSavedWalks(listSavedWalks());
    setError(null);
    const dropped =
      result.dropped > 0
        ? ` Oldest saved walk${result.dropped === 1 ? " was" : "s were"} removed (max ${MAX_SAVED_WALKS}).`
        : "";
    setSaveNote(
      `Saved “${result.walk.name}” on this device. Load it later without using GraphHopper credits.${dropped}`,
    );
  }

  function handleLoadSavedWalk(id: string) {
    const walk = getSavedWalk(id);
    if (!walk) {
      setError("That saved walk is no longer in this browser.");
      setSavedWalks(listSavedWalks());
      return;
    }
    setForm((current) => ({
      ...current,
      walkShape: walk.walkShape,
      targetMinutes: walk.targetMinutes,
      loopSeed: walk.loopSeed,
      routePreference: walk.routePreference,
    }));
    setStart(walk.start);
    setEnd(walk.end);
    setHeadingPoint(walk.headingPoint);
    commitViaPoints(normalizeViaPoints(walk.viaPoints));
    resetViaHistory();
    setRoutePlan(walk.routePlan);
    setPickingEnabled(false);
    setFitNonce((nonce) => nonce + 1);
    setAlongProgress(null);
    setLiveStats(null);
    setError(null);
    setSaveName(walk.name);
    setSaveNote(
      `Loaded “${walk.name}”. No GraphHopper call — rebuild only if you want a new path or today’s HR profile.`,
    );
  }

  function handleDeleteSavedWalk(id: string) {
    const walk = savedWalks.find((item) => item.id === id);
    deleteSavedWalk(id);
    setSavedWalks(listSavedWalks());
    setSaveNote(
      walk ? `Removed “${walk.name}” from this browser.` : "Removed saved walk.",
    );
  }

  function handleWalkFinished(stats: WalkFinishStats) {
    if (!routePlan) return;
    const result = saveWalkLog({
      ...stats,
      name:
        saveName.trim() ||
        defaultSavedWalkName(routePlan, form.walkShape),
      walkShape: form.walkShape,
    });
    if (!result) {
      setSaveNote("Could not save this finish to history (storage may be full).");
      return;
    }
    const logs = listWalkLogs();
    setWalkLogs(logs);
    const vsPrevious = compareToPrevious(result.record, logs);
    setFinishNote(vsPrevious);
    setSaveNote(
      `Logged this finish${vsPrevious ? ` — ${vsPrevious}` : ""}. Recent finishes stay on this device.`,
    );
  }

  function handleDeleteWalkLog(id: string) {
    const log = walkLogs.find((item) => item.id === id);
    deleteWalkLog(id);
    setWalkLogs(listWalkLogs());
    setSaveNote(log ? `Removed finish “${log.name}”.` : "Removed finish.");
  }

  function handleEnableGps() {
    setGpsConsent(true);
    setFollowWalker(true);
    setFollowNonce((nonce) => nonce + 1);
    setError(null);
    setSaveNote(
      "GPS enabled. Recenter follows you on the map; drag the map to look around.",
    );
  }

  function handleDisableGps() {
    setGpsConsent(false);
    setCurrentPosition(null);
    setLiveStats(null);
    setGpsHeadingDeg(null);
    setFollowWalker(false);
    lastFixRef.current = null;
  }

  function handleRecenter() {
    if (!currentPosition) {
      setSaveNote("Enable GPS to recenter the map on you.");
      return;
    }
    setFollowWalker(true);
    setFollowNonce((nonce) => nonce + 1);
  }

  function enterNavMode() {
    if (!routePlan) return;
    setNavMode(true);
    setPickingEnabled(false);
    setFollowWalker(true);
    setFollowNonce((nonce) => nonce + 1);
    setLayoutNonce((nonce) => nonce + 1);
    if (!gpsConsent) {
      setGpsConsent(true);
    }
  }

  function exitNavMode() {
    setNavMode(false);
    setLayoutNonce((nonce) => nonce + 1);
  }

  function handleWalkingChange(walking: boolean) {
    if (walking) enterNavMode();
  }

  function handleSearchStart(hit: GeocodeHit) {
    setStart(hit.location);
    setPickingEnabled(true);
    setFitNonce((nonce) => nonce + 1);
    setSaveNote(`Start set to ${hit.label}. Build when you are ready.`);
  }

  function handleSearchEnd(hit: GeocodeHit) {
    setEnd(hit.location);
    setPickingEnabled(true);
    setFitNonce((nonce) => nonce + 1);
    setSaveNote(`End set to ${hit.label}. Build when you are ready.`);
  }

  return (
    <div className={`${styles.page}${navMode ? ` ${styles.pageNav}` : ""}`}>
      {navMode ? null : (
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
      )}

      <main className={styles.grid}>
        <aside className={styles.sidebar}>
          <div className={styles.card}>
            <h2>Profile</h2>
            <p className={styles.cardText}>
              {getWorkoutCopy(form.workoutLevel)} with a live speed target tuned to route slope.
            </p>

            <PlaceSearch
              near={start}
              disabled={loading}
              onSetStart={handleSearchStart}
              onSetEnd={handleSearchEnd}
            />

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
              <span>Walk shape</span>
              <select
                value={form.walkShape}
                onChange={(event) => {
                  const walkShape = parseWalkShape(event.target.value);
                  setForm((current) => ({ ...current, walkShape, loopSeed: 0 }));
                  setHeadingPoint(null);
                  setPickingEnabled(true);
                }}
              >
                <option value="point_to_point">Point to point</option>
                <option value="loop">Timed loop from start</option>
                <option value="out_and_back">Timed out-and-back</option>
              </select>
            </label>
            {form.walkShape !== "point_to_point" ? (
              <>
                <label className={styles.field}>
                  <span>Target duration (minutes)</span>
                  <input
                    type="number"
                    min="10"
                    max="180"
                    step="5"
                    value={form.targetMinutes}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        targetMinutes: Number(event.target.value),
                      }))
                    }
                  />
                </label>
                <p className={styles.cardText}>
                  {walkShapeLabel(form.walkShape)} aiming for about{" "}
                  {formatDistance(
                    targetDistanceMeters(
                      form.targetMinutes,
                      typicalWalkSpeedMps(form.minSpeedMps, form.maxSpeedMps),
                    ),
                  )}{" "}
                  at your interval mix.
                </p>
              </>
            ) : null}

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
              {loading
                ? "Building route..."
                : form.walkShape === "loop"
                  ? "Build timed loop"
                  : form.walkShape === "out_and_back"
                    ? "Build out-and-back"
                    : "Build aerobic walking plan"}
            </button>
            {form.walkShape === "loop" ? (
              <button
                className={styles.secondaryButton}
                onClick={handleShuffleLoop}
                disabled={loading || !start}
                type="button"
              >
                Shuffle another loop
              </button>
            ) : null}
            <button
              className={styles.secondaryButton}
              onClick={handleUseMyLocation}
              disabled={loading}
              type="button"
            >
              Start from my location
            </button>
            <button
              className={styles.secondaryButton}
              onClick={handleExportGpx}
              disabled={!routePlan}
              type="button"
            >
              Download GPX
            </button>
            <button
              className={styles.secondaryButton}
              onClick={handleCopyLink}
              disabled={!start}
              type="button"
            >
              Copy share link
            </button>
            <button
              className={styles.secondaryButton}
              onClick={handleEditRoutePoints}
              disabled={loading || pickingEnabled}
              type="button"
            >
              Change start & end
            </button>
            <button
              className={styles.secondaryButton}
              onClick={handleClearVias}
              disabled={loading || viaPoints.length === 0}
              type="button"
            >
              Clear avoidance vias ({viaPoints.length})
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
            <h2>Saved walks</h2>
            <p className={styles.cardText}>
              Keep built plans on this device so you can walk them again without spending
              GraphHopper credits. Share links still need Build; saved walks do not.
            </p>
            {routePlan ? (
              <>
                <label className={styles.field}>
                  <span>Name</span>
                  <input
                    type="text"
                    maxLength={80}
                    value={saveName}
                    onChange={(event) => setSaveName(event.target.value)}
                  />
                </label>
                <button
                  className={styles.primaryButton}
                  type="button"
                  onClick={handleSaveWalk}
                  disabled={loading}
                >
                  Save this walk
                </button>
              </>
            ) : (
              <p className={styles.pickHint}>
                Build a route first, then save it here.
              </p>
            )}
            {savedWalks.length ? (
              <div className={styles.savedWalkList}>
                {savedWalks.map((walk) => (
                  <div key={walk.id} className={styles.savedWalkRow}>
                    <div>
                      <strong>{walk.name}</strong>
                      <span>
                        {new Date(walk.savedAt).toLocaleString()} ·{" "}
                        {formatDistance(walk.routePlan.totalDistanceMeters)} ·{" "}
                        {formatDuration(walk.routePlan.estimatedDurationSeconds)}
                        {walk.viaPoints.length
                          ? ` · ${walk.viaPoints.length} via(s)`
                          : ""}
                      </span>
                    </div>
                    <div className={styles.savedWalkActions}>
                      <button
                        type="button"
                        className={styles.savedWalkButton}
                        onClick={() => handleLoadSavedWalk(walk.id)}
                        disabled={loading}
                      >
                        Load
                      </button>
                      <button
                        type="button"
                        className={styles.savedWalkButton}
                        onClick={() => handleDeleteSavedWalk(walk.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.pickHint}>No saved walks on this device yet.</p>
            )}
          </div>

          <div className={styles.card}>
            <h2>Recent finishes</h2>
            <p className={styles.cardText}>
              Completing a walk saves time, splits, and estimated kcal on this device.
              PC demo speed (10×) is not logged.
            </p>
            {walkLogs.length ? (
              <div className={styles.savedWalkList}>
                {walkLogs.map((log) => (
                  <div key={log.id} className={styles.savedWalkRow}>
                    <div>
                      <strong>{log.name}</strong>
                      <span>
                        {new Date(log.finishedAt).toLocaleString()} ·{" "}
                        {formatDistance(log.distanceMeters)} ·{" "}
                        {formatDuration(log.elapsedSeconds)} (
                        {formatPlanDelta(log.elapsedSeconds, log.plannedSeconds)})
                        {" · ~"}
                        {log.kcal} kcal
                      </span>
                    </div>
                    <div className={styles.savedWalkActions}>
                      <button
                        type="button"
                        className={styles.savedWalkButton}
                        onClick={() => handleDeleteWalkLog(log.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.pickHint}>
                Finish a walk to start a history. Load a saved plan anytime — this list is
                results, not routes.
              </p>
            )}
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
                ? currentPosition
                  ? `GPS on — the map follows you (Recenter if you pan away). On-path within ${ON_ROUTE_MAX_METERS} m drives intervals; farther uses the clock.`
                  : "GPS on — waiting for a fix. Recenter will follow you once a position arrives."
                : "GPS off — walk mode still works on the interval clock (best for PC)."}
            </p>
          </div>

          <div className={styles.card}>
            <h2>Map steps</h2>
            <ol className={styles.steps}>
              <li>Choose point-to-point, a timed loop, or a timed out-and-back.</li>
              <li>Click start (and end or “this way” as needed), or use your location.</li>
              <li>Choose path preference (fastest / avoid stairs / flatter).</li>
              <li>Build the route — the map stays interactive. Shuffle a loop to try another tour.</li>
              <li>Download GPX to walk it in another app or watch.</li>
              <li>Save the walk on this device to reopen it later without GraphHopper credits.</li>
              <li>Copy a share link for start/end/vias — the other person still needs to Build.</li>
              <li>Click the colored path (or drag a blue square) to dodge a blocked street.</li>
              <li>Undo via edits with Ctrl/⌘+Z. Drag an orange via if the detour is the wrong side.</li>
              <li>Press “Change start & end” if you need new endpoints.</li>
              <li>Optionally enable GPS for live pace guidance on the path. Recenter follows you; drag the map to look around.</li>
              <li>Kilometer ticks mark the path. Walk mode records split times and a finish summary.</li>
              <li>Finishing a walk (not 10× demo) saves it under Recent finishes.</li>
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
              onRoute={isOnRoute(liveStats?.distanceToRouteMeters)}
              currentPosition={currentPosition}
              onAlongProgress={handleAlongProgress}
              gpsEnabled={gpsConsent && currentPosition != null}
              distanceToRouteMeters={liveStats?.distanceToRouteMeters ?? null}
              weightKg={form.weightKg}
              finishNote={finishNote}
              onWalkFinished={handleWalkFinished}
              onWalkingChange={handleWalkingChange}
            />
          ) : null}

          {error ? <div className={styles.errorBox}>{error}</div> : null}
        </aside>

        <section className={styles.mapPanel}>
          <div className={styles.mapFrame}>
            <LeafletMap
              start={start}
              end={end}
              routePoints={routePlan?.points ?? []}
              segmentSpeedPlan={routePlan?.speedPlan ?? null}
              hazards={routePlan?.hazards ?? []}
              currentPosition={currentPosition}
              onPickPoint={handleMapPick}
              pickingEnabled={pickingEnabled && !navMode}
              viaPoints={navMode ? [] : viaPoints}
              pathHandles={navMode ? [] : pathHandles}
              onViaMoved={handleViaMoved}
              onViaRemoved={handleViaRemoved}
              onHandleDropped={handleHandleDropped}
              onPathClicked={navMode ? undefined : handlePathClicked}
              headingPoint={form.walkShape === "loop" ? headingPoint : null}
              endLabel={
                form.walkShape === "out_and_back" ? "Turnaround toward" : "End"
              }
              fitNonce={fitNonce}
              walkedPath={walkedPath}
              walkerOnPath={
                alongProgress && alongProgress.alongMeters >= 8
                  ? alongProgress.location
                  : null
              }
              followTarget={currentPosition}
              followEnabled={
                followWalker && !pickingEnabled && currentPosition != null
              }
              followNonce={followNonce}
              onFollowInterrupted={() => setFollowWalker(false)}
              gpsHeadingDeg={gpsHeadingDeg}
              splitMarkers={splitMarkers}
              nextTurn={rejoin ? null : nextTurn}
              rejoin={rejoin}
              mapTheme={mapTheme}
              headingUpDeg={headingUpDeg}
              layoutNonce={layoutNonce}
            />
            {rejoin ? (
              <div
                className={`${styles.mapTurnBanner} ${styles.mapTurnBannerApproaching}`}
              >
                <strong>
                  Off path · {formatDistance(rejoin.metersAway)}
                </strong>
                <span>
                  This way back to the route — intervals stay on the clock
                  until you rejoin.
                </span>
              </div>
            ) : nextTurn ? (
              <div
                className={`${styles.mapTurnBanner}${
                  nextTurn.approaching ? ` ${styles.mapTurnBannerApproaching}` : ""
                }`}
              >
                <strong>
                  {nextTurn.approaching
                    ? "Turn now"
                    : `In ${formatDistance(nextTurn.metersAway)}`}
                </strong>
                <span>{nextTurn.turn.text}</span>
                {nextTurn.thenTurn ? (
                  <em className={styles.mapThenTurn}>
                    Then {nextTurn.thenTurn.text}
                  </em>
                ) : null}
              </div>
            ) : null}
            {routePlan && !navMode ? (
              <div className={styles.mapPathOverlay}>
                <strong>
                  Click the path to dodge a blocked street ({pathHandles.length} handles)
                </strong>
                <span>
                  Orange vias mark detours — drag or double-click to remove.
                  Ctrl/⌘+Z undoes. Extra vias are chained for GraphHopper free tier.
                  {viaPoints.length ? ` · ${viaPoints.length} via(s)` : ""}
                  {loading ? " · Updating…" : ""}
                  {gpsConsent && liveStats && !isOnRoute(liveStats.distanceToRouteMeters)
                    ? ` · ${formatDistance(liveStats.distanceToRouteMeters)} off the path`
                    : followWalker && currentPosition
                      ? " · Following you"
                      : ""}
                </span>
                <div className={styles.mapOverlayActions}>
                  <button
                    type="button"
                    className={styles.mapOverlayButton}
                    onClick={enterNavMode}
                  >
                    Navigate
                  </button>
                  <button
                    type="button"
                    className={styles.mapOverlayButton}
                    onClick={handleRecenter}
                    disabled={!currentPosition}
                  >
                    {followWalker && currentPosition ? "Following" : "Recenter"}
                  </button>
                  <button
                    type="button"
                    className={styles.mapOverlayButton}
                    onClick={handleUndoVias}
                    disabled={loading || viaHistory.past.length === 0}
                  >
                    Undo
                  </button>
                  <button
                    type="button"
                    className={styles.mapOverlayButton}
                    onClick={handleRedoVias}
                    disabled={loading || viaHistory.future.length === 0}
                  >
                    Redo
                  </button>
                  <button
                    type="button"
                    className={styles.mapOverlayButton}
                    onClick={handleClearVias}
                    disabled={loading || viaPoints.length === 0}
                  >
                    Clear vias
                  </button>
                </div>
              </div>
            ) : null}
            {routePlan && navMode ? (
              <div className={styles.mapNavBar}>
                <button
                  type="button"
                  className={styles.mapOverlayButton}
                  onClick={exitNavMode}
                >
                  Planner
                </button>
                <button
                  type="button"
                  className={styles.mapOverlayButton}
                  onClick={handleRecenter}
                  disabled={!currentPosition}
                >
                  {followWalker && currentPosition ? "Following" : "Recenter"}
                </button>
                <button
                  type="button"
                  className={styles.mapOverlayButton}
                  onClick={() => setNavDarkMap((value) => !value)}
                >
                  {navDarkMap ? "Light map" : "Dark map"}
                </button>
                <button
                  type="button"
                  className={styles.mapOverlayButton}
                  onClick={() => setHeadingUpOn((value) => !value)}
                >
                  {headingUpOn ? "North up" : "Heading up"}
                </button>
              </div>
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
              <ElevationProfileChart
                plan={routePlan}
                alongMeters={alongProgress?.alongMeters ?? 0}
              />
            ) : null}

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
                {routePlan.turns?.some((turn) => !isSilentTurn(turn)) ? (
                  <div className={styles.instructions}>
                    <h3>Turn-by-turn</h3>
                    <ul>
                      {routePlan.turns
                        .filter((turn) => !isSilentTurn(turn))
                        .slice(0, 10)
                        .map((turn, idx) => (
                          <li key={`${turn.alongMeters}-${idx}`}>
                            {formatDistance(turn.alongMeters)}: {turn.text}
                          </li>
                        ))}
                    </ul>
                  </div>
                ) : null}
                {routePlan.instructionSummary.length ? (
                  <div className={styles.instructions}>
                    <h3>Route notes</h3>
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
