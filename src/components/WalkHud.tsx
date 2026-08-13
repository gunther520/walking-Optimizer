"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  getWalkProgress,
  pacePatternName,
  paceRoleHint,
  paceRoleLabel,
  playIntervalCue,
} from "@/lib/pace-style";
import { formatDistance, formatDuration } from "@/lib/route-math";
import {
  shouldAnnounceTurn,
  spokenRoleText,
  spokenTurnText,
  speakWalkCue,
  stopWalkSpeech,
  upcomingTurn,
} from "@/lib/turns";
import type { PaceRole, RoutePlan } from "@/types/workout";
import {
  getAlongPathProgress,
  type AlongPathProgress,
} from "@/lib/walk-along";
import { isOnRoute, offPathMessage } from "@/lib/walk-follow";
import { formatPlanDelta, type WalkFinishStats } from "@/lib/walk-log";
import {
  buildSplitMarkers,
  completedSplitStats,
  currentSplitSummary,
  estimatedKcalWalked,
  isWalkFinished,
  splitAnnounceText,
  updateSplitCrossings,
  type SplitCrossing,
} from "@/lib/walk-splits";

import styles from "@/app/page.module.css";

type WalkHudProps = {
  routePlan: RoutePlan;
  liveSegmentIndex: number | null;
  /** True only when GPS fix is near the planned path. */
  onRoute: boolean;
  currentPosition?: { lat: number; lng: number } | null;
  onAlongProgress?: (progress: AlongPathProgress | null) => void;
  gpsEnabled?: boolean;
  distanceToRouteMeters?: number | null;
  weightKg?: number;
  finishNote?: string | null;
  onWalkFinished?: (stats: WalkFinishStats) => void;
};

const DEMO_SPEED = 10;
const VOICE_STORAGE_KEY = "walking-optimizer:voice";

