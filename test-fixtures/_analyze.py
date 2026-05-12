"""Quick inspector for CapCut draft_content.json files. Local-only, not shipped."""
import json
from pathlib import Path

BASE = Path(r"C:\Users\dbele\AppData\Local\CapCut\User Data\Projects\com.lveditor.draft")
RECYCLED = BASE / ".recycle_bin"

RECYCLED_CANDIDATES = [
    "kf-test", "Hello-FadeIn", "Hello-FadeIn-v2", "hello-caption",
    "captions-aligned-test", "captions-restyle-v2", "font-test", "style-re",
    "0501", "0503", "0504", "0506",
]


def analyze(draft_path: Path):
    f = draft_path / "draft_content.json"
    if not f.exists():
        return None
    try:
        data = json.loads(f.read_text(encoding="utf-8"))
    except Exception as e:
        return f"ERROR {e}"

    tracks = data.get("tracks", [])
    materials = data.get("materials", {})

    track_summary: dict[str, int] = {}
    n_kf_groups = n_anim_segs = 0
    for t in tracks:
        tt = t.get("type", "?")
        segs = t.get("segments", [])
        track_summary[tt] = track_summary.get(tt, 0) + len(segs)
        for seg in segs:
            if seg.get("common_keyframes"):
                n_kf_groups += len(seg["common_keyframes"])
            if seg.get("material_animations"):
                n_anim_segs += 1

    return {
        "kb": f.stat().st_size // 1024,
        "dur_s": data.get("duration", 0) // 1_000_000,
        "tracks": track_summary,
        "videos": len(materials.get("videos", [])),
        "audios": len(materials.get("audios", [])),
        "texts": len(materials.get("texts", [])),
        "stickers": len(materials.get("stickers", [])),
        "vfx": len(materials.get("video_effects", [])),
        "fx": len(materials.get("effects", [])),
        "n_kf_groups": n_kf_groups,
        "n_anim_segs": n_anim_segs,
        "ver": data.get("version", "?"),
    }


def main() -> None:
    active = sorted(p for p in BASE.iterdir() if p.is_dir() and not p.name.startswith('.'))
    print("=== ACTIVE DRAFTS ===")
    for p in active:
        print(f"{p.name}:\n  {analyze(p)}")

    print("\n=== RECYCLED CANDIDATES ===")
    for name in RECYCLED_CANDIDATES:
        p = RECYCLED / name
        if not p.exists():
            continue
        print(f"recycled/{name}:\n  {analyze(p)}")


if __name__ == "__main__":
    main()
