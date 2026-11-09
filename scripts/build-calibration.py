#!/usr/bin/env python3
"""Build the Model Calibration dataset rendered on /track-record.

For every graded pick in results-tracker.md that carries BOTH a published
price and a stated edge (the tracker's Edge column, present from the
Oct 16, 2026 tables on), compute the pick's predicted win% exactly the
way the site displays it (src/lib/winprob.ts convention):

    fair odds   = published american odds - edge_cents
    predicted % = implied probability of the fair odds

then bucket realized win rate (wins / decisions, pushes excluded) by
predicted band: <50, 50-54, 55-59, 60-64, 65+.

It also fits the DISPLAY recalibration mapping: an isotonic regression
(pool-adjacent-violators, weighted, monotonic non-decreasing) over the
INDIVIDUAL decided picks (raw predicted % -> win/loss), emitted as a
step function `fit.breakpoints` ([{upTo, fitted, n}, ...] covering
0-100, fitted clamped to [5, 95]). One small-sample guard on top of
textbook PAVA: any block with support n < MIN_BLOCK_N is pooled into
its nearer-mean neighbor (merging adjacent blocks of a monotone step
keeps it monotone). Without it, the 2026-11-07 fit put a 3-pick
all-wins tail block at fitted 100 (clamped 95) — a raw 70% pick would
have displayed 95% on three picks' evidence. src/lib/winprob.ts
applies this fit to model probabilities at render time only — the raw
model numbers stay in the feed and drive gates/sorting/grading
untouched. Per-band `meanFitted` is the mean of the fitted step over
the band's picks (what members actually see for picks in that band).

Pick selection is NOT re-implemented here: this script imports the
canonical verified parser (parse_track_picks.py — the same parse the
optimizer and the epoch scoreboard use), so the numbers reproduce from
the tracker by construction. Bands with n<30 are flagged `thin` and the
page daggers them; no thin band is ever headlined.

Usage:
    build-calibration.py [tracker_path] [parser_path] [out_path]
Defaults:
    tracker  ~/workspace/sports-betting/results-tracker.md
    parser   ~/workspace/sports-betting/parse_track_picks.py
    out      <repo>/src/lib/calibration.json

Rerun after grading days accumulate; commit the regenerated JSON.
"""
import importlib.util
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_TRACKER = os.path.expanduser("~/workspace/sports-betting/results-tracker.md")
DEFAULT_PARSER = os.path.expanduser("~/workspace/sports-betting/parse_track_picks.py")
DEFAULT_OUT = os.path.join(REPO, "src", "lib", "calibration.json")

BANDS = [
    ("<50", 0.0, 50.0),
    ("50–54", 50.0, 55.0),
    ("55–59", 55.0, 60.0),
    ("60–64", 60.0, 65.0),
    ("65+", 65.0, 1000.0),
]
THIN_N = 30


def implied_pct(american: int) -> float:
    if american < 0:
        return (-american) / (-american + 100) * 100
    return 100 / (american + 100) * 100


FIT_LO, FIT_HI = 5.0, 95.0
MIN_BLOCK_N = 5


def _merge_pair(a, b):
    return {"w": a["w"] + b["w"], "y": a["y"] + b["y"], "xmax": b["xmax"]}


def isotonic_breakpoints(points):
    """Weighted isotonic regression (PAVA) on (x, y) points, y in {0, 1}.

    Returns a step function as [{upTo, fitted, n}, ...]: for a raw x,
    the fitted % is the `fitted` of the first breakpoint whose
    `upTo` >= x. Blocks span the observed x-range; the final breakpoint
    is extended to upTo=100 so the step covers 0-100 (x below the first
    block takes the first block's value). Fitted values are monotonic
    non-decreasing and clamped to [FIT_LO, FIT_HI].

    Small-sample guard: after PAVA converges, any block with support
    n < MIN_BLOCK_N is pooled into its nearer-mean neighbor (edge
    blocks take their only neighbor), repeating until every block has
    support or one block remains. Merging adjacent blocks of a monotone
    step preserves monotonicity.
    """
    pts = sorted(points)  # by x, then y
    # Stack of blocks: {w: count, y: wins, xmax: largest x in block}.
    blocks = []
    for x, y in pts:
        blocks.append({"w": 1.0, "y": float(y), "xmax": x})
        while len(blocks) >= 2 and (
            blocks[-2]["y"] / blocks[-2]["w"] > blocks[-1]["y"] / blocks[-1]["w"]
        ):
            top = blocks.pop()
            prev = blocks.pop()
            blocks.append(_merge_pair(prev, top))
    # Minimum-support pooling.
    while len(blocks) > 1:
        small = next((i for i, b in enumerate(blocks) if b["w"] < MIN_BLOCK_N), None)
        if small is None:
            break
        mean = blocks[small]["y"] / blocks[small]["w"]
        if small == 0:
            j = 1
        elif small == len(blocks) - 1:
            j = small - 1
        else:
            left = abs(blocks[small - 1]["y"] / blocks[small - 1]["w"] - mean)
            right = abs(blocks[small + 1]["y"] / blocks[small + 1]["w"] - mean)
            j = small - 1 if left <= right else small + 1
        lo, hi = min(small, j), max(small, j)
        blocks[lo : hi + 1] = [_merge_pair(blocks[lo], blocks[hi])]
    steps = []
    for b in blocks:
        fitted = round(min(FIT_HI, max(FIT_LO, b["y"] / b["w"] * 100)), 1)
        up_to = round(b["xmax"], 1)
        if steps and steps[-1]["fitted"] == fitted:
            steps[-1]["upTo"] = up_to  # same fitted value: widen the step
            steps[-1]["n"] += int(b["w"])
        else:
            steps.append({"upTo": up_to, "fitted": fitted, "n": int(b["w"])})
    if steps:
        steps[-1]["upTo"] = 100.0
    return steps


