---
title: Audio recipes
parent_skill: capcut-david
source_skill: cut-audio
migrated: 2026-05-12
---

# Audio recipes

> Full recipes for audio-driven workflows (auto-fit on audio duration, volume
> ducking, beat-sync, multi-track). Condensed table-of-contents lives in
> [SKILL.md](../SKILL.md) §Recipes.
> These were originally in the `cut-audio` skill (deprecated 2026-05-12).

## When to use

Quand l'audio existe avant les visuels, ou quand plusieurs pistes audio
doivent coexister (narration + musique de fond). Ne pas utiliser si la vidéo
est purement visuelle sans contrainte audio.

Trigger phrases : "colle sur la musique", "audio-driven", "voiceover",
"beat drop", "ducket la musique".

> **Note (v0.5.0):** Some recipes call `capcut-david query audio-duration --url …`
> (catalogue lookup). That sub-command is **planned for v0.6.0** and is not yet
> available in v0.5.0. Until then, probe duration with `ffprobe` (or curl + a
> known-duration asset) and pass the µs value directly to `--duration`.

## Recipes

### Recipe 1 — Easy draft (fastest path)

One pipeline call: image + caption + BGM auto-aligned to the audio duration.
Use the `psycho-build` manifest for this — it computes audio duration and
stretches images/captions to match:

```yaml
# manifest.yml
format: tiktok
images:
  - { url: https://example.com/background.jpg }   # duration computed from audio
audio:
  narration: { url: https://example.com/narration.mp3, volume: 1.0 }
captions:
  - { text: "Texte affiché pendant toute la durée", start: 0, end: auto }
```

```bash
capcut-david psycho-build manifest.yml
```

**When to use:** voiceover already recorded, podcast clip, read poem, simple
narration. The pipeline detects the audio duration and stretches image +
caption to match exactly.

### Recipe 2 — Manual audio duration

When you know the duration, or want to verify it before building the draft.

```bash
# Get the exact duration in microseconds
DURATION=$(capcut-david query audio-duration --url "https://example.com/bgm.mp3" --json \
  | jq -r '.duration')
echo "Duration: $DURATION µs"

# Use it to align visuals
capcut-david add-video "$DRAFT" --url "https://example.com/bg.jpg" \
  --width 1080 --height 1920 \
  --duration "$DURATION" --start 0 --end "$DURATION"

capcut-david add-audio "$DRAFT" --url "https://example.com/bgm.mp3" \
  --duration "$DURATION" --start 0 --end "$DURATION" --volume 0.8
```

### Recipe 3 — Volume ducking (narration + music)

Music volume drops while voice speaks — standard podcast / narration pattern.
Two `add-audio` calls on independent tracks:

```bash
# Narration on its own track at full volume
capcut-david add-audio "$DRAFT" --url "https://example.com/narration.mp3" \
  --duration 30000000 --start 0 --end 30000000 --volume 1.0

# BGM on a separate track, ducked under voice
capcut-david add-audio "$DRAFT" --url "https://example.com/bgm.mp3" \
  --duration 30000000 --start 0 --end 30000000 --volume 0.15
```

**Volume rules:**

| Situation | Voice | BGM |
|-----------|-------|-----|
| Narration only | 1.0 | 0.12–0.18 |
| Narration + ambience | 1.0 | 0.20–0.30 |
| Music only (no voice) | — | 0.7–0.9 |
| Intro / outro (no voice) | — | 0.6–0.8 |

For dynamic ducking (BGM drops only during voice spans), use `add-keyframe`
with `--property volume` on the BGM segment at speech boundaries. v0.1.0
exposes `volume` as a keyframable property — see SKILL.md §Core CLI surface.

### Recipe 4 — Manual beat sync

Align image cuts on the music's beats.

```bash
# 1. Listen to the track and note beat timestamps in seconds
#    Ex: beats at 0s, 2.5s, 5s, 7.5s, 10s

# 2. Convert to microseconds
python3 -c "beats=[0, 2.5, 5, 7.5, 10]; [print(int(b*1000000)) for b in beats]"
# → 0, 2500000, 5000000, 7500000, 10000000

# 3. Use those as start/end on sequential add-video calls
capcut-david add-video "$DRAFT" --url img1.jpg --width 1080 --height 1920 \
  --duration 2500000 --start 0       --end 2500000  --transition "叠化"
capcut-david add-video "$DRAFT" --url img2.jpg --width 1080 --height 1920 \
  --duration 2500000 --start 2500000 --end 5000000  --transition "叠化"
capcut-david add-video "$DRAFT" --url img3.jpg --width 1080 --height 1920 \
  --duration 2500000 --start 5000000 --end 7500000  --transition "叠化"
```

**Beat drop:** at the drop, use a stronger transition (`推移`, `闪白`) and bump
the Ken Burns scale via `capcut-david ken-burns ... --style dramatic`.

### Recipe 5 — Multi-segment audio (intro + body + outro)

Three sequential audio calls on the same or different tracks:

```bash
# Intro music 0–3s
capcut-david add-audio "$DRAFT" --url https://example.com/intro.mp3 \
  --duration 3000000  --start 0       --end 3000000  --volume 0.8

# Main narration 3s–28s
capcut-david add-audio "$DRAFT" --url https://example.com/narration.mp3 \
  --duration 25000000 --start 3000000 --end 28000000 --volume 1.0

# BGM under narration 0s–28s (independent track)
capcut-david add-audio "$DRAFT" --url https://example.com/bgm.mp3 \
  --duration 28000000 --start 0       --end 28000000 --volume 0.15
```

## Audio checklist

- [ ] `--duration` = **source** file duration (not timeline duration)
- [ ] Use `capcut-david query audio-duration --url <url>` if duration unknown
- [ ] Voice volume = 1.0, BGM ≤ 0.20 when simultaneous
- [ ] Audio segments may overlap (independent tracks — see SKILL.md §Critical rules #3)
- [ ] `psycho-build` requires a publicly accessible URL (or a local path resolvable from CWD)

## See also

- [SKILL.md](../SKILL.md) — capcut-david main skill (condensed recipes)
- [`capcut-david --help`](https://github.com/Davidb-2107/capcut-cli-david#commands) — CLI reference
- [`docs/draft-schema/02-materials.md`](../../../docs/draft-schema/02-materials.md) — audio material structure
- Other recipes: [`recipes-motion.md`](recipes-motion.md), [`recipes-tiktok.md`](recipes-tiktok.md), [`recipes-storyboard.md`](recipes-storyboard.md)
