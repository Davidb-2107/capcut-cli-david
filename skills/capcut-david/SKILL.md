---
name: capcut-david
version: "0.5.0"
status: published
created: 2026-05-11
updated: 2026-06-12
description: >-
  Create, edit, inspect, and assemble CapCut draft_content.json projects via the
  capcut-david CLI. Single binary that combines cutcli's creation power (keyframes,
  Ken Burns, animations, stickers, filters, effects) with capcut-cli's inspection
  surface (segments, tracks, shift, speed, volume, export-srt) — plus a psycho-build
  pipeline for TikTok-format Psycho/Paranoia drafts.
  USE WHEN building or modifying a CapCut draft from a script, brief, or YAML manifest;
  inspecting segments/tracks; shifting/trimming/retiming clips; applying Ken Burns or
  keyframe motion; styling captions with keyword highlights; exporting SRT subtitles;
  assembling a complete vertical short from images + audio + captions.
when_to_use: >-
  Any time the user wants to programmatically generate, modify, or read a CapCut
  draft_content.json file. Supersedes cut-draft / cut-storyboard / cut-motion /
  cut-audio / cut-tiktok as of capcut-cli-david v0.5.0 (Phase E shipped 2026-05-12).
when_not_to_use: >-
  • Rendering or exporting an MP4 — capcut-david produces drafts to open in CapCut
    desktop, not a renderer.
  • JianYing 6+ drafts on disk (encrypted, unsupported — see COMPATIBILITY.md §5).
  • Mobile / Web / Linux CapCut variants (out of scope).
  • Pure orchestration of three TikTok micro-skills → use TikTokPsychoNiche instead.
deprecates: [cut-draft, cut-storyboard, cut-motion, cut-audio, cut-tiktok]
deprecation_gate: "capcut-cli-david v0.5.0 shipped 2026-05-12 (Phase E)"
---

# capcut-david — Unified CapCut Draft CLI

`capcut-david` is the single CLI that creates, edits, and inspects CapCut
`draft_content.json` projects. It is the Node.js fork of `renezander030/capcut-cli`
extended with cutcli-style creation commands (keyframes, Ken Burns, animations).

> **Status:** Published with capcut-cli-david **v0.5.0** (Phase E, 2026-05-12).
> This skill supersedes the 5 legacy `cut-*` skills — see §Migration for the
> cutover plan. The `query` command referenced in some recipes is **planned for
> v0.6.0**; until then, hard-code animation/filter names from
> [`docs/draft-schema/04-effects-filters-stickers.md`](../../docs/draft-schema/04-effects-filters-stickers.md).

---

## What the binary does

| Concern | Command family | Replaces |
|---|---|---|
| **Create** | `init`, `add-video`, `add-audio`, `add-text` | cutcli `draft create` / `images add` / `audios add` / `captions add` |
| **Animate** | `add-keyframe`, `ken-burns` | cutcli `keyframes add` |
| **Edit** | `shift`, `speed`, `volume`, `trim`, `opacity`, `set-text` | upstream capcut-cli edit commands |
| **Inspect** | `info`, `segments`, `tracks`, `texts`, `export-srt` | upstream capcut-cli inspect commands |
| **Assemble** | `psycho-build` | new — YAML-manifest → full draft pipeline |

Binary: `capcut-david`. Install: `npm i -g capcut-cli-david`. Node ≥ 18.

---

## When to use this skill

Use when the user wants to:
- **Build** a CapCut draft programmatically from images + audio + captions
- **Modify** an existing draft (shift segments, change speed, retime, retext)
- **Inspect** a draft (list tracks, dump segments, count materials, export SRT)
- **Animate** static images (Ken Burns, pan, opacity fade, keyframe motion)
- **Style** captions (keyword highlight, animations, position, font)
- **Apply** filters / effects / stickers / transitions / masks
- **Pipeline** a Psycho/Paranoia TikTok short from a brief

Trigger phrases (FR/EN): "crée un draft CapCut", "anime cette image", "Ken Burns",
"style TikTok", "keyword highlight", "shift le segment", "retime la séquence",
"inspect ce draft", "export les sous-titres", "psycho build", "génère un script
capcut-david", "build a CapCut project".

---

## Time, units, coordinates

- **Time:** microseconds. `1s = 1_000_000`. Use `--start 0 --end 3000000`. The
  human-readable form `--start 0 --end 3s` is supported by `parseTimeInput` in
  utility code; CLI flags accept µs directly in v0.5.0.
- **Coords:** normalized `[-1, 1]`, `(0,0)` = screen center, `+Y` = up, `+X` = right.
  `(−1,−1)` is bottom-left.
- **Filter intensity:** `[0, 1]` (UI slider value ÷ 100 — see `docs/draft-schema/05`).
- **Encoding:** UTF-8 **without BOM**. Never use PowerShell `Out-File` on Windows
  without `-Encoding utf8` (writes BOM → CapCut refuses to load).

