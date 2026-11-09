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

    bands = []
    for label, lo, hi in BANDS:
        rows = [u for u in usable if lo <= u["predicted"] < hi]
        wins = sum(1 for u in rows if u["result"] == "Win")
        losses = sum(1 for u in rows if u["result"] == "Loss")
        pushes = sum(1 for u in rows if u["result"] == "Push")
        decided = wins + losses
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
                "realized": round(wins / decided * 100, 1) if decided else None,
                "thin": decided < THIN_N,
            }
        )

    decided_all = [u for u in usable if u["result"] in ("Win", "Loss")]
    wins_all = sum(1 for u in decided_all if u["result"] == "Win")
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
            f"realized={b['realized']}{'  (thin)' if b['thin'] else ''}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
