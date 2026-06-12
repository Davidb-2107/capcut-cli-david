---
title: Storyboard workflow
parent_skill: capcut-david
source_skill: cut-storyboard
migrated: 2026-05-12
---

# Storyboard workflow

> Full 3-step workflow for going brief → storyboard → script → review. Condensed
> table-of-contents lives in [SKILL.md](../SKILL.md) §Recipes / Storyboard workflow.
> This was originally in the `cut-storyboard` skill (deprecated 2026-05-12).

## When to use

Quand l'utilisateur donne un brief vidéo libre ("fais-moi une vidéo de 30s sur X",
"planifie une séquence", "storyboard pour..."). Ne pas utiliser si l'utilisateur
demande une commande capcut-david spécifique — appliquer la commande directement.

Trigger phrases : "storyboard", "génère un script", "crée une vidéo de X secondes",
"planifie une séquence", "brief".

> **Note (v0.5.0):** Steps below mention `capcut-david query animations` and
> `capcut-david query filters` (catalogue lookup). That sub-command is **planned
> for v0.6.0** and is not yet available in v0.5.0. Until then, hard-code names
> from `docs/draft-schema/04-effects-filters-stickers.md`.

## The 3 steps — execute in order, never skip

### Step 1 — Storyboard table

Produce this complete markdown table **before** any script. Never skip columns.

| Shot | Time | Visual | Caption | Music / SFX | Transition |
|------|------|--------|---------|-------------|------------|
| 1 | 0:00–0:03 | … | … | … | … |
| 2 | 0:03–0:08 | … | … | … | … |

Table rules:
- **Time:** format `0:00–0:05` (readable seconds, not microseconds)
- **Visual:** URL or description of the image / video
- **Caption:** exact text + keyword to highlight if relevant
- **Music:** filename or URL + beat-drop moment if beat-sync
- **Transition:** capcut-david transition name (`叠化`, `推移`, `闪白`…) or `cut`

### Step 2 — `run.sh` script

Translate the storyboard into an executable bash script.

**Mandatory boilerplate:**

```bash
#!/usr/bin/env bash
set -euo pipefail

# Verify capcut-david + jq
command -v capcut-david >/dev/null 2>&1 || { echo "capcut-david not found"; exit 1; }
command -v jq           >/dev/null 2>&1 || { echo "jq not found"; exit 1; }

HERE="$(cd "$(dirname "$0")" && pwd)"

# Init draft, capture path
DRAFT=$(capcut-david init --width 1080 --height 1920 --name "nom-du-projet" --json \
  | jq -r '.draftPath')
echo "Draft: $DRAFT"

# Comment before each block
# --- Images / videos ---
capcut-david add-video "$DRAFT" --url "$HERE/data/img1.jpg" \
  --width 1080 --height 1920 --duration 3000000 --start 0 --end 3000000

# --- Captions ---
capcut-david add-text "$DRAFT" --text "Première phrase" \
  --start 0 --end 3000000 \
  --keyword "Première" --keyword-color "#FFD600" \
  --font-size 9 --bold --y -0.55 \
  --in-anim "弹入跳动" --in-anim-duration 350000

# --- Audio ---
capcut-david add-audio "$DRAFT" --url "$HERE/data/narration.mp3" \
  --duration 30000000 --start 0 --end 30000000 --volume 1.0

# Final summary
capcut-david info "$DRAFT" --json
echo "Done. Draft: $DRAFT"
```

**Separate data files** — never inline complex JSON in the script. Put any
non-trivial structured input (long caption arrays, manifest blocks) in
`data/*.json` and reference them by path. The CLI accepts file paths for any
flag where it accepts JSON.

**Time conversions (microseconds):**

```
1s  = 1_000_000
3s  = 3_000_000
5s  = 5_000_000
30s = 30_000_000
```

For human-friendly form (if v0.1.0 ships the parser): `--start 0 --end 3s`.

### Step 3 — Self-review

After the script, list **exactly 3 things to tweak**, with the exact command to
change each. No more, no less.

Example:

```
1. Font size:        change --font-size 9 → 11 for better mobile readability
2. Per-image duration: change "end": 3000000 → 5000000 for slower rhythm
3. Filter:           run `capcut-david query filters --keyword "cinematic"`
                     then `capcut-david add-filter` with the picked name
```

The 3-tweak ceiling forces you to surface only the highest-leverage knobs. If
the user wants more, they'll ask.

## Critical reminders (carry over from cut-storyboard)

- `--width` / `--height` **mandatory** on every image / video
- `--duration` **mandatory** on every video and audio (source duration, not timeline)
- Animation names are native Chinese CapCut tokens — use
  `capcut-david query animations --type in` to list valid names
- Keyframes: always run `capcut-david segments --json` to get the `segmentId`
  **after** the add — see [`recipes-motion.md`](recipes-motion.md) §Mandatory workflow
- For psycho/paranoia drafts, prefer `capcut-david psycho-build manifest.yml` over
  a hand-written script — see SKILL.md §Recipes / Psycho-Paranoia full draft

## See also

- [SKILL.md](../SKILL.md) — capcut-david main skill (condensed recipes)
- [`capcut-david --help`](https://github.com/Davidb-2107/capcut-cli-david#commands) — CLI reference
- Other recipes: [`recipes-motion.md`](recipes-motion.md), [`recipes-audio.md`](recipes-audio.md), [`recipes-tiktok.md`](recipes-tiktok.md)