---

## Core CLI surface

```bash
# Create
capcut-david init [--width 1080] [--height 1920] [--name <slug>]
  → prints the draft path (or use --json for {draftPath, draftId})

capcut-david add-video <draftPath> --url <u> --width N --height N \
  --duration <µs> --start <µs> --end <µs> [--volume 0..1] [--transition <name>]

capcut-david add-audio <draftPath> --url <u> --duration <µs> \
  --start <µs> --end <µs> [--volume 0..1]

capcut-david add-text  <draftPath> --text <s> --start <µs> --end <µs> \
  [--keyword <s> --keyword-color <hex> --keyword-size N] [--font-size N] [--bold] \
  [--y -0.55] [--in-anim <name>] [--out-anim <name>]
  # NB: vertical position on add-text = --y; --transform-y is import-captions-only

capcut-david import-captions <draftPath> <captions.json> \
  [--color <hex>] [--highlight-color <hex>] [--highlight-size N] [--transform-y <n>] \
  [--track-name <s>] [--clone-style]
  # batch [{text,start,end,hl?,color?,hlSize?}] (µs) — REPLACES the text track;
  # --transform-y (v1.16.0) = clip.transform.y of every rebuilt caption
  # (negatives OK: -0.4 mi-bas, -0.6 lower third) — no post-import re-pin needed

# Animate
capcut-david add-keyframe <draftPath> --segment-id <id> --property <p> \
  --offset <µs> --value <n> [--easing linear|ease-in|ease-out|ease-in-out]
  # properties: scale_x, scale_y, position_x, position_y, rotation, opacity

capcut-david ken-burns <draftPath> --segment-id <id> \
  [--style subtle|standard|dramatic|psycho] [--pan auto|none|lr|rl|tb|bt]

# Edit
capcut-david shift   <draftPath> --segment-id <id> --by <µs>
capcut-david speed   <draftPath> --segment-id <id> --factor <n>
capcut-david volume  <draftPath> --segment-id <id> --value <0..1>
capcut-david trim    <draftPath> --segment-id <id> --start <µs> --end <µs>
capcut-david opacity <draftPath> --segment-id <id> --value <0..1>
capcut-david set-text <draftPath> --segment-id <id> --text <s>

# Inspect
capcut-david info     <draftPath> [--json]
capcut-david segments <draftPath> [--track <id>] [--json]
capcut-david tracks   <draftPath> [--json]
capcut-david texts    <draftPath> [--json]
capcut-david export-srt <draftPath> -o <file.srt>

# Pipeline
capcut-david psycho-build <manifest.yml>
```

**All commands accept `--json` for machine-readable output.** `inspect` family
emits the parsed structures from `docs/draft-schema/`.

---

## Recipes (condensed — see `references/` for full versions)

### Ken Burns intensity table

| Style | scale start → end | pan | use case |
|---|---|---|---|
| `subtle` | 1.0 → 1.15 | none | documentary, photo essay |
| `standard` | 1.0 → 1.3 | optional | general short-form |
| `dramatic` | 1.0 → 1.5 | yes | impact / hook shots |
| `psycho` | 1.0 → 1.08 (very slow) | slight | paranoia / dread niche |

`capcut-david ken-burns <draft> --segment-id $SEG --style psycho`
→ writes paired `scale_x` + `scale_y` keyframes at `offset: 0` and segment end,
cubic-out easing. Emits the dual-container shape documented in
`docs/draft-schema/03-keyframes-and-animations.md` §Ken Burns.

### TikTok caption preset

```bash
capcut-david add-text $DRAFT --text "Phrase accrocheuse" \
  --start 0 --end 2000000 \
  --keyword "accrocheuse" --keyword-color "#FFD600" \
  --font-size 9 --bold --y -0.55 \
  --in-anim "弹入跳动" --in-anim-duration 350000
```

Rules: 2s per caption, one keyword max, `--y` between `-0.4` and `-0.7`
to stay above the TikTok UI band, animation duration < 50% of caption length.

### Audio ducking (narration + BGM)

| Pattern | Voice volume | BGM volume |
|---|---|---|
| Narration only | 1.0 | 0.12–0.18 |
| Narration + ambience | 1.0 | 0.20–0.30 |
| Music-only (no voice) | — | 0.7–0.9 |
| Intro / outro | — | 0.6–0.8 |

### Beat-sync image cuts

Convert beat timestamps (seconds) → microseconds, use as `--start` / `--end` on
sequential `add-video` calls with `--transition "叠化"` (crossfade) on inter-beat
shots and a stronger transition (`推移`, `闪白`) on the drop.

### Storyboard workflow (brief → script)

When the user supplies a free-form brief ("fais une vidéo de 30s sur X"):

