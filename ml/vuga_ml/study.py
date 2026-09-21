"""Analysis of the adult acceptance study exactly as pre-specified in proposal 3.2.3.

Input: one row per completed trial
    participant, condition (static|predictive), order (SP|PS), message_set (A|B), message_index,
    taps, duration_ms, corrections, completed (1/0), valid (1/0)

Primary outcome (H2): for participant i, S_i and P_i are mean all-action taps per message in the
static and predictive conditions; reduction_i = 100 * (S_i - P_i) / S_i. The estimate is the mean
of reduction_i with a 95% bootstrap interval that resamples whole participants. A lower limit
above zero supports improvement; a lower limit of at least 25 supports the target.
Secondary: paired t-test on participant mean tap differences when assumptions are suitable,
Wilcoxon signed-rank as a rank-based sensitivity analysis; time, corrections and SUS descriptive.
"""
from __future__ import annotations

import csv
import math
import random
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from scipy import stats

TARGET_REDUCTION = 25.0


@dataclass
class ParticipantSummary:
    participant: str
    static_taps: float
    predictive_taps: float
    static_seconds: float
    predictive_seconds: float
    static_corrections: float
    predictive_corrections: float
    n_static: int
    n_predictive: int

    @property
    def reduction(self) -> float:
        return 100.0 * (self.static_taps - self.predictive_taps) / self.static_taps

    @property
    def tap_diff(self) -> float:
        return self.static_taps - self.predictive_taps


def load_trials(path: str | Path) -> list[dict]:
    with open(path, encoding="utf-8", newline="") as fh:
        rows = []
        for r in csv.DictReader(fh):
            rows.append({"participant": r["participant"], "condition": r["condition"],
                         "taps": float(r["taps"]), "duration_ms": float(r["duration_ms"] or 0),
                         "corrections": float(r.get("corrections") or 0),
                         "completed": r.get("completed", "1") in ("1", "true", "yes"),
                         "valid": r.get("valid", "1") in ("1", "true", "yes")})
        return rows


def summarise_participants(trials: list[dict]) -> tuple[list[ParticipantSummary], dict]:
    """Complete pairs only; incomplete pairs and invalid trials are counted and disclosed."""
    by_p: dict[str, dict[str, list[dict]]] = defaultdict(lambda: {"static": [], "predictive": []})
    excluded = {"invalid_trials": 0, "incomplete_trials": 0, "participants_without_both_conditions": []}
    for t in trials:
        if not t["valid"]:
            excluded["invalid_trials"] += 1; continue
        if not t["completed"]:
            excluded["incomplete_trials"] += 1; continue
        by_p[t["participant"]][t["condition"]].append(t)
    out = []
    for p, conds in sorted(by_p.items()):
        s, q = conds["static"], conds["predictive"]
        if not s or not q:
            excluded["participants_without_both_conditions"].append(p); continue
        mean = lambda rows, k: sum(r[k] for r in rows) / len(rows)  # noqa: E731
        out.append(ParticipantSummary(p, mean(s, "taps"), mean(q, "taps"),
                                      mean(s, "duration_ms") / 1000, mean(q, "duration_ms") / 1000,
                                      mean(s, "corrections"), mean(q, "corrections"), len(s), len(q)))
    return out, excluded


def bootstrap_mean_reduction(parts: list[ParticipantSummary], iters: int = 10000, seed: int = 20260921) -> dict:
    red = [p.reduction for p in parts]
    rng = random.Random(seed)
    n = len(red)
    means = []
    for _ in range(iters):
        sample = [red[rng.randrange(n)] for _ in range(n)]
        means.append(sum(sample) / n)
    means.sort()
    lo, hi = means[int(0.025 * iters)], means[int(0.975 * iters) - 1]
    point = sum(red) / n
    return {"n": n, "mean_reduction_pct": point, "ci95": [lo, hi], "iters": iters,
            "supports_improvement": lo > 0, "supports_target": lo >= TARGET_REDUCTION,
            "sd_reduction": statistics_sd(red)}


