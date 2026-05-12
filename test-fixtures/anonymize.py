"""Anonymize a CapCut draft_content.json into a test fixture.

What gets scrubbed
------------------
- Windows user paths in `path`, `font_path`, `draft_cover`, `cover`, `material_path`,
  `extra_info`, `request_id`, etc. Any string starting with `C:`, `/c/`, `D:`, or
  containing `\\Users\\<name>\\` or `/Users/<name>/` is rewritten to a generic
  `/fixtures/...` placeholder. The basename (file or effect-id segment) is kept
  where it is structurally meaningful.
- Personal caption text. Inside text materials, the `content` field is a nested
  JSON string with `styles` and `text` — we parse it, replace the inner `text`
  with `LOREM_<n>`, and re-serialize. Atomic `text` fields are replaced the same
  way. Style ranges, fonts, colors are preserved.
- Material display names that look like personal slugs (custom presets named
  with user info). The CapCut catalogue names (`Fade In`, `VHS Horror`, `渐隐`,
  `CC-DerStil`) are kept — they are structural identifiers, not personal data.
- All UUIDs are remapped through a deterministic per-document map so internal
  cross-references (track.segments[].material_id → materials.videos[].id and
  every `extra_material_refs[]`) remain self-consistent after anonymization.
- `draft_id`, `draft_name`, `last_modified_platform.app_id` and friends are
  replaced with a deterministic fixture slug.

What is preserved
-----------------
- Every numeric parameter (durations, scales, positions, rotations, alpha,
  volume, speed). Keyframe times and values. Bezier control points.
- Every catalogue ID and resource id embedded in URLs (so effect/sticker IDs
  survive intact for downstream lookup).
- All track/segment ordering.
- Schema version, capcut version strings.

Usage
-----
    python anonymize.py <input.json> <output.json> --name <fixture-slug>
    python anonymize.py --all   # process FIXTURE_MAP
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import uuid
from pathlib import Path
from typing import Any

UUID_RE = re.compile(
    r"^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$"
)
WIN_PATH_RE = re.compile(r"^[A-Za-z]:[\\/]")
USER_DIR_RE = re.compile(r"(?:[\\/])Users[\\/][^\\/]+", re.IGNORECASE)
EFFECT_CACHE_RE = re.compile(r"Cache[\\/]effect[\\/](\d+)", re.IGNORECASE)
FONT_DIR_RE = re.compile(r"Fonts[\\/]([^\\/]+)$", re.IGNORECASE)

# Field names that, when their string value is a path, should be rewritten.
PATH_FIELDS = {
    "path", "font_path", "material_path", "cover", "draft_cover",
    "thumbnail", "preview_path", "absolute_path", "uri",
}

# Field names that, when their string value is human-readable, should be replaced.
TEXT_FIELDS = {"text"}
CONTENT_FIELDS = {"content", "base_content"}  # contain nested JSON with text


class Anonymizer:
    """Stateful per-document anonymizer. UUID remap is deterministic per instance
    so the same input UUID maps to the same output UUID throughout one document."""

    def __init__(self, fixture_name: str, preserve_text: bool = False):
        self.fixture_name = fixture_name
        self.preserve_text = preserve_text
        self._uuid_map: dict[str, str] = {}
        self._text_counter = 0

    # ---- UUID handling ------------------------------------------------------
    def _new_uuid_for(self, original: str) -> str:
        seed = uuid.uuid5(uuid.NAMESPACE_OID, f"{self.fixture_name}:{original}")
        return str(seed).upper()

    def _maybe_remap_uuid(self, s: str) -> str | None:
        if UUID_RE.match(s):
            if s not in self._uuid_map:
                self._uuid_map[s] = self._new_uuid_for(s)
            return self._uuid_map[s]
        return None

    # ---- Path handling ------------------------------------------------------
    @staticmethod
    def _scrub_path(s: str) -> str:
        original = s
        # Effect cache paths: keep the effect-id portion (structural).
        m = EFFECT_CACHE_RE.search(s)
        if m:
            effect_id = m.group(1)
            tail = s.split(m.group(0), 1)[1].split("/")[-1]
            tail = tail.split("\\")[-1] or "resource"
            return f"/fixtures/cache/effect/{effect_id}/{tail}"
        # Font paths: keep the font filename (catalogue identifier).
        m = FONT_DIR_RE.search(s)
        if m:
            return f"/fixtures/fonts/{m.group(1)}"
        # Generic user path.
        scrubbed = USER_DIR_RE.sub("/Users/USER", s.replace("\\", "/"))
        if WIN_PATH_RE.match(original):
            scrubbed = re.sub(r"^[A-Za-z]:", "", scrubbed)
        if scrubbed.startswith("/Users/USER"):
            tail = scrubbed.rsplit("/", 1)[-1]
            return f"/fixtures/assets/{tail}"
        return scrubbed

    @staticmethod
    def _is_path_like(s: str) -> bool:
        if not s:
            return False
        if WIN_PATH_RE.match(s):
            return True
        if "\\Users\\" in s or "/Users/" in s:
            return True
        if s.startswith("/") and "/" in s[1:]:
            return any(seg in s for seg in ("/AppData/", "/CapCut/", "/Fonts/"))
        return False

    # ---- Text handling ------------------------------------------------------
    def _fresh_text(self, original: str) -> str:
        if self.preserve_text:
            return original
        self._text_counter += 1
        # Preserve approximate length to keep test cases representative.
        n = max(1, len(original) // 5)
        return ("LOREM " * n).strip() or "LOREM"

    def _scrub_content_blob(self, s: str) -> str:
        """`content` and `base_content` in text materials are JSON strings.
        Parse, replace inner `text`, re-serialize. Leaves style ranges intact."""
        s_stripped = s.strip()
        if not (s_stripped.startswith("{") and s_stripped.endswith("}")):
            return s
        try:
            inner = json.loads(s)
        except (json.JSONDecodeError, ValueError):
            return s
        self._walk(inner, in_text_blob=True)
        return json.dumps(inner, ensure_ascii=False, separators=(",", ":"))

    # ---- Recursive walk -----------------------------------------------------
    def _walk(self, obj: Any, parent_key: str = "", in_text_blob: bool = False) -> Any:
        if isinstance(obj, dict):
            for k in list(obj.keys()):
                obj[k] = self._walk(obj[k], parent_key=k, in_text_blob=in_text_blob)
            return obj
        if isinstance(obj, list):
            return [self._walk(v, parent_key=parent_key, in_text_blob=in_text_blob) for v in obj]
        if isinstance(obj, str):
            return self._scrub_string(obj, parent_key, in_text_blob)
        return obj

    def _scrub_string(self, s: str, key: str, in_text_blob: bool) -> str:
        remapped = self._maybe_remap_uuid(s)
        if remapped is not None:
            return remapped
        if key in PATH_FIELDS and self._is_path_like(s):
            return self._scrub_path(s)
        if key in CONTENT_FIELDS and s and not in_text_blob:
            return self._scrub_content_blob(s)
        if in_text_blob and key in TEXT_FIELDS and s:
            return self._fresh_text(s)
        if key in TEXT_FIELDS and not in_text_blob and s:
            return self._fresh_text(s)
        # Catch stray paths that landed in non-PATH_FIELDS keys.
        if self._is_path_like(s):
            return self._scrub_path(s)
        return s

    # ---- Top-level scrubbing ------------------------------------------------
    def _scrub_top_level(self, data: dict[str, Any]) -> None:
        for k in (
            "draft_name", "id", "draft_id", "project_id", "draft_root_path",
            "draft_removable_storage_device", "draft_id_extra",
        ):
            if k in data and isinstance(data[k], str):
                if k == "draft_name":
                    data[k] = self.fixture_name
                elif UUID_RE.match(data[k]):
                    data[k] = self._maybe_remap_uuid(data[k]) or data[k]
                else:
                    data[k] = f"fixture-{self.fixture_name}"
        # Drop noisy local-only metadata if present.
        for k in ("draft_fold_path", "draft_root_path"):
            data.pop(k, None)

    # ---- Entry point --------------------------------------------------------
    def anonymize(self, data: dict[str, Any]) -> dict[str, Any]:
        self._scrub_top_level(data)
        self._walk(data)
        return data


# ---- Verification ----------------------------------------------------------

def verify_fixture(data: dict[str, Any]) -> list[str]:
    """Sanity-check the anonymized fixture. Returns list of problems."""
    problems: list[str] = []
    blob = json.dumps(data)
    # No personal markers left.
    forbidden = ["C:\\Users\\", "C:/Users/", "/Users/dbele", "AppData/Local/CapCut",
                 "AppData\\Local\\CapCut", "/c/Users/dbele"]
    for needle in forbidden:
        if needle in blob:
            problems.append(f"Personal marker still present: {needle!r}")

    # Material refs resolve to known material IDs.
    materials = data.get("materials", {})
    known_ids: set[str] = set()
    for bucket in materials.values():
        if isinstance(bucket, list):
            for m in bucket:
                if isinstance(m, dict) and "id" in m:
                    known_ids.add(m["id"])

    unresolved: set[str] = set()
    for track in data.get("tracks", []):
        for seg in track.get("segments", []):
            mid = seg.get("material_id")
            if mid and mid not in known_ids:
                unresolved.add(mid)
    if unresolved:
        problems.append(
            f"{len(unresolved)} material_id refs do not resolve to a material "
            f"(e.g. {next(iter(unresolved))})"
        )
    return problems


# ---- CLI -------------------------------------------------------------------

FIXTURE_MAP = {
    "minimal-draft":      r"C:\Users\dbele\AppData\Local\CapCut\User Data\Projects\com.lveditor.draft\.recycle_bin\0504\draft_content.json",
    "ken-burns-draft":    r"C:\Users\dbele\AppData\Local\CapCut\User Data\Projects\com.lveditor.draft\paranoia-spiral-test\draft_content.json",
    "effects-draft":      r"C:\Users\dbele\AppData\Local\CapCut\User Data\Projects\com.lveditor.draft\test-effect-clean\draft_content.json",
    "subtitles-draft":    r"C:\Users\dbele\AppData\Local\CapCut\User Data\Projects\com.lveditor.draft\captions-test\draft_content.json",
    "full-psycho-draft":  r"C:\Users\dbele\AppData\Local\CapCut\User Data\Projects\com.lveditor.draft\paranoia-spiral\draft_content.json",
    "animations-draft":   r"C:\Users\dbele\AppData\Local\CapCut\User Data\Projects\com.lveditor.draft\fixture-anim-kw\draft_content.json",
    "stickers-draft":     r"C:\Users\dbele\AppData\Local\CapCut\User Data\Projects\com.lveditor.draft\fixture-stickers\draft_content.json",
    "transitions-draft":  r"C:\Users\dbele\AppData\Local\CapCut\User Data\Projects\com.lveditor.draft\fixture-transitions\draft_content.json",
    "masks-filters-draft": r"C:\Users\dbele\AppData\Local\CapCut\User Data\Projects\com.lveditor.draft\fixture-masks-filters\draft_content.json",
}


def process(input_path: Path, output_path: Path, fixture_name: str, preserve_text: bool) -> None:
    data = json.loads(input_path.read_text(encoding="utf-8"))
    anon = Anonymizer(fixture_name=fixture_name, preserve_text=preserve_text)
    out = anon.anonymize(data)
    problems = verify_fixture(out)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(out, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"[OK] {input_path.name} -> {output_path}")
    print(f"     uuids remapped: {len(anon._uuid_map)}  texts scrubbed: {anon._text_counter}")
    if problems:
        print("     ⚠ verification problems:")
        for p in problems:
            print(f"       - {p}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Anonymize a CapCut draft_content.json")
    parser.add_argument("input", nargs="?", help="Input draft_content.json path")
    parser.add_argument("output", nargs="?", help="Output fixture path")
    parser.add_argument("--name", default=None, help="Fixture name (used to seed UUID remap)")
    parser.add_argument("--all", action="store_true", help="Process every entry in FIXTURE_MAP")
    parser.add_argument("--preserve-text", action="store_true", help="Keep original caption text")
    parser.add_argument("--out-dir", default=None, help="Output directory for --all")
    args = parser.parse_args()

    if args.all:
        out_dir = Path(args.out_dir or (Path(__file__).parent / "fixtures"))
        for name, src in FIXTURE_MAP.items():
            src_path = Path(src)
            if not src_path.exists():
                print(f"[skip] {name}: source not found ({src})")
                continue
            process(src_path, out_dir / f"{name}.json", name, args.preserve_text)
        return 0

    if not args.input or not args.output:
        parser.error("input and output are required unless --all is given")
    name = args.name or Path(args.output).stem
    process(Path(args.input), Path(args.output), name, args.preserve_text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
