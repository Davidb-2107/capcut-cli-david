import json
from pathlib import Path

for f in sorted(Path('test-fixtures/fixtures').glob('*.json')):
    d = json.loads(f.read_text())
    pf = d.get('platform') or {}
    print(f.name, "version=", d.get("version"), "new_version=", d.get("new_version"), "top.app_id=", d.get("app_id"), "platform.app_id=", pf.get("app_id"), "platform.app_source=", pf.get("app_source"), "platform.app_version=", pf.get("app_version"))
