import { buildSegments } from "@/lib/route-math";
import { headingDegrees } from "@/lib/time-budget";
import { buildCumulativeDistances, pointAtDistanceAlongRoute } from "@/lib/via-points";
import type { LatLng, PaceRole, RouteSegment, RouteTurn } from "@/types/workout";

/** GraphHopper instruction signs we treat as "keep going" (no spoken cue). */
const CONTINUE_SIGN = 0;
/** Via reached — noisy and not useful as a spoken turn. */
const VIA_REACHED_SIGN = 5;

/** Speak when the walker is this close to the next turn. */
export const TURN_ANNOUNCE_METERS = 45;
/** Consider a turn passed once the walker is this far beyond it. */
const TURN_PASSED_METERS = 12;

export type GraphHopperInstruction = {
  text?: string;
  street_name?: string;
  distance?: number;
  sign?: number;
  interval?: [number, number] | number[];
};

export function isSilentTurn(turn: RouteTurn) {
  if (turn.sign === CONTINUE_SIGN || turn.sign === VIA_REACHED_SIGN) return true;
  const text = turn.text.trim().toLowerCase();
  if (!text) return true;
  return text.startsWith("continue") || text.startsWith("keep going");
}

export function parseGraphHopperTurns(
  raw: GraphHopperInstruction[] | undefined,
  points: LatLng[],
): RouteTurn[] {
  if (!raw?.length) return [];
  if (points.length < 2) {
    return raw.flatMap((instruction) => {
      const text = instruction.text?.trim() ?? "";
      if (!text) return [];
      return [
        {
          alongMeters: 0,
          text,
          streetName: instruction.street_name?.trim() ?? "",
          sign: Number(instruction.sign ?? 0),
          distanceMeters: Number(instruction.distance ?? 0) || 0,
        },
      ];
    });
  }

  const { offsets, totalMeters } = buildCumulativeDistances(buildSegments(points));
  let cursor = 0;

  return raw.flatMap((instruction) => {
    const text = instruction.text?.trim() ?? "";
    if (!text) return [];

    const fromIdx = Array.isArray(instruction.interval)
      ? instruction.interval[0]
      : undefined;
    const alongFromInterval =
      typeof fromIdx === "number" && Number.isFinite(fromIdx)
        ? (offsets[Math.min(Math.max(0, fromIdx), offsets.length - 1)] ?? 0)
        : null;
    const alongMeters = alongFromInterval ?? cursor;
    const distanceMeters = Number(instruction.distance ?? 0);
    cursor = Math.min(
      totalMeters,
      alongMeters + (Number.isFinite(distanceMeters) ? Math.max(0, distanceMeters) : 0),
    );

    return [
      {
        alongMeters,
        text,
        streetName: instruction.street_name?.trim() ?? "",
        sign: Number(instruction.sign ?? 0),
        distanceMeters: Number.isFinite(distanceMeters) ? Math.max(0, distanceMeters) : 0,
      },
    ];
  });
}

export function offsetTurns(turns: RouteTurn[], offsetMeters: number): RouteTurn[] {
  if (!offsetMeters) return turns;
  return turns.map((turn) => ({
    ...turn,
    alongMeters: turn.alongMeters + offsetMeters,
  }));
}

export function instructionTexts(turns: RouteTurn[]): string[] {
  return turns.map((turn) => turn.text).filter(Boolean);
}

export function upcomingTurn(
  turns: RouteTurn[],
  alongMeters: number,
): RouteTurn | null {
  for (const turn of turns) {
    if (isSilentTurn(turn)) continue;
    if (turn.alongMeters + TURN_PASSED_METERS >= alongMeters) return turn;
  }
  return null;
}

export type TurnGuidance = {
  turn: RouteTurn;
  location: LatLng;
  headingDeg: number;
  metersAway: number;
  approaching: boolean;
};

/** Next actionable turn snapped onto the walked polyline. */
export function nextTurnGuidance(
  turns: RouteTurn[],
  segments: RouteSegment[],
  alongMeters: number,
): TurnGuidance | null {
  const turn = upcomingTurn(turns, alongMeters);
  if (!turn || !segments.length) return null;
  const hit = pointAtDistanceAlongRoute(segments, turn.alongMeters);
  if (!hit) return null;
  const segment = segments[hit.segmentIndex] ?? segments[0];
  return {
    turn,
    location: hit.location,
    headingDeg: headingDegrees(segment.start, segment.end),
    metersAway: Math.max(0, turn.alongMeters - alongMeters),
    approaching: shouldAnnounceTurn(turn, alongMeters),
  };
}

export function shouldAnnounceTurn(
  turn: RouteTurn,
  alongMeters: number,
  announceWithin = TURN_ANNOUNCE_METERS,
) {
  const remaining = turn.alongMeters - alongMeters;
  return remaining >= -8 && remaining <= announceWithin;
}

export function spokenTurnText(turn: RouteTurn, alongMeters: number) {
  const remaining = Math.max(0, turn.alongMeters - alongMeters);
  const body = turn.text.replace(/\.$/, "");
  if (remaining <= TURN_PASSED_METERS) return body;
  const rounded = Math.max(10, Math.round(remaining / 10) * 10);
  const lead = body.charAt(0).toLowerCase() + body.slice(1);
  return `In ${rounded} meters, ${lead}`;
}

export function spokenRoleText(role: PaceRole) {
  if (role === "push") return "Starting brisk";
  if (role === "rest") return "Starting easy";
  return "Starting steady";
}

export function speakWalkCue(text: string) {
  if (typeof window === "undefined" || !window.speechSynthesis || !text.trim()) {
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.05;
  utterance.lang = "en-US";
  window.speechSynthesis.speak(utterance);
}

export function stopWalkSpeech() {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
}