function readVoicePref() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(VOICE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeVoicePref(on: boolean) {
  try {
    window.localStorage.setItem(VOICE_STORAGE_KEY, on ? "1" : "0");
  } catch {
    // Private mode — ignore.
  }
}

export function WalkHud({
  routePlan,
  liveSegmentIndex,
  onRoute,
  currentPosition = null,
  onAlongProgress,
  gpsEnabled = false,
  distanceToRouteMeters = null,
  weightKg = 68,
  finishNote = null,
  onWalkFinished,
}: WalkHudProps) {
  const [walking, setWalking] = useState(false);
  const [cuesOn, setCuesOn] = useState(true);
  const [voiceOn, setVoiceOn] = useState(readVoicePref);
  const [demoFast, setDemoFast] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [lastCueNote, setLastCueNote] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const [crossings, setCrossings] = useState<SplitCrossing[]>([]);
  const pausedElapsedRef = useRef(0);
  const walkingSinceRef = useRef<number | null>(null);
  const lastRoleRef = useRef<string | null>(null);
  const lastSpokenTurnRef = useRef<number | null>(null);
  const lastOffPathRef = useRef<boolean | null>(null);
  const reportedFinishRef = useRef(false);
  const onWalkFinishedRef = useRef(onWalkFinished);
  onWalkFinishedRef.current = onWalkFinished;
  const routeId = `${routePlan.segments.length}-${Math.round(routePlan.totalDistanceMeters)}`;

  useEffect(() => {
    setWalking(false);
    pausedElapsedRef.current = 0;
    walkingSinceRef.current = null;
    setElapsedSeconds(0);
    lastRoleRef.current = null;
    lastSpokenTurnRef.current = null;
    lastOffPathRef.current = null;
    reportedFinishRef.current = false;
    setFinished(false);
    setCrossings([]);
    setLastCueNote(null);
    stopWalkSpeech();
  }, [routeId]);

  useEffect(() => {
    if (!walking) {
      if (walkingSinceRef.current != null) {
        const speed = demoFast ? DEMO_SPEED : 1;
        pausedElapsedRef.current +=
          Math.floor((performance.now() - walkingSinceRef.current) / 1000) *
          speed;
        walkingSinceRef.current = null;
        setElapsedSeconds(pausedElapsedRef.current);
      }
      return;
    }

    walkingSinceRef.current = performance.now();
    const timer = window.setInterval(() => {
      const since = walkingSinceRef.current;
      if (since == null) return;
      const speed = demoFast ? DEMO_SPEED : 1;
      setElapsedSeconds(
        pausedElapsedRef.current +
          Math.floor((performance.now() - since) / 1000) * speed,
      );
    }, 400);

    return () => window.clearInterval(timer);
  }, [walking, demoFast]);

  const progress = getWalkProgress(
    routePlan,
    liveSegmentIndex,
    elapsedSeconds,
    { onRoute },
  );
  const along = useMemo(
    () =>
      getAlongPathProgress(routePlan, elapsedSeconds, {
        onRoute,
        currentPosition,
      }),
    [routePlan, elapsedSeconds, onRoute, currentPosition],
  );
  const role = progress.block?.paceRole ?? null;
  const nextTurn = upcomingTurn(routePlan.turns ?? [], along.alongMeters);
  const metersToTurn = nextTurn
    ? Math.max(0, nextTurn.alongMeters - along.alongMeters)
    : null;
  const offPath =
    gpsEnabled &&
    distanceToRouteMeters != null &&
    !isOnRoute(distanceToRouteMeters);
  const offPathText =
    offPath && distanceToRouteMeters != null
      ? offPathMessage(distanceToRouteMeters)
      : null;
  const splitMarkers = useMemo(
    () => buildSplitMarkers(routePlan),
    [routePlan],
  );
  const splitNow = currentSplitSummary(
    routePlan,
    splitMarkers,
    along.alongMeters,
    elapsedSeconds,
    crossings,
  );
  const completedSplits = completedSplitStats(
    routePlan,
    splitMarkers,
    crossings,
  );
  const kcal = Math.round(
    estimatedKcalWalked(
      routePlan,
      along.alongMeters,
      elapsedSeconds,
      weightKg,
    ),
  );

  useEffect(() => {
    onAlongProgress?.(along);
  }, [along, onAlongProgress]);

  useEffect(() => {
    return () => onAlongProgress?.(null);
  }, [onAlongProgress]);

  useEffect(() => {
    if (!walking || !role) return;
    if (lastRoleRef.current === role) return;
    if (lastRoleRef.current != null) {
      if (cuesOn) {
        playIntervalCue(role);
        setLastCueNote(
          `Cue played: switch to ${paceRoleLabel(role)} (${pacePatternName(role)})`,
        );
      }
      if (voiceOn) {
        speakWalkCue(spokenRoleText(role));
        if (!cuesOn) setLastCueNote(spokenRoleText(role));
      }
    }
    lastRoleRef.current = role;
  }, [walking, cuesOn, voiceOn, role]);

  useEffect(() => {
    if (!walking || !voiceOn || !nextTurn) return;
    if (!shouldAnnounceTurn(nextTurn, along.alongMeters)) return;
    if (lastSpokenTurnRef.current === nextTurn.alongMeters) return;
    lastSpokenTurnRef.current = nextTurn.alongMeters;
    const phrase = spokenTurnText(nextTurn, along.alongMeters);
    speakWalkCue(phrase);
    setLastCueNote(phrase);
  }, [walking, voiceOn, nextTurn, along.alongMeters]);

  useEffect(() => {
    if (!walking || !gpsEnabled || distanceToRouteMeters == null) return;
    const off = !isOnRoute(distanceToRouteMeters);
    if (lastOffPathRef.current === off) return;
    if (lastOffPathRef.current == null) {
      lastOffPathRef.current = off;
      return;
    }
    lastOffPathRef.current = off;
    const phrase = off
      ? offPathMessage(distanceToRouteMeters) ??
        "You are off the path"
      : "Back on the route";
    if (voiceOn) {
      speakWalkCue(phrase);
    }
    setLastCueNote(phrase);
  }, [walking, voiceOn, gpsEnabled, distanceToRouteMeters]);

  useEffect(() => {
    if (!walking && elapsedSeconds === 0) return;
    const next = updateSplitCrossings(
      splitMarkers,
      along.alongMeters,
      elapsedSeconds,
      crossings,
    );
    if (!next.newlyCrossed.length) return;
    setCrossings(next.crossings);
    if (!walking) return;
    const latest = next.newlyCrossed[next.newlyCrossed.length - 1];
    const phrase = splitAnnounceText(latest.alongMeters);
    if (voiceOn) speakWalkCue(phrase);
    setLastCueNote(phrase);
  }, [
    splitMarkers,
    along.alongMeters,
    elapsedSeconds,
    crossings,
    walking,
    voiceOn,
  ]);

  useEffect(() => {
    if (!walking || finished) return;
    if (
      !isWalkFinished(
        along.totalMeters,
        along.remainingMeters,
        along.alongMeters,
      )
    ) {
      return;
    }
    setFinished(true);
    setWalking(false);
    if (voiceOn) speakWalkCue("Walk complete");
    setLastCueNote("Walk complete");
    if (demoFast || reportedFinishRef.current) return;
    reportedFinishRef.current = true;
    onWalkFinishedRef.current?.({
      distanceMeters: along.alongMeters,
      elapsedSeconds,
      plannedSeconds: routePlan.estimatedDurationSeconds,
      kcal,
      splits: completedSplits,
    });
  }, [
    walking,
    finished,
    along,
    voiceOn,
    demoFast,
    elapsedSeconds,
    routePlan.estimatedDurationSeconds,
    kcal,
    completedSplits,
  ]);

  useEffect(() => {
    if (!walking || typeof navigator === "undefined" || !("wakeLock" in navigator)) {
      return;
    }

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    async function requestLock() {
      try {
        sentinel = await navigator.wakeLock.request("screen");
      } catch {
        sentinel = null;
      }
    }

    void requestLock();
    const onVisibility = () => {
      if (document.visibilityState === "visible" && !cancelled) {
        void requestLock();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void sentinel?.release();
    };
  }, [walking]);

  function handleStart() {
    if (elapsedSeconds === 0) {
      lastRoleRef.current = null;
      lastSpokenTurnRef.current = null;
      lastOffPathRef.current = null;
      reportedFinishRef.current = false;
      setFinished(false);
      setCrossings([]);
    }
    setWalking(true);
    if (progress.block && lastRoleRef.current == null) {
      if (cuesOn) {
        playIntervalCue(progress.block.paceRole);
      }
      if (voiceOn) {
        speakWalkCue(spokenRoleText(progress.block.paceRole));
      }
      lastRoleRef.current = progress.block.paceRole;
      if (cuesOn || voiceOn) {
        setLastCueNote(
          voiceOn
            ? spokenRoleText(progress.block.paceRole)
            : `Cue played: start ${paceRoleLabel(progress.block.paceRole)}`,
        );
      }
    }
  }

  function handlePause() {
    setWalking(false);
    stopWalkSpeech();
  }

  function handleReset() {
    setWalking(false);
    pausedElapsedRef.current = 0;
    walkingSinceRef.current = null;
    setElapsedSeconds(0);
    lastRoleRef.current = null;
    lastSpokenTurnRef.current = null;
    lastOffPathRef.current = null;
    reportedFinishRef.current = false;
    setFinished(false);
    setCrossings([]);
    setLastCueNote(null);
    stopWalkSpeech();
  }

  function handleTestCue(nextRole: PaceRole = "push") {
    playIntervalCue(nextRole);
    if (voiceOn) {
      speakWalkCue(spokenRoleText(nextRole));
    }
    setLastCueNote(
      `Test cue: ${paceRoleLabel(nextRole)} beep${voiceOn ? " + voice" : ""} (vibration needs a phone)`,
    );
  }

  function handleVoiceToggle(on: boolean) {
    setVoiceOn(on);
    writeVoicePref(on);
    if (on) {
      speakWalkCue("Voice on. I will call out turns and interval changes.");
      setLastCueNote("Voice on — turns and interval changes will be spoken.");
    } else {
      stopWalkSpeech();
    }
  }

  const roleClass =
    role === "push"
      ? styles.rolePush
      : role === "rest"
        ? styles.roleRest
        : styles.roleSteady;

  return (
    <div className={styles.walkHud}>
      <div className={styles.walkHudHeader}>
        <h2>Walk mode</h2>
        <div className={styles.walkHudToggles}>
          <label className={styles.cueToggle}>
            <input
              type="checkbox"
              checked={cuesOn}
              onChange={(event) => setCuesOn(event.target.checked)}
            />
            Sound cues
          </label>
          <label className={styles.cueToggle}>
            <input
              type="checkbox"
              checked={voiceOn}
              onChange={(event) => handleVoiceToggle(event.target.checked)}
            />
            Voice
          </label>
        </div>
      </div>

      <p className={styles.walkHudStatus}>
        {offPath && distanceToRouteMeters != null
          ? `GPS is ${formatDistance(distanceToRouteMeters)} off the path — intervals use the clock until you rejoin.`
          : progress.mode === "gps" && onRoute
            ? "Tracking GPS on the route — intervals follow your position."
            : demoFast
              ? "Clock mode ×10 (PC demo) — role changes ~every 18s / 6s."
              : "Clock mode — on PC, intervals advance by time (~180s push, then ~60s recovery). Beep and voice fire when the role changes."}
        {walking
          ? " Screen stays on while you walk, if this browser allows it."
          : ""}
      </p>
      {offPathText ? (
        <p className={styles.walkOffPath}>{offPathText}</p>
      ) : null}

      <div className={`${styles.walkHudMain} ${roleClass}`}>
        <span className={styles.walkHudEyebrow}>
          {finished ? "Finished" : walking ? "Current interval" : "Ready"}
        </span>
        <strong className={styles.walkHudRole}>
          {role ? paceRoleLabel(role) : "—"}
          {role ? (
            <span className={styles.walkHudPattern}>
              {" "}
              · {pacePatternName(role)} line
            </span>
          ) : null}
        </strong>
        <p className={styles.walkHudHint}>
          {role ? paceRoleHint(role) : "Start walk to begin interval cues."}
        </p>
        <div className={styles.walkProgress}>
          <div
            className={styles.walkProgressFill}
            style={{ width: `${Math.min(100, along.fraction * 100)}%` }}
          />
        </div>
        <p className={styles.walkProgressLabel}>
          {formatDistance(along.alongMeters)} of{" "}
          {formatDistance(along.totalMeters)}
          {" · "}
          {formatDistance(along.remainingMeters)} remaining
        </p>
        {splitMarkers.length && !finished ? (
          <p className={styles.walkSplitLine}>
            Km {splitNow.index}
            {" · "}
            {formatDuration(Math.round(splitNow.actualSeconds))} this split
            {" / plan "}
            {formatDuration(Math.round(splitNow.plannedSeconds))}
          </p>
        ) : null}
        {nextTurn && !finished ? (
          <p className={styles.walkNextTurn}>
            Next turn in {formatDistance(metersToTurn ?? 0)}: {nextTurn.text}
          </p>
        ) : walking ? (
          <p className={styles.walkNextTurn}>No further turns — continue to the finish.</p>
        ) : null}
        {finished ? (
          <div className={styles.walkFinish}>
            <strong>Walk complete</strong>
            <p>
              {formatDuration(elapsedSeconds)} elapsed · plan{" "}
              {formatDuration(Math.round(routePlan.estimatedDurationSeconds))}
              {" · "}
              {formatPlanDelta(
                elapsedSeconds,
                routePlan.estimatedDurationSeconds,
              )}
            </p>
            <p>
              {formatDistance(along.alongMeters)} · ~{kcal} kcal
            </p>
            {finishNote ? <p>{finishNote}</p> : null}
            {demoFast ? (
              <p className={styles.walkSplitList}>
                PC demo finishes are not saved to history.
              </p>
            ) : null}
            {completedSplits.length ? (
              <p className={styles.walkSplitList}>
                {completedSplits
                  .map(
                    (split) =>
                      `${split.label} km ${formatDuration(Math.round(split.actualSeconds))} (plan ${formatDuration(Math.round(split.plannedSeconds))})`,
                  )
                  .join(" · ")}
              </p>
            ) : null}
          </div>
        ) : (
          <div className={styles.walkHudCountdown}>
            {formatDuration(Math.round(progress.remainingSeconds))}
            <span>left until next role change / cue</span>
          </div>
        )}
      </div>

      <div className={styles.walkHudMeta}>
        <div>
          <span>Next</span>
          <strong>
            {progress.nextBlock
              ? `${paceRoleLabel(progress.nextBlock.paceRole)} · ${pacePatternName(progress.nextBlock.paceRole)} · ${formatDuration(progress.nextBlock.durationSeconds)}`
              : "Finish"}
          </strong>
        </div>
        <div>
          <span>Elapsed</span>
          <strong>{formatDuration(elapsedSeconds)}</strong>
        </div>
      </div>

      {lastCueNote ? (
        <p className={styles.walkHudCueNote}>{lastCueNote}</p>
      ) : null}

      <label className={styles.cueToggle}>
        <input
          type="checkbox"
          checked={demoFast}
          onChange={(event) => setDemoFast(event.target.checked)}
        />
        PC demo speed (10×) — hear cues without waiting 3 minutes
      </label>

      <div className={styles.walkHudActions}>
        {!walking ? (
          <button className={styles.primaryButton} type="button" onClick={handleStart}>
            {elapsedSeconds > 0 || finished ? "Resume walk" : "Start walk"}
          </button>
        ) : (
          <button className={styles.secondaryButton} type="button" onClick={handlePause}>
            Pause
          </button>
        )}
        <button
          className={styles.secondaryButton}
          type="button"
          onClick={handleReset}
          disabled={!walking && elapsedSeconds === 0}
        >
          Reset
        </button>
      </div>
      <button
        className={styles.secondaryButton}
        type="button"
        onClick={() => handleTestCue(role ?? "push")}
      >
        Test beep now
      </button>
    </div>
  );
}