1. **Storyboard table** — produce a markdown table: Shot | Time | Visual | Caption | Music/SFX | Transition.
2. **Bash script** — translate to a `run.sh` that calls capcut-david commands, with `data/*.json` files for any non-trivial JSON args.
3. **Self-review** — list exactly 3 parameters to tweak (font size, per-shot duration, filter intensity) with the exact command to change each.

### Psycho/Paranoia full draft

```bash
capcut-david psycho-build manifest.yml
```

`manifest.yml` shape:

```yaml
format: tiktok            # 1080x1920
images:
  - { url: img1.jpg, duration: 5s }
  - { url: img2.jpg, duration: 5s }
audio:
  narration: { url: narr.mp3, volume: 1.0 }
  bgm:       { url: bgm.mp3,  volume: 0.18 }
captions:
  - { text: "...", start: 0,  end: 2s, keyword: "...", color: "#FF3A6E" }
ken_burns: psycho         # applied to every image
caption_preset: tiktok-bottom
```

---

## Critical rules

1. **Always inspect before edit.** Run `capcut-david segments <draft> --json`
   first to get the actual segment IDs — they change every draft.
2. **`width`/`height` required for images and videos.** Same for `duration` on
   videos and audio (source duration in µs, not timeline duration).
3. **Time intervals on the same track must not overlap.** Cross-track overlap is
   fine (audio + video + text are independent tracks).
4. **Animation names are native Chinese CapCut tokens.** Use `capcut-david query
   animations --type in|out|loop` to list valid names. Invalid names are
   silently dropped.
5. **`in-anim-duration + out-anim-duration < segment duration`.** CapCut clamps
   silently — you'll see a broken animation, not an error.
6. **One keyword per caption.** Multi-keyword highlight is supported by the
   schema (N non-overlapping `range` styles per `docs/draft-schema/02-materials.md`)
   but the v0.5.0 `add-text` CLI exposes one slot to stay simple.
7. **Writes are conservative.** capcut-david emits the cutcli-shape variant
   (`new_version: "167.0.0"`, no `loudnesses` ref) unless `--ui-shape` is passed.
   This maximises forward-compat with CapCut 8.x and JianYing 5.x.
8. **Never touch JianYing 6+ drafts.** They are encrypted on disk — capcut-david
   exits non-zero with a documented error. See `COMPATIBILITY.md` §5.
9. **UTF-8 no BOM** on Windows. capcut-david writes correctly; only matters when
   editing the JSON by hand or via PowerShell.

---

## Migration from cut-* skills

| Old skill | What survives | Where it lives now |
|---|---|---|
| `cut-draft` | CLI reference | **Replaced** by this SKILL.md + `capcut-david --help` + `docs/draft-schema/` |
| `cut-storyboard` | 3-step workflow | §Recipes / Storyboard workflow above + `references/recipes-storyboard.md` |
| `cut-motion` | Ken Burns intensity table, easing patterns | §Recipes / Ken Burns intensity table + `references/recipes-motion.md` |
| `cut-audio` | Volume ducking table, beat-sync method | §Recipes / Audio ducking + Beat-sync above + `references/recipes-audio.md` |
| `cut-tiktok` | TikTok palettes, hook structure, timing rules | §Recipes / TikTok caption preset + `references/recipes-tiktok.md` |

**Cutover** — all 5 cut-* skills move to `~/.claude/skills.deprecated/` on the day
capcut-cli-david **v1.0.0** publishes to npm (end of Phase E). v0.5.0 is the
"both work in parallel" beat for self-validation; cut-* skills get
`deprecated: true` frontmatter + a redirect note at 1.0.0 publish. No phased
migration window beyond that — solo user, no external consumers.

**What is NOT replaced:**
- `TikTokPsychoNiche` — orchestrator of `1_CapCut-Draft-Builder` / `CapCut-CaptionStyling` /
  `CapCut-ZoomFX`. Independent of cutcli, untouched by this migration.
- The 3 micro-skills above — kept; they target a different (image-generation) layer.

---

## References

- [`docs/draft-schema/`](../../docs/draft-schema/) — the JSON Bible (6 files, ~3000 lines)
- [`COMPATIBILITY.md`](../../COMPATIBILITY.md) — version + OS support contract
- [`UPSTREAM.md`](../../UPSTREAM.md) — fork/sync policy
- `references/recipes-motion.md` — full Ken Burns / pan / opacity / multi-image patterns
- `references/recipes-audio.md` — full audio-driven workflow + ducking + beat-sync
- `references/recipes-tiktok.md` — full TikTok caption presets + palettes + hook structure
- `references/recipes-storyboard.md` — full brief → storyboard → script → review workflow
- [[wiki/analyses/2026-05-11-capcut-cli-david-project]] — project master plan
- [[wiki/concepts/capcut-draft-schema]] — upstream concept page (in vault)
