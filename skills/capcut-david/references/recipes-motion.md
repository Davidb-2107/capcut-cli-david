---
title: Motion recipes
parent_skill: capcut-david
source_skill: cut-motion
migrated: 2026-05-12
---

# Motion recipes

> Full recipes for camera motion via keyframes (Ken Burns, pan, rotation, opacity).
> Condensed table-of-contents lives in [SKILL.md](../SKILL.md) §Recipes.
> These were originally in the `cut-motion` skill (deprecated 2026-05-12).

## When to use

Animer des images statiques avec des mouvements de caméra (zoom, pan, rotation).
Toujours utilisé après le `add-video`/`add-image` initial pour récupérer le
`segmentId`, puis appliquer les keyframes.

Trigger phrases : "anime cette image", "zoom progressif", "Ken Burns", "pan",
"keyframe", "mouvement sur la photo".

## Mandatory workflow

```bash
# 1. Add the image first
capcut-david add-video "$DRAFT" --url "$IMG_URL" --width 1080 --height 1920 \
  --duration 5000000 --start 0 --end 5000000

# 2. Get the segmentId (it changes every draft)
SEG=$(capcut-david segments "$DRAFT" --json | jq -r '.[0].segmentId')

# 3. Apply keyframes
capcut-david add-keyframe "$DRAFT" --segment-id "$SEG" \
  --property scale_x --offset 0 --value 1.0 --easing ease-out
```

> The `segmentId` changes every draft. Always run `capcut-david segments` after the add.

## Available properties

| Property | Effect | Recommended range |
|----------|--------|-------------------|
| `scale_x` | Horizontal zoom | 1.0 → 1.5 max |
| `scale_y` | Vertical zoom | 1.0 → 1.5 max (sync with scale_x) |
| `position_x` | Pan left/right | -0.3 → 0.3 |
| `position_y` | Pan up/down | -0.3 → 0.3 |
| `rotation` | Rotation | -15 → 15 degrees |
| `opacity` | Transparency | 0.0 → 1.0 |

**Easing:** `linear` | `ease-in` | `ease-out` | `ease-in-out`

## Recipes

### Recipe 1 — Ken Burns (slow zoom)

Progressive zoom 1.0 → 1.3 over the segment duration. Documentary/photo classic.

Use the dedicated helper (preferred):

```bash
SEG=$(capcut-david segments "$DRAFT" --json | jq -r '.[0].segmentId')
capcut-david ken-burns "$DRAFT" --segment-id "$SEG" --style standard
```

Or manually with `add-keyframe`:

```bash
SEG=$(capcut-david segments "$DRAFT" --json | jq -r '.[0].segmentId')
DURATION=5000000  # match the actual segment duration

capcut-david add-keyframe "$DRAFT" --segment-id "$SEG" --property scale_x --offset 0        --value 1.0 --easing ease-out
capcut-david add-keyframe "$DRAFT" --segment-id "$SEG" --property scale_x --offset $DURATION --value 1.3 --easing ease-out
capcut-david add-keyframe "$DRAFT" --segment-id "$SEG" --property scale_y --offset 0        --value 1.0 --easing ease-out
capcut-david add-keyframe "$DRAFT" --segment-id "$SEG" --property scale_y --offset $DURATION --value 1.3 --easing ease-out
```

### Recipe 2 — Pan Left → Right

Horizontal slide over the full duration.

```bash
SEG=$(capcut-david segments "$DRAFT" --json | jq -r '.[0].segmentId')
capcut-david add-keyframe "$DRAFT" --segment-id "$SEG" --property position_x --offset 0       --value -0.15
capcut-david add-keyframe "$DRAFT" --segment-id "$SEG" --property position_x --offset 5000000 --value  0.15
```

Invert the values for Right → Left.

### Recipe 3 — Ken Burns + Pan combined

Zoom AND pan simultaneously — maximum cinematic effect.

```bash
SEG=$(capcut-david segments "$DRAFT" --json | jq -r '.[0].segmentId')
D=5000000

capcut-david add-keyframe "$DRAFT" --segment-id "$SEG" --property scale_x    --offset 0  --value 1.0
capcut-david add-keyframe "$DRAFT" --segment-id "$SEG" --property scale_x    --offset $D --value 1.25
capcut-david add-keyframe "$DRAFT" --segment-id "$SEG" --property scale_y    --offset 0  --value 1.0
capcut-david add-keyframe "$DRAFT" --segment-id "$SEG" --property scale_y    --offset $D --value 1.25
capcut-david add-keyframe "$DRAFT" --segment-id "$SEG" --property position_x --offset 0  --value -0.1
capcut-david add-keyframe "$DRAFT" --segment-id "$SEG" --property position_x --offset $D --value  0.1
```

### Recipe 4 — Opacity Fade In / Fade Out

Progressive appear and disappear (independent from built-in animations).

```bash
SEG=$(capcut-david segments "$DRAFT" --json | jq -r '.[0].segmentId')
D=5000000
FADE=500000  # 0.5s fade

capcut-david add-keyframe "$DRAFT" --segment-id "$SEG" --property opacity --offset 0                --value 0.0
capcut-david add-keyframe "$DRAFT" --segment-id "$SEG" --property opacity --offset $FADE            --value 1.0
capcut-david add-keyframe "$DRAFT" --segment-id "$SEG" --property opacity --offset $((D - FADE))    --value 1.0
capcut-david add-keyframe "$DRAFT" --segment-id "$SEG" --property opacity --offset $D               --value 0.0
```

### Recipe 5 — Multi-image Ken Burns (N images)

Apply Ken Burns to several sequential images:

```bash
# Get all segmentIds after adding all images
SEGS=($(capcut-david segments "$DRAFT" --json | jq -r '.[].segmentId'))

for i in "${!SEGS[@]}"; do
  SEG="${SEGS[$i]}"
  START=$(( i * 5000000 ))
  END=$(( START + 5000000 ))
  capcut-david add-keyframe "$DRAFT" --segment-id "$SEG" --property scale_x --offset $START --value 1.0
  capcut-david add-keyframe "$DRAFT" --segment-id "$SEG" --property scale_x --offset $END   --value 1.3
  capcut-david add-keyframe "$DRAFT" --segment-id "$SEG" --property scale_y --offset $START --value 1.0
  capcut-david add-keyframe "$DRAFT" --segment-id "$SEG" --property scale_y --offset $END   --value 1.3
done
```

For an alternating breathing pattern (in / out / in / out…), use
`capcut-david ken-burns ... --style psycho` per segment instead — it handles
the direction flip automatically.

## Ken Burns intensity by style

| Style | Scale start | Scale end | Pan | Use case |
|-------|-------------|-----------|-----|----------|
| `subtle` (doc) | 1.0 | 1.15 | none | documentary, photo essay |
| `standard` | 1.0 | 1.3 | optional | general short-form |
| `dramatic` | 1.0 | 1.5 | yes | impact / hook shots |
| `psycho` (horror) | 1.0 | 1.08 (very slow) | slight | paranoia / dread niche |

## See also

- [SKILL.md](../SKILL.md) — capcut-david main skill (condensed recipes)
- [`capcut-david --help`](https://github.com/Davidb-2107/capcut-cli-david#commands) — CLI reference
- [`docs/draft-schema/03-keyframes-and-animations.md`](../../../docs/draft-schema/03-keyframes-and-animations.md) — keyframe JSON structure
- Other recipes: [`recipes-audio.md`](recipes-audio.md), [`recipes-tiktok.md`](recipes-tiktok.md), [`recipes-storyboard.md`](recipes-storyboard.md)
