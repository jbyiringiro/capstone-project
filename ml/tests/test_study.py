import random

import pytest

from vuga_ml.study import analyse, holm, sensitivity, summarise_participants, sus_score


def make_trials(n=20, reduction=0.30, seed=3):
    rng = random.Random(seed); trials = []
    for i in range(n):
        p = f"P{i:02d}"; base = 12.0
        for cond in ("static", "predictive"):
            for _ in range(10):
                taps = base * (1 - reduction if cond == "predictive" else 1) + rng.gauss(0, 0.8)
                trials.append({"participant": p, "condition": cond, "taps": round(taps), "duration_ms": taps * 1000,
                               "corrections": 0.0, "completed": True, "valid": True})
    return trials


def test_primary_analysis_detects_a_real_effect():
    r = analyse(make_trials())
    assert r["participants"] == 20
    h2 = r["primary_h2"]
    assert 25 < h2["mean_reduction_pct"] < 35
    assert h2["ci95"][0] < h2["mean_reduction_pct"] < h2["ci95"][1]
    assert h2["supports_improvement"]
    assert r["secondary_paired_tests"]["paired_t"]["p_one_sided"] < 0.001
    assert r["sensitivity"]["mde_pct_points_one_sided"] > 0


def test_null_effect_is_not_declared():
    r = analyse(make_trials(reduction=0.0))
    assert not r["primary_h2"]["supports_improvement"]
    assert not r["primary_h2"]["supports_target"]


def test_incomplete_pairs_are_disclosed_not_analysed():
    trials = make_trials(5)
    trials = [t for t in trials if not (t["participant"] == "P00" and t["condition"] == "predictive")]
    trials[0]["valid"] = False
    parts, excluded = summarise_participants(trials)
    assert [p.participant for p in parts] == ["P01", "P02", "P03", "P04"]
    assert excluded["participants_without_both_conditions"] == ["P00"]
    assert excluded["invalid_trials"] == 1


def test_sus_and_holm():
    assert sus_score([5, 1, 5, 1, 5, 1, 5, 1, 5, 1]) == 100.0
    assert sus_score([3, 3, 3, 3, 3, 3, 3, 3, 3, 3]) == 50.0
    with pytest.raises(ValueError):
        sus_score([1, 2, 3])
    h = holm({"kn_vs_uni": 0.01, "tf_vs_kn": 0.03})
    assert h["kn_vs_uni"]["p_holm"] == pytest.approx(0.02) and h["kn_vs_uni"]["reject"]
    assert h["tf_vs_kn"]["p_holm"] == pytest.approx(0.03) and h["tf_vs_kn"]["reject"]
    s = sensitivity(15.0, 20)
    assert 8 < s["mde_pct_points_one_sided"] < 10
