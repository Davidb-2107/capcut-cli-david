"""Walk a draft_content.json and report every string-valued field whose value
looks personal (path, name, content). Used to design anonymize.py."""
import json, sys, re
from pathlib import Path
from collections import defaultdict

UUID_RE = re.compile(r"^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$")
WIN_PATH_RE = re.compile(r"^[A-Za-z]:[\\/]")
URL_RE = re.compile(r"^https?://")

found: dict[str, set] = defaultdict(set)

def walk(obj, path="$"):
    if isinstance(obj, dict):
        for k, v in obj.items():
            walk(v, f"{path}.{k}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            walk(v, f"{path}[{i}]")
    elif isinstance(obj, str):
        key = path.split('.')[-1].split('[')[0]
        if WIN_PATH_RE.match(obj) or '/Users/' in obj or '\\Users\\' in obj or '\\AppData\\' in obj or '/AppData/' in obj:
            found[f"PATH@{key}"].add(obj[:80])
        elif UUID_RE.match(obj):
            found[f"UUID@{key}"].add(obj[:40])
        elif URL_RE.match(obj):
            found[f"URL@{key}"].add(obj[:80])
        elif key in {"name", "material_name", "extra_info", "content", "title", "text", "draft_name", "draft_id", "project_id"}:
            found[f"NAME@{key}"].add(obj[:80])


def main():
    drafts = sys.argv[1:] if len(sys.argv) > 1 else [
        r"C:\Users\dbele\AppData\Local\CapCut\User Data\Projects\com.lveditor.draft\paranoia-spiral\draft_content.json",
    ]
    for d in drafts:
        print(f"\n=== {d} ===")
        data = json.loads(Path(d).read_text(encoding='utf-8'))
        found.clear()
        walk(data)
        for k in sorted(found):
            samples = list(found[k])[:3]
            print(f"  {k}  ({len(found[k])} unique)")
            for s in samples:
                print(f"    - {s!r}")

if __name__ == '__main__':
    main()
