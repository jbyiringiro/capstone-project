"""Write the parity fixture for the browser port of the personal re-ranker.

  app/tests/prediction/fixtures/reranker_fixture.json   history, clock and expected rankings

The fixture reuses the KN artefact in kn_fixture.json, records a deterministic selection history
(including an enabled word the model never saw, as a caregiver's custom word would be) and stores
vuga_ml's re-ranked top-3 and full distributions, so app/src/prediction/PersonalReranker.js is
tested against the reference implementation on identical inputs.

Usage: python ml/scripts/export_reranker_fixture.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
sys.path.insert(0, str(ROOT))

from vuga_ml.models import KneserNeyTrigram, PersonalReranker  # noqa: E402
from vuga_ml.models.reranker import PersonalHistory  # noqa: E402

FIXTURES = REPO / "app" / "tests" / "prediction" / "fixtures"
UNSEEN = "CUSTOM-FIXTURE"
START = 1_790_000_000.0  # seconds; any fixed instant works because only differences matter


def main() -> None:
    kn_fixture = json.loads((FIXTURES / "kn_fixture.json").read_text(encoding="utf-8"))
    model = KneserNeyTrigram.from_dict(kn_fixture["artifact"])
    reranker = PersonalReranker(model)

    messages = [case["prefix"] for case in kn_fixture["cases"] if len(case["prefix"]) == 3][:12]
    messages += [["I", UNSEEN], [UNSEEN], ["I", UNSEEN]]
    records, history, t = [], PersonalHistory(), START
    for message in messages:
        for i, symbol in enumerate(message):
            prefix = tuple(message[:i])
            history.record(prefix, symbol, t)
            records.append({"prefix": list(prefix), "symbol": symbol, "t": t})
            t += 90.0
    now = t + 1800.0

    allowed = sorted(set(kn_fixture["allowed"]) | {UNSEEN})
    prefixes = [[], ["I"]] + [case["prefix"] for case in kn_fixture["cases"][:30]]
    cases = [{"prefix": p,
              "top3": reranker.top_k(tuple(p), history, now, 3),
              "top3_masked": reranker.top_k(tuple(p), history, now, 3, set(allowed))}
             for p in prefixes]
    distributions = [{"prefix": p, "allowed": allowed,
                      "p": reranker.predict(tuple(p), history, now, set(allowed))}
                     for p in ([], ["I"], messages[0][:2])]

    fixture = {"weights": {"wFreq": reranker.w_freq, "wRec": reranker.w_rec,
                           "wCtx": reranker.w_ctx, "tau": reranker.tau},
               "now": now, "records": records, "allowed": allowed,
               "cases": cases, "distributions": distributions}
    path = FIXTURES / "reranker_fixture.json"
    path.write_text(json.dumps(fixture, ensure_ascii=False), encoding="utf-8")
    print(f"{path.relative_to(REPO)}: {len(records)} history records, {len(cases)} cases")


if __name__ == "__main__":
    main()