def statistics_sd(x: list[float]) -> float:
    if len(x) < 2:
        return 0.0
    m = sum(x) / len(x)
    return math.sqrt(sum((v - m) ** 2 for v in x) / (len(x) - 1))


def paired_tests(parts: list[ParticipantSummary]) -> dict:
    s = np.array([p.static_taps for p in parts]); q = np.array([p.predictive_taps for p in parts])
    d = s - q
    out = {"mean_diff_taps": float(d.mean()), "sd_diff_taps": float(d.std(ddof=1)) if len(d) > 1 else 0.0}
    if len(d) >= 3:
        sh = stats.shapiro(d)
        out["shapiro_p"] = float(sh.pvalue)
        t = stats.ttest_rel(s, q, alternative="greater")
        out["paired_t"] = {"t": float(t.statistic), "p_one_sided": float(t.pvalue), "df": len(d) - 1}
        try:
            w = stats.wilcoxon(d, alternative="greater")
            out["wilcoxon"] = {"W": float(w.statistic), "p_one_sided": float(w.pvalue)}
        except ValueError as e:  # all differences zero
            out["wilcoxon"] = {"error": str(e)}
        out["normality_assumption_ok"] = out["shapiro_p"] > 0.05
    return out


def holm(pvalues: dict[str, float], alpha: float = 0.05) -> dict[str, dict]:
    """Holm step-down adjustment; used for the two prespecified H1 baseline comparisons."""
    items = sorted(pvalues.items(), key=lambda kv: kv[1])
    m = len(items); out = {}; running = 0.0; rejected = True
    for i, (k, p) in enumerate(items):
        adj = min(1.0, (m - i) * p); running = max(running, adj)
        rejected = rejected and running <= alpha
        out[k] = {"p": p, "p_holm": running, "reject": rejected}
    return out


def sus_score(responses: list[int]) -> float:
    """Standard SUS: odd items score r-1, even items 5-r, sum x 2.5 (Brooke, 1996)."""
    if len(responses) != 10 or any(not 1 <= r <= 5 for r in responses):
        raise ValueError("SUS needs ten responses on a 1-5 scale")
    total = sum((r - 1) if i % 2 == 0 else (5 - r) for i, r in enumerate(responses))
    return total * 2.5


def sensitivity(sd_reduction: float, n: int, alpha: float = 0.05, power: float = 0.8) -> dict:
    """Smallest mean reduction detectable against zero and the n needed for a given margin."""
    if n < 2:
        return {}
    t_a = stats.t.ppf(1 - alpha, n - 1); t_b = stats.t.ppf(power, n - 1)
    mde = (t_a + t_b) * sd_reduction / math.sqrt(n)
    return {"n": n, "sd_reduction": sd_reduction, "mde_pct_points_one_sided": mde}


def analyse(trials: list[dict], sus: dict[str, list[int]] | None = None) -> dict:
    parts, excluded = summarise_participants(trials)
    if not parts:
        return {"error": "no complete participant pairs", "excluded": excluded}
    report = {"participants": len(parts), "excluded": excluded,
              "primary_h2": bootstrap_mean_reduction(parts),
              "secondary_paired_tests": paired_tests(parts),
              "time_seconds_per_message": {
                  "static_mean": float(np.mean([p.static_seconds for p in parts])),
                  "predictive_mean": float(np.mean([p.predictive_seconds for p in parts]))},
              "corrections_per_message": {
                  "static_mean": float(np.mean([p.static_corrections for p in parts])),
                  "predictive_mean": float(np.mean([p.predictive_corrections for p in parts]))},
              "per_participant": [{"participant": p.participant, "S": p.static_taps, "P": p.predictive_taps,
                                   "reduction_pct": p.reduction} for p in parts]}
    report["sensitivity"] = sensitivity(report["primary_h2"]["sd_reduction"], len(parts))
    if sus:
        scores = [sus_score(v) for v in sus.values()]
        report["sus"] = {"n": len(scores), "mean": float(np.mean(scores)), "sd": float(np.std(scores, ddof=1)) if len(scores) > 1 else 0.0,
                         "target_70_met": float(np.mean(scores)) >= 70, "benchmark_68_met": float(np.mean(scores)) >= 68}
    return report
