"""Cross-reference validator for every anonymized CapCut draft fixture.

For each fixtures/*.json:
  - every track.segments[*].material_id must resolve to an existing materials.<type>[*].id
  - every track.segments[*].extra_material_refs[*] must resolve to some materials.<type>[*].id
  - draft.duration must be a non-negative integer
  - top-level shape contains the invariants asserted in docs/draft-schema/05-version-differences.md
    (version, app_id, app_source)

Exits 0 on all-clean, 1 on the first failure. Runs in CI (.github/workflows/ci.yml fixture-integrity).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).parent
FIXTURES_DIR = HERE / "fixtures"

INVARIANTS = {
    "version": 360000,
    "platform.app_id": 359289,
    "platform.app_source": "cc",
}


def collect_material_ids(materials: dict) -> set[str]:
    ids: set[str] = set()
    for arr in materials.values():
        if not isinstance(arr, list):
            continue
        for item in arr:
            if isinstance(item, dict) and isinstance(item.get("id"), str):
                ids.add(item["id"])
    return ids


def check_fixture(path: Path) -> list[str]:
    """Return a list of error strings; empty list means clean."""
    errors: list[str] = []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        return [f"{path.name}: cannot parse JSON ({e})"]

    # Invariants
    if data.get("version") != INVARIANTS["version"]:
        errors.append(f"{path.name}: version != {INVARIANTS['version']} (got {data.get('version')})")
    platform = data.get("platform") or {}
    if platform.get("app_id") != INVARIANTS["platform.app_id"]:
        errors.append(
            f"{path.name}: platform.app_id != {INVARIANTS['platform.app_id']} (got {platform.get('app_id')})"
        )
    if platform.get("app_source") != INVARIANTS["platform.app_source"]:
        errors.append(
            f"{path.name}: platform.app_source != '{INVARIANTS['platform.app_source']}' "
            f"(got {platform.get('app_source')!r})"
        )

    # duration sanity
    dur = data.get("duration")
    if not isinstance(dur, int) or dur < 0:
        errors.append(f"{path.name}: duration must be non-negative int, got {dur!r}")

    # Cross-reference segment → materials
    materials = data.get("materials") or {}
    if not isinstance(materials, dict):
        errors.append(f"{path.name}: materials is not an object")
        return errors

    all_ids = collect_material_ids(materials)

    tracks = data.get("tracks") or []
    for ti, track in enumerate(tracks):
        for si, seg in enumerate(track.get("segments", [])):
            mid = seg.get("material_id")
            if isinstance(mid, str) and mid and mid not in all_ids:
                errors.append(
                    f"{path.name}: track[{ti}].segments[{si}].material_id "
                    f"{mid[:8]}… not found in materials"
                )
            for ri, ref in enumerate(seg.get("extra_material_refs", []) or []):
                if not isinstance(ref, str) or not ref:
                    continue
                if ref not in all_ids:
                    errors.append(
                        f"{path.name}: track[{ti}].segments[{si}].extra_material_refs[{ri}] "
                        f"{ref[:8]}… not found in materials"
                    )

    return errors


def main() -> int:
    if not FIXTURES_DIR.exists():
        print(f"FAIL: fixtures dir not found: {FIXTURES_DIR}", file=sys.stderr)
        return 1

    fixtures = sorted(FIXTURES_DIR.glob("*.json"))
    if not fixtures:
        print(f"FAIL: no fixtures in {FIXTURES_DIR}", file=sys.stderr)
        return 1

    total_errors: list[str] = []
    for f in fixtures:
        errs = check_fixture(f)
        if errs:
            total_errors.extend(errs)
            print(f"  FAIL {f.name}")
            for e in errs:
                print(f"    - {e}")
        else:
            print(f"  PASS {f.name}")

    print(f"\n{len(fixtures)} fixtures checked, {len(total_errors)} errors.")
    return 0 if not total_errors else 1


if __name__ == "__main__":
    sys.exit(main())
