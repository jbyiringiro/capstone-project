"""Draw the technical report's figures from the evidence JSON in docs/evidence/.

  docs/report/figures/compatibility.svg   load times and interaction latency per configuration

Colours follow a validated categorical palette (blue, orange, aqua: all-pairs colour-vision
separation above the ΔE 8 target); aqua is below 3:1 contrast on white, so every value is also
printed in the report's table. Small multiples share the configuration axis instead of mixing
units on one chart.

Usage: python scripts/build_report_figures.py
"""
from __future__ import annotations

import json
from pathlib import Path

import matplotlib

matplotlib.use("svg")
import matplotlib.pyplot as plt  # noqa: E402

REPO = Path(__file__).resolve().parents[1]
EVIDENCE = REPO / "docs" / "evidence" / "compatibility.json"
OUT = REPO / "docs" / "report" / "figures"

SERIES = {"cold": "#2a78d6", "warm": "#eb6834", "offline": "#1baf7a"}
INK, SECONDARY, MUTED, GRID, AXIS = "#0b0b0b", "#52514e", "#898781", "#e1e0d9", "#c3c2b7"
SHORT = {
    "edge-desktop": "Edge · desktop",
    "edge-android-tablet": "Edge · Android tablet",
    "edge-android-phone": "Edge · Android phone",
    "edge-lowend-tablet": "Edge · tablet, 4× CPU, 3G",
    "edge-lowend-phone": "Edge · phone, 6× CPU, 3G",
    "firefox-desktop": "Firefox · desktop",
    "firefox-phone-size": "Firefox · phone size",
    "webkit-ipad": "WebKit · iPad",
    "webkit-iphone": "WebKit · iPhone",
}


def style(ax, title: str, unit: str) -> None:
    ax.set_title(title, loc="left", fontsize=8.5, color=INK, fontweight="bold", pad=8)
    ax.set_xlabel(unit, fontsize=7, color=MUTED)
    ax.grid(axis="x", color=GRID, linewidth=0.6)
    ax.set_axisbelow(True)
    ax.tick_params(axis="both", labelsize=7, colors=SECONDARY, length=0)
    for side in ("top", "right", "left"):
        ax.spines[side].set_visible(False)
    ax.spines["bottom"].set_color(AXIS)


def reference(ax, value: float, label: str) -> None:
    ax.axvline(value, color=SECONDARY, linewidth=0.9, linestyle=(0, (3, 2)))
    ax.text(value, -0.9, f" {label}", fontsize=6.5, color=SECONDARY, va="center")


def main() -> None:
    results = json.loads(EVIDENCE.read_text(encoding="utf-8"))["results"]
    names = [SHORT.get(r["id"], r["id"]) for r in results]
    rows = list(range(len(results)))[::-1]
    plt.rcParams["font.family"] = ["Segoe UI", "DejaVu Sans", "sans-serif"]
    plt.rcParams["svg.fonttype"] = "none"
    fig, axes = plt.subplots(1, 3, figsize=(7.3, 3.0), sharey=True,
                             gridspec_kw={"width_ratios": [1.5, 1, 1], "wspace": 0.12})

    load = axes[0]
    height = 0.26
    for offset, (key, colour) in zip((height, 0, -height), SERIES.items()):
        values = [r["metrics"].get(f"{key}_board_ms", 0) / 1000 for r in results]
        load.barh([y + offset for y in rows], values, height=height * 0.88, color=colour,
                  label={"cold": "Cold load", "warm": "Warm reload", "offline": "Offline reload"}[key])
    style(load, "Time to a usable board", "seconds")
    load.legend(fontsize=6.5, frameon=False, loc="lower right", handlelength=1, handleheight=0.8)

    tap = axes[1]
    tap.barh(rows, [r["metrics"]["tap_to_frame_ms"]["p95"] for r in results], height=0.55, color=SERIES["cold"])
    style(tap, "Tap to next frame, p95", "milliseconds")
    reference(tap, 200, "200 ms (NFR2)")

    speech = axes[2]
    speech_values = [r["metrics"].get("speech_start_ms") for r in results]
    speech.barh(rows, [v or 0 for v in speech_values], height=0.55, color=SERIES["cold"])
    for y, value in zip(rows, speech_values):
        if value is None:
            speech.text(8, y, "no audio (headless)", fontsize=6, color=MUTED, va="center")
    style(speech, "Vuga to first audio", "milliseconds")
    reference(speech, 300, "300 ms (NFR2)")

    load.set_yticks(rows, names)
    for ax in axes:
        ax.set_ylim(-1.3, len(results) - 0.4)
    OUT.mkdir(parents=True, exist_ok=True)
    fig.savefig(OUT / "compatibility.svg", bbox_inches="tight", transparent=False, facecolor="white")
    print(f"wrote {OUT / 'compatibility.svg'}")


if __name__ == "__main__":
    main()
