"use client";

import { useEffect, useRef, useState } from "react";

import type { GeocodeHit } from "@/lib/geocode";
import type { LatLng } from "@/types/workout";

import styles from "@/app/page.module.css";

type PlaceSearchProps = {
  near: LatLng | null;
  disabled?: boolean;
  onSetStart: (hit: GeocodeHit) => void;
  onSetEnd: (hit: GeocodeHit) => void;
};

export function PlaceSearch({
  near,
  disabled = false,
  onSetStart,
  onSetEnd,
}: PlaceSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const requestIdRef = useRef(0);
  const trimmed = query.trim();
  const visibleResults = trimmed.length < 2 ? [] : results;

  useEffect(() => {
    if (trimmed.length < 2) {
      return;
    }

    const handle = window.setTimeout(() => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setSearching(true);
      const params = new URLSearchParams({ q: trimmed });
      if (near) {
        params.set("lat", String(near.lat));
        params.set("lng", String(near.lng));
      }
      void fetch(`/api/geocode?${params}`)
        .then(async (response) => {
          const body = (await response.json()) as {
            results?: GeocodeHit[];
            error?: string;
          };
          if (requestId !== requestIdRef.current) return;
          if (!response.ok) {
            setResults([]);
            setError(body.error ?? "Place search failed.");
            return;
          }
          setResults(body.results ?? []);
          setError(null);
        })
        .catch(() => {
          if (requestId !== requestIdRef.current) return;
          setResults([]);
          setError("Could not search places right now.");
        })
        .finally(() => {
          if (requestId === requestIdRef.current) setSearching(false);
        });
    }, 400);

    return () => window.clearTimeout(handle);
  }, [trimmed, near]);

  return (
    <div className={styles.placeSearch}>
      <label className={styles.field}>
        <span>Find a place</span>
        <input
          type="search"
          value={query}
          disabled={disabled}
          placeholder="Park, MTR exit, address…"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {searching && trimmed.length >= 2 ? (
        <p className={styles.pickHint}>Searching…</p>
      ) : null}
      {error && trimmed.length >= 2 ? <p className={styles.saveNote}>{error}</p> : null}
      {visibleResults.length ? (
        <ul className={styles.placeSearchList}>
          {visibleResults.map((hit) => (
            <li key={`${hit.location.lat},${hit.location.lng},${hit.label}`}>
              <span>{hit.label}</span>
              <div className={styles.placeSearchActions}>
                <button
                  type="button"
                  className={styles.savedWalkButton}
                  disabled={disabled}
                  onClick={() => onSetStart(hit)}
                >
                  Start here
                </button>
                <button
                  type="button"
                  className={styles.savedWalkButton}
                  disabled={disabled}
                  onClick={() => onSetEnd(hit)}
                >
                  End here
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
