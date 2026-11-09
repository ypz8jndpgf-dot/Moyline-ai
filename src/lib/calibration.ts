import data from "./calibration.json";

/**
 * Model calibration dataset (optimization follow-up to the 2026-11-08
 * win% display swap): for every graded pick with a published price +
 * stated edge, the model's predicted win% bucketed against what actually
 * happened. Generated from results-tracker.md by
 * scripts/build-calibration.py (canonical verified parse — the same one
 * the optimizer uses); rerun the script and commit the JSON to refresh.
 * Bands with n<30 are `thin` and render daggered, never headlined.
 */
export interface CalibrationBand {
  label: string;
  /** Decided picks (wins + losses) in the band. */
  n: number;
  wins: number;
  losses: number;
  pushes: number;
  /** Mean predicted win% within the band. */
  meanPredicted: number | null;
  /** Realized win% over decided picks (pushes excluded). */
  realized: number | null;
  thin: boolean;
}

export interface CalibrationData {
  windowStart: string | null;
  windowEnd: string | null;
  /** Total decided picks with complete price + edge data. */
  n: number;
  pushes: number;
  meanPredicted: number | null;
  realized: number | null;
  bands: CalibrationBand[];
}

export const CALIBRATION = data as unknown as CalibrationData;
