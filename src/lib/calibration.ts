import data from "./calibration.json";

/**
 * Model calibration dataset (optimization follow-up to the 2026-11-08
 * win% display swap): for every graded pick with a published price +
 * stated edge, the model's predicted win% bucketed against what actually
 * happened. Generated from results-tracker.md by
 * scripts/build-calibration.py (canonical verified parse — the same one
 * the optimizer uses); rerun the script and commit the JSON to refresh.
 * Bands with n<30 are `thin` and render daggered, never headlined.
 *
 * `fit` is the isotonic recalibration step function the script fits on
 * the same picks; src/lib/winprob.ts applies it to MODEL probabilities
 * at display time only (the feed's raw win_prob and every gate, sort
 * and grading input stay raw — see winprob.ts).
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
  /** Mean of the fitted (displayed) win% over the band's decided picks. */
  meanFitted: number | null;
  /** Realized win% over decided picks (pushes excluded). */
  realized: number | null;
  thin: boolean;
}

export interface CalibrationFitStep {
  /** Raw predicted % ceiling for this step (first step with upTo >= raw applies). */
  upTo: number;
  /** Fitted (displayed) win% for raw predictions in this step. */
  fitted: number;
  /** Graded picks behind the step. */
  n: number;
}

export interface CalibrationFit {
  method: string;
  /** Decided graded picks the fit was trained on. */
  n: number;
  breakpoints: CalibrationFitStep[];
}

export interface CalibrationData {
  windowStart: string | null;
  windowEnd: string | null;
  /** Total decided picks with complete price + edge data. */
  n: number;
  pushes: number;
  meanPredicted: number | null;
  realized: number | null;
  /** Mean fitted (displayed) win% over the same picks. */
  meanFitted: number | null;
  fit: CalibrationFit;
  bands: CalibrationBand[];
}

export const CALIBRATION = data as unknown as CalibrationData;