def apply_fit(steps, raw_pct):
    """Evaluate the emitted step function exactly as winprob.ts does."""
    for s in steps:
        if raw_pct <= s["upTo"]:
            return s["fitted"]
    return steps[-1]["fitted"] if steps else raw_pct


def main() -> int:
    tracker = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_TRACKER
    parser_path = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_PARSER
    out_path = sys.argv[3] if len(sys.argv) > 3 else DEFAULT_OUT

    spec = importlib.util.spec_from_file_location("parse_track_picks", parser_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    picks = mod.parse(tracker)

    usable = []
    skipped = {"no_edge": 0, "no_price": 0}
    for p in picks:
        m = re.fullmatch(r"(\d+)¢", (p.get("edge") or "").strip())
        if not m:
            skipped["no_edge"] += 1
            continue
        line = (p.get("line") or "").replace("−", "-").strip()
        lm = re.fullmatch(r"([+-]?\d+)", line)
        if not lm:
            skipped["no_price"] += 1
            continue
        odds = int(lm.group(1))
        if abs(odds) < 100:
            skipped["no_price"] += 1
            continue
        fair = odds - int(m.group(1))
        if fair == 0:
            skipped["no_price"] += 1
            continue
        usable.append(
            {
                "date": p["date"],
                "predicted": implied_pct(fair),
                "result": p["result"],
            }
        )

    decided_all = [u for u in usable if u["result"] in ("Win", "Loss")]
    wins_all = sum(1 for u in decided_all if u["result"] == "Win")

    # Isotonic recalibration fit on the individual decided picks.
    steps = isotonic_breakpoints(
        [(u["predicted"], 1 if u["result"] == "Win" else 0) for u in decided_all]
    )
    for u in decided_all:
        u["fitted"] = apply_fit(steps, u["predicted"])
    mean_fitted = (
        round(sum(u["fitted"] for u in decided_all) / len(decided_all), 1)
        if decided_all
        else None
    )

    bands = []
    for label, lo, hi in BANDS:
        rows = [u for u in usable if lo <= u["predicted"] < hi]
        wins = sum(1 for u in rows if u["result"] == "Win")
        losses = sum(1 for u in rows if u["result"] == "Loss")
        pushes = sum(1 for u in rows if u["result"] == "Push")
        decided = wins + losses
        rows_decided = [u for u in rows if u["result"] in ("Win", "Loss")]
        bands.append(
            {
                "label": label,
                "n": decided,
                "wins": wins,
                "losses": losses,
                "pushes": pushes,
                "meanPredicted": round(sum(u["predicted"] for u in rows) / len(rows), 1)
                if rows
                else None,
                "meanFitted": round(
                    sum(u["fitted"] for u in rows_decided) / len(rows_decided), 1
                )
                if rows_decided
                else None,
                "realized": round(wins / decided * 100, 1) if decided else None,
                "thin": decided < THIN_N,
            }
        )
    data = {
        "source": "results-tracker.md via parse_track_picks.py (canonical verified parse)",
        "method": (
            "Predicted win% = implied probability of the brief's fair price "
            "(published american odds shifted by the stated edge in cents), "
            "the src/lib/winprob.ts convention. Realized win% excludes pushes."
        ),
        "windowStart": min(u["date"] for u in usable) if usable else None,
        "windowEnd": max(u["date"] for u in usable) if usable else None,
        "n": len(decided_all),
        "pushes": sum(1 for u in usable if u["result"] == "Push"),
        "meanPredicted": round(
            sum(u["predicted"] for u in decided_all) / len(decided_all), 1
        )
        if decided_all
        else None,
        "realized": round(wins_all / len(decided_all) * 100, 1) if decided_all else None,
        "meanFitted": mean_fitted,
        "fit": {
            "method": (
                "Isotonic regression (pool-adjacent-violators, weighted, "
                "monotonic non-decreasing) on the individual decided picks: "
                "raw predicted % -> fitted %. Step function: the fitted % of "
                "the first breakpoint whose upTo >= the raw %. Fitted values "
                "clamped to [5, 95]; blocks with support n<5 are pooled into "
                "their nearer-mean neighbor so no step rests on a handful of "
                "picks. Applied at display time only (src/lib/winprob.ts); "
                "raw model numbers stay in the feed."
            ),
            "n": len(decided_all),
            "breakpoints": steps,
        },
        "bands": bands,
    }
    with open(out_path, "w") as f:
        json.dump(data, f, indent=1)
    print(
        f"wrote {out_path}: n={data['n']} decided "
        f"({data['windowStart']}..{data['windowEnd']}), pushes={data['pushes']}, "
        f"skipped={skipped}"
    )
    for b in bands:
        print(
            f"  {b['label']:>6}: n={b['n']:>3}  model={b['meanPredicted']}  "
            f"fitted={b['meanFitted']}  realized={b['realized']}"
            f"{'  (thin)' if b['thin'] else ''}"
        )
    print(f"  fit: mean raw={data['meanPredicted']} -> mean fitted={mean_fitted} "
          f"(realized={data['realized']})")
    print("  breakpoints: " + ", ".join(
        f"<={s['upTo']}: {s['fitted']}" for s in steps))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
