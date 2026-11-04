"""Build the Attempt 2 ZIP: the repository, the technical report and the walkthrough video.

  Vuga-Final-Submission.zip
    capstone-project/...                    every file git tracks or would track (.gitignore applies)
    Vuga_Final_Technical_Report.pdf         copy of docs/report/ at the top level
    Vuga_Walkthrough_Video.<ext>            the recorded video, if --video is given
    SUBMISSION.txt                          what is inside, the commit and the checks to run

The repository part uses `git ls-files`, so dependencies, local databases, recordings and other
ignored files are never packed. Vuga is a progressive web app installed from the browser, so
there is no APK; SUBMISSION.txt says how to install it.

Usage: python scripts/package_submission.py --video path/to/walkthrough.mp4 [--out ../deliverables]
"""
from __future__ import annotations

import argparse
import subprocess
import zipfile
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
REPORT = REPO / "docs" / "report" / "Vuga_Final_Technical_Report.pdf"


def repository_files() -> list[str]:
    listed = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
                            cwd=REPO, check=True, capture_output=True).stdout.decode("utf-8")
    return sorted(path for path in listed.split("\0") if path and (REPO / path).is_file())


def describe(commit: str, dirty: bool, video: Path | None) -> str:
    return f"""Vuga AAC - final version of the product (Attempt 2)
Josue Byiringiro, African Leadership University, {date.today():%d %B %Y}

Contents
  capstone-project/                    the repository (commit {commit}{' plus uncommitted changes' if dirty else ''})
  Vuga_Final_Technical_Report.pdf      technical report (also in capstone-project/docs/report/)
  {('Vuga_Walkthrough_Video' + video.suffix) if video else '(video: see the link in README.md)'}

Installing the app
  Vuga is a progressive web app, so there is no APK. Build it (capstone-project/README.md, step 2),
  open it once in Chrome or Edge on the tablet and choose "Install app"; it then works offline.

Checks
  cd capstone-project/app && npm ci && npm test        146 unit and reference tests
  python -m pytest ml/tests api/tests                   98 Python tests
  npm run build && npm run preview, then npm run test:browser (70 checks) and npm run test:compat (9 configurations)
"""


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", type=Path, help="recorded walkthrough video file")
    parser.add_argument("--out", type=Path, default=REPO.parent / "deliverables")
    args = parser.parse_args()
    if not REPORT.exists():
        raise SystemExit("render the report first: node app/scripts/render-report.mjs")
    if args.video and not args.video.is_file():
        raise SystemExit(f"video not found: {args.video}")

    commit = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=REPO, check=True,
                            capture_output=True, text=True).stdout.strip()
    dirty = bool(subprocess.run(["git", "status", "--porcelain"], cwd=REPO, check=True,
                                capture_output=True, text=True).stdout.strip())
    files = repository_files()
    args.out.mkdir(parents=True, exist_ok=True)
    target = args.out / "Vuga-Final-Submission.zip"
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            archive.write(REPO / path, f"capstone-project/{path}")
        archive.write(REPORT, REPORT.name)
        if args.video:
            # Video is already compressed; storing it avoids slow, useless deflation.
            archive.write(args.video, f"Vuga_Walkthrough_Video{args.video.suffix}",
                          compress_type=zipfile.ZIP_STORED)
        archive.writestr("SUBMISSION.txt", describe(commit, dirty, args.video))
    size = target.stat().st_size / 2 ** 20
    print(f"{target}: {len(files)} repository files, {size:.1f} MB"
          f"{'' if args.video else ' (no video yet: pass --video)'}"
          f"{' - WARNING: uncommitted changes are included' if dirty else ''}")


if __name__ == "__main__":
    main()
