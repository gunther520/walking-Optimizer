import type { PaceBlockSummary, PaceRole, RoutePlan } from "@/types/workout";

export function paceRoleLabel(role: PaceRole) {
  if (role === "push") return "Push";
  if (role === "rest") return "Rest";
  return "Steady";
}

export function paceRoleHint(role: PaceRole) {
  if (role === "push") return "Pick up the pace — Zone 2 ceiling";
  if (role === "rest") return "Ease off — Zone 1 recovery";
  return "Hold a strong walk — low Zone 2";
}

/** Line pattern so roles are not color-only. */
export function paceDashArray(role: PaceRole): string | undefined {
  if (role === "push") return undefined; // solid
  if (role === "steady") return "12 10";
  return "3 10"; // rest — dotted
}

export function pacePatternName(role: PaceRole) {
  if (role === "push") return "solid";
  if (role === "steady") return "dashed";
  return "dotted";
}

export function paceStrokeColor(role: PaceRole) {
  if (role === "push") return "#ef4444";
  if (role === "rest") return "#2563eb";
  return "#16a34a";
}

export function findPaceBlockAtSegment(
  paceBlocks: PaceBlockSummary[],
  segmentIndex: number,
) {
  const index = paceBlocks.findIndex(
    (block) =>
      segmentIndex >= block.startSegmentIndex &&
      segmentIndex <= block.endSegmentIndex,
  );
  if (index < 0) {
    return { block: null as PaceBlockSummary | null, index: -1 };
  }
  return { block: paceBlocks[index], index };
}

export function getWalkProgress(
  plan: RoutePlan,
  segmentIndex: number | null,
  elapsedSeconds: number,
  options?: { onRoute?: boolean },
): {
  block: PaceBlockSummary | null;
  blockIndex: number;
  remainingSeconds: number;
  nextBlock: PaceBlockSummary | null;
  mode: "gps" | "clock";
} {
  const blocks = plan.paceBlocks ?? [];
  if (!blocks.length) {
    return {
      block: null,
      blockIndex: -1,
      remainingSeconds: 0,
      nextBlock: null,
      mode: "clock",
    };
  }

  // Only trust GPS when the walker is actually near the path.
  // On a PC, geolocation often snaps to a far-off "nearest" segment and would
  // freeze the HUD if we preferred it over the interval clock.
  const onRoute = options?.onRoute === true;
  if (onRoute && segmentIndex != null && segmentIndex >= 0) {
    const found = findPaceBlockAtSegment(blocks, segmentIndex);
    if (found.block) {
      const span =
        found.block.endSegmentIndex - found.block.startSegmentIndex + 1;
      const into = Math.min(
        span,
        Math.max(0, segmentIndex - found.block.startSegmentIndex + 0.5),
      );
      const fractionDone = span > 0 ? into / span : 0;
      const remainingSeconds = Math.max(
        0,
        found.block.durationSeconds * (1 - fractionDone),
      );
      return {
        block: found.block,
        blockIndex: found.index,
        remainingSeconds,
        nextBlock: blocks[found.index + 1] ?? null,
        mode: "gps",
      };
    }
  }

  let remaining = Math.max(0, elapsedSeconds);
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    if (remaining < block.durationSeconds) {
      return {
        block,
        blockIndex: i,
        remainingSeconds: block.durationSeconds - remaining,
        nextBlock: blocks[i + 1] ?? null,
        mode: "clock",
      };
    }
    remaining -= block.durationSeconds;
  }

  const last = blocks[blocks.length - 1];
  return {
    block: last,
    blockIndex: blocks.length - 1,
    remainingSeconds: 0,
    nextBlock: null,
    mode: "clock",
  };
}

export function playIntervalCue(role: PaceRole) {
  if (typeof window === "undefined") return;

  try {
    if ("vibrate" in navigator) {
      const pattern =
        role === "push" ? [120, 60, 120] : role === "rest" ? [40, 40, 40] : [80];
      navigator.vibrate(pattern);
    }
  } catch {
    // Ignore vibration failures (unsupported / denied).
  }

  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value =
      role === "push" ? 880 : role === "rest" ? 440 : 660;
    gain.gain.value = 0.0001;
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    oscillator.start(now);
    oscillator.stop(now + 0.25);
    oscillator.onended = () => {
      void ctx.close();
    };
  } catch {
    // Ignore audio failures (autoplay policy / unsupported).
  }
}

/** Short double-beep + pulse when a turn is within announcement range. */
export function playTurnCue() {
  if (typeof window === "undefined") return;

  try {
    if ("vibrate" in navigator) {
      navigator.vibrate([70, 50, 140]);
    }
  } catch {
    // Ignore vibration failures (unsupported / denied).
  }

  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    for (const [offset, freq] of [
      [0, 740],
      [0.16, 980],
    ] as const) {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = freq;
      gain.gain.value = 0.0001;
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      const start = now + offset;
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
      oscillator.start(start);
      oscillator.stop(start + 0.16);
    }
    window.setTimeout(() => {
      void ctx.close();
    }, 500);
  } catch {
    // Ignore audio failures (autoplay policy / unsupported).
  }
}
