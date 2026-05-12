---
title: TikTok recipes
parent_skill: capcut-david
source_skill: cut-tiktok
migrated: 2026-05-12
---

# TikTok recipes

> Full recipes for short-form TikTok / Reels / Shorts: keyword highlights,
> bounce animations, 2s-per-caption timing, bottom-of-screen positioning,
> fast transitions. Condensed table-of-contents lives in [SKILL.md](../SKILL.md) §Recipes.
> These were originally in the `cut-tiktok` skill (deprecated 2026-05-12).

## When to use

Style court-format TikTok / Reels / Shorts avec captions animées et keyword
highlights. Ne pas utiliser pour des vidéos longues (>2min) ou corporate sans
animation.

Trigger phrases : "style TikTok", "comme sur TikTok", "caption qui bounce",
"keyword coloré", "Reels", "Shorts".

## Recipes

### Recipe 1 — Keyword Highlight (most-used)

Sequential captions with one colored keyword + bounce animation.

```bash
# Caption 1 — 0–2s, yellow keyword
capcut-david add-text "$DRAFT" --text "Première phrase accrocheuse" \
  --start 0 --end 2000000 \
  --keyword "accrocheuse" --keyword-color "#FFD600" \
  --font-size 9 --bold --transform-y -0.55 \
  --in-anim "弹入跳动" --in-anim-duration 350000

# Caption 2 — 2–4s, pink keyword
capcut-david add-text "$DRAFT" --text "Deuxième idée forte" \
  --start 2000000 --end 4000000 \
  --keyword "forte" --keyword-color "#FF3A6E" \
  --font-size 9 --bold --transform-y -0.55 \
  --in-anim "弹入跳动" --in-anim-duration 350000

# Caption 3 — 4–6s, orange keyword + fade-out
capcut-david add-text "$DRAFT" --text "Call to action final" \
  --start 4000000 --end 6000000 \
  --keyword "action" --keyword-color "#FF6600" \
  --font-size 9 --bold --transform-y -0.55 \
  --in-anim "弹入跳动" --in-anim-duration 350000 \
  --out-anim "渐隐" --out-anim-duration 250000
```

**TikTok rules:**
- 2s per caption = standard TikTok rhythm
- `--transform-y -0.55` = bottom-of-screen position (natural reading zone)
- One `--keyword` per caption — never more
- `弹入跳动` = bounce-in, the signature TikTok animation

### Recipe 2 — 3-second hook

The first 3 seconds must hook. Structure:

```bash
# Caption 0–3s : question or shock number
capcut-david add-text "$DRAFT" --text "7 phrases qui manipulent" \
  --start 0 --end 3000000 \
  --keyword "manipulent" --keyword-color "#FF0000" \
  --in-anim "强力砸下" --in-anim-duration 300000 \
  --font-size 11 --bold --transform-y -0.55
```

Recommended hook animations: `强力砸下` (impact), `冲刺急停` (rush-stop),
`弹入跳动` (bounce).

### Recipe 3 — Background image + caption overlay

```bash
# Full-screen image for the entire duration with fade-in
capcut-david add-video "$DRAFT" --url https://example.com/bg.jpg \
  --width 1080 --height 1920 \
  --duration 30000000 --start 0 --end 30000000 \
  --in-anim "渐显" --in-anim-duration 500000
```

For multiple images: 3s per image, transition `叠化` (crossfade) or `推移` (push).

### Recipe 4 — Multi-image with synchronized caption timing

Each image lasts N seconds. Each caption lasts N seconds. They align perfectly.

```
Image 1   : 0          → 3_000_000
Image 2   : 3_000_000  → 6_000_000
Caption 1 : 0          → 3_000_000
Caption 2 : 3_000_000  → 6_000_000
```

In practice:

```bash
for i in 0 1 2 3; do
  START=$(( i * 3000000 ))
  END=$((   START + 3000000 ))
  capcut-david add-video "$DRAFT" --url "img$((i+1)).jpg" \
    --width 1080 --height 1920 --duration 3000000 --start $START --end $END
  capcut-david add-text "$DRAFT" --text "Phrase $((i+1))" \
    --start $START --end $END \
    --keyword "Phrase" --keyword-color "#FFD600" \
    --font-size 9 --bold --transform-y -0.55 \
    --in-anim "弹入跳动" --in-anim-duration 350000
done
```

## TikTok color palettes

| Style | Text | Keyword | Notes |
|-------|------|---------|-------|
| Impact red | `#FFFFFF` | `#FF0000` | hook, manipulation, danger |
| Energy yellow | `#FFFFFF` | `#FFD600` | tips, lists, money |
| Accent pink | `#FFFFFF` | `#FF3A6E` | lifestyle, beauty, dating |
| Fire orange | `#FFFFFF` | `#FF6600` | hot takes, CTAs |
| Neon green | `#000000` | `#00FF87` | tech, hacker, gaming (use `#000000` text bg) |

## Fast (free) text animations

```bash
capcut-david query animations --type in --mode 2  # mode 2 = free only
```

Top free in-animations: `渐显` (fade), `弹入跳动` (bounce), `强力砸下` (impact),
`冲刺急停` (rush), `轻微放大` (gentle zoom).

## Pre-export checklist

- [ ] Caption `--transform-y` between -0.4 and -0.7 (not clipped by TikTok UI)
- [ ] No caption during the first 0.5s (let the image breathe)
- [ ] One colored keyword per caption — never more
- [ ] `--in-anim-duration` < 50% of caption length (otherwise CapCut clamps silently)
- [ ] BGM volume ≤ 0.20 if voiceover + music simultaneous (see `recipes-audio.md`)

## See also

- [SKILL.md](../SKILL.md) — capcut-david main skill (condensed recipes)
- [`capcut-david --help`](https://github.com/Davidb-2107/capcut-cli-david#commands) — CLI reference
- [`docs/draft-schema/02-materials.md`](../../../docs/draft-schema/02-materials.md) — text material structure (range styles, keyword highlight)
- Other recipes: [`recipes-motion.md`](recipes-motion.md), [`recipes-audio.md`](recipes-audio.md), [`recipes-storyboard.md`](recipes-storyboard.md)
