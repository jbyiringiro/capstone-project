"""Latency and size of exported artefacts on this machine (CPU), as a proxy before the tablet run.

The proposal's target (95th percentile < 200 ms) is measured on the actual study tablet through
the PWA's built-in benchmark (footer button "bench"); this script only screens candidates early.

Usage: python ml/scripts/bench_latency.py [--n 300]
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
from pathlib import Path

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from vuga_ml.evaluate import load_split  # noqa: E402
from vuga_ml.models import KneserNeyTrigram  # noqa: E402

ART = ROOT / "artifacts"


def timeit(fn, prefixes, n):
    for p in prefixes[:20]:
        fn(p)  # warm-up
    times = []
    for i in range(n):
        p = prefixes[i % len(prefixes)]
        t0 = time.perf_counter(); fn(p); times.append((time.perf_counter() - t0) * 1000)
    times.sort()
    return {"median_ms": round(statistics.median(times), 3), "p95_ms": round(times[int(0.95 * len(times)) - 1], 3)}


def main() -> None:
    ap = argparse.ArgumentParser(); ap.add_argument("--n", type=int, default=300)
    args = ap.parse_args()
    val = load_split(ROOT / "data" / "processed", "validation")
    prefixes = [tuple(s[:i]) for s in val[:100] for i in range(min(len(s), 4) + 1)] or [()]
    report = {}

    kn_path = ART / "kn_trigram.json"
    if kn_path.exists():
        kn = KneserNeyTrigram.load(kn_path)
        report["kn_trigram"] = {"size_bytes": kn_path.stat().st_size, **timeit(lambda p: kn.top_k(p, 3), prefixes, args.n)}

    onnx_path = ART / "gru.onnx"
    if onnx_path.exists():
        import numpy as np
        import onnxruntime as ort
        itos = json.loads((ART / "gru.vocab.json").read_text(encoding="utf-8"))
        stoi = {s: i for i, s in enumerate(itos)}
        sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])

        def run(p):
            ids = np.array([[1] + [stoi.get(s, 0) for s in p]], dtype=np.int64)
            logits = sess.run(None, {"ids": ids})[0][0, -1]
            return np.argsort(-logits)[:3]
        report["gru_onnx"] = {"size_bytes": onnx_path.stat().st_size, **timeit(run, prefixes, args.n)}

    for d in ART.glob("transformer_seed*"):
        if (d / "meta.json").exists():
            from vuga_ml.models.neural import TransformerPredictor
            import torch
            m = TransformerPredictor.load(d)
            m.enc.to("cpu"); m.head.to("cpu")
            torch.set_num_threads(4)
            report[d.name + "_cpu"] = {"size_bytes": sum(p.stat().st_size for p in d.rglob("*") if p.is_file()),
                                       "parameters": m.parameter_count(), **timeit(lambda p: m.top_k(p, 3), prefixes, min(args.n, 100))}
            break
    print(json.dumps(report, indent=2))
    (ART / "latency_local.json").write_text(json.dumps(report, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
