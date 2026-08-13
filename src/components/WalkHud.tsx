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
import type { PaceRole, RoutePlan } from "@/types/workout";
import {
  getAlongPathProgress,
  type AlongPathProgress,
} from "@/lib/walk-along";

import styles from "@/app/page.module.css";

type WalkHudProps = {
  routePlan: RoutePlan;
  liveSegmentIndex: number | null;
  /** True only when GPS fix is near the planned path. */
  onRoute: boolean;
  currentPosition?: { lat: number; lng: number } | null;
  onAlongProgress?: (progress: AlongPathProgress | null) => void;
};

const DEMO_SPEED = 10;

export function WalkHud({
  routePlan,
  liveSegmentIndex,
  onRoute,
  currentPosition = null,
  onAlongProgress,
}: WalkHudProps) {
  const [walking, setWalking] = useState(false);
  const [cuesOn, setCuesOn] = useState(true);
  const [demoFast, setDemoFast] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [lastCueNote, setLastCueNote] = useState<string | null>(null);
  const pausedElapsedRef = useRef(0);
  const walkingSinceRef = useRef<number | null>(null);
  const lastRoleRef = useRef<string | null>(null);
  const routeId = `${routePlan.segments.length}-${Math.round(routePlan.totalDistanceMeters)}`;

  useEffect(() => {
    setWalking(false);
    pausedElapsedRef.current = 0;
    walkingSinceRef.current = null;
    setElapsedSeconds(0);
    lastRoleRef.current = null;
    setLastCueNote(null);
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

  useEffect(() => {
    onAlongProgress?.(along);
  }, [along, onAlongProgress]);

  useEffect(() => {
    return () => onAlongProgress?.(null);
  }, [onAlongProgress]);

  useEffect(() => {
    if (!walking || !cuesOn || !role) return;
    if (lastRoleRef.current === role) return;
    if (lastRoleRef.current != null) {
      playIntervalCue(role);
      setLastCueNote(
        `Cue played: switch to ${paceRoleLabel(role)} (${pacePatternName(role)})`,
      );
    }
    lastRoleRef.current = role;
  }, [walking, cuesOn, role]);

  function handleStart() {
    if (elapsedSeconds === 0) {
      lastRoleRef.current = null;
    }
    setWalking(true);
    if (cuesOn && progress.block && lastRoleRef.current == null) {
      playIntervalCue(progress.block.paceRole);
      lastRoleRef.current = progress.block.paceRole;
      setLastCueNote(
        `Cue played: start ${paceRoleLabel(progress.block.paceRole)}`,
      );
    }
  }

  function handlePause() {
    setWalking(false);
  }

  function handleReset() {
    setWalking(false);
    pausedElapsedRef.current = 0;
    walkingSinceRef.current = null;
    setElapsedSeconds(0);
    lastRoleRef.current = null;
    setLastCueNote(null);
  }

  function handleTestCue(nextRole: PaceRole = "push") {
    playIntervalCue(nextRole);
    setLastCueNote(
      `Test cue: ${paceRoleLabel(nextRole)} beep (vibration needs a phone)`,
    );
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
        <label className={styles.cueToggle}>
          <input
            type="checkbox"
            checked={cuesOn}
            onChange={(event) => setCuesOn(event.target.checked)}
          />
          Sound cues
        </label>
      </div>

      <p className={styles.walkHudStatus}>
        {progress.mode === "gps" && onRoute
          ? "Tracking GPS on the route — intervals follow your position."
          : demoFast
            ? "Clock mode ×10 (PC demo) — role changes ~every 18s / 6s."
            : "Clock mode — on PC, intervals advance by time (~180s push, then ~60s recovery). Beep fires when the role changes."}
      </p>

      <div className={`${styles.walkHudMain} ${roleClass}`}>
        <span className={styles.walkHudEyebrow}>
          {walking ? "Current interval" : "Ready"}
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
        <div className={styles.walkHudCountdown}>
          {formatDuration(Math.round(progress.remainingSeconds))}
          <span>left until next role change / cue</span>
        </div>
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
            {elapsedSeconds > 0 ? "Resume walk" : "Start walk"}
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
