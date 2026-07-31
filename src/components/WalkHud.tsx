"use client";

import { useEffect, useRef, useState } from "react";

import {
  getWalkProgress,
  pacePatternName,
  paceRoleHint,
  paceRoleLabel,
  playIntervalCue,
} from "@/lib/pace-style";
import { formatDuration } from "@/lib/route-math";
import type { RoutePlan } from "@/types/workout";

import styles from "@/app/page.module.css";

type WalkHudProps = {
  routePlan: RoutePlan;
  liveSegmentIndex: number | null;
};

export function WalkHud({ routePlan, liveSegmentIndex }: WalkHudProps) {
  const [walking, setWalking] = useState(false);
  const [cuesOn, setCuesOn] = useState(true);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const pausedElapsedRef = useRef(0);
  const walkingSinceRef = useRef<number | null>(null);
  const lastRoleRef = useRef<string | null>(null);

  useEffect(() => {
    if (!walking) {
      if (walkingSinceRef.current != null) {
        pausedElapsedRef.current += Math.floor(
          (performance.now() - walkingSinceRef.current) / 1000,
        );
        walkingSinceRef.current = null;
        setElapsedSeconds(pausedElapsedRef.current);
      }
      return;
    }

    walkingSinceRef.current = performance.now();
    const timer = window.setInterval(() => {
      const since = walkingSinceRef.current;
      if (since == null) return;
      setElapsedSeconds(
        pausedElapsedRef.current +
          Math.floor((performance.now() - since) / 1000),
      );
    }, 400);

    return () => window.clearInterval(timer);
  }, [walking]);

  const progress = getWalkProgress(
    routePlan,
    liveSegmentIndex,
    elapsedSeconds,
  );
  const role = progress.block?.paceRole ?? null;

  useEffect(() => {
    if (!walking || !cuesOn || !role) return;
    if (lastRoleRef.current === role) return;
    if (lastRoleRef.current != null) {
      playIntervalCue(role);
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
          Sound / vibrate cues
        </label>
      </div>

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
        <div className={styles.walkHudCountdown}>
          {formatDuration(Math.round(progress.remainingSeconds))}
          <span>left in interval</span>
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
    </div>
  );
}
