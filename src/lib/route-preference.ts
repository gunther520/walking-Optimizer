import type { RoutePreference } from "@/types/workout";

type CustomModel = {
  priority?: Array<{ if: string; multiply_by: string }>;
  distance_influence?: number;
};

/** Build GraphHopper custom_model for path preferences. */
export function buildRouteCustomModel(
  preference: RoutePreference,
): CustomModel | null {
  if (preference === "avoid_stairs") {
    return {
      priority: [{ if: "road_class == STEPS", multiply_by: "0" }],
    };
  }

  if (preference === "prefer_flat") {
    return {
      // Softly avoid stairs and steep grades when the profile supports slope encoding.
      priority: [
        { if: "road_class == STEPS", multiply_by: "0.05" },
        { if: "average_slope > 4", multiply_by: "0.25" },
        { if: "average_slope > 8", multiply_by: "0.08" },
      ],
      distance_influence: 90,
    };
  }

  return null;
}

export function routePreferenceLabel(preference: RoutePreference) {
  if (preference === "avoid_stairs") return "Avoid stairs";
  if (preference === "prefer_flat") return "Prefer flatter paths";
  return "Fastest walking route";
}
