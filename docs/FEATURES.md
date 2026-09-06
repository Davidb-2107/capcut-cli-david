# Feature map — capcut-cli-david

The single index of what this CLI does today. Anchored on
[`src/capabilities.ts`](../src/capabilities.ts) (43 verbs, 7 categories, 3 chains):
[`test/capabilities.test.mjs`](../test/capabilities.test.mjs) fails the build if a
dispatched verb is missing from the registry or a registry entry is not dispatched —
this map can describe only verbs that actually exist.

For the interactive version: `capcut-david ui`. For per-flag reference:
`capcut-david <verb> --help`.

## Verbs by category

### Créer

| Verb | What it does | Since |
|---|---|---|
| `init` | Empty draft from the minimal template (canvas size via `--width/--height`) | 0.1.0 |
| `init-meta` | Generate the missing `draft_meta_info.json` sidecar (repairs `meta.missing`) | 1.11.0 |
| `register` | Index a built draft into CapCut's `root_meta_info.json` (idempotent) | 1.1.0 |
| `psycho-build` | Complete TikTok-format draft from one YAML manifest (images + Ken Burns + voice + music + SRT captions), deterministic via `--seed` | 0.4.0 |
| `save-template` | Save an existing segment as a reusable JSON template | 0.1.0 |
| `apply-template` | Apply a saved template as a new segment | 0.1.0 |

### Peupler

| Verb | What it does | Since |
|---|---|---|
| `add-video` | Video/image segment; media copied into `Resources/` with portable draftpath token; `--batch` for many clips in one save | 0.1.0 |
| `add-audio` | Audio segment (voice/music/SFX) with volume; `--batch` supported | 0.1.0 |
| `add-text` | Text/caption with keyword highlight and free positioning; native multi-span rich text | 0.1.0 |
| `import-captions` | Bulk word-level captions from JSON; per-card highlight, `--clone-style`, native vertical transform | 1.4.0 |
| `cascade-words` | Word-by-word phrase reveal (not karaoke) driven by measured font metrics; `--alpha-lines` experimental mode | 2.8.0 |

### Captions & Styles

| Verb | What it does | Since |
|---|---|---|
| `restyle` | Apply a font/outline/shadow/size preset to all captions (span-aware) | 1.6.0 |
| `make-preset` | Generate a bare-font preset from a font already used in the drafts library (read-only) | 1.14.0 |
| `set-text` | Replace a caption's text (refuses multi-span captions) | 0.1.0 |
| `texts` | List all text content | 0.1.0 |
| `export-srt` | Export captions as SRT | 0.1.0 |

### Éditer

| Verb | What it does | Since |
|---|---|---|
| `shift` / `shift-all` | Shift one segment / a whole track in time | 0.1.0 |
| `speed` | Change playback speed | 0.1.0 |
| `volume` | Set audio volume | 0.1.0 |
| `trim` | Cut a segment to a new start/duration | 0.1.0 |
| `opacity` | Set segment opacity | 0.1.0 |
| `remove-segment` | Remove a segment, then GC orphaned materials via the `gc` plan | 2.5.0 |
| `cut` | Long-form → short extract into a new path | 0.1.0 |
| `batch` | Multiple edits from JSONL stdin, one save | 0.1.0 |

### Animer

| Verb | What it does | Since |
|---|---|---|
| `ken-burns` | Paired scale keyframes over one segment, cubic-out easing (CapCut-parity proven) | 0.3.0 |
| `add-keyframe` | Generic keyframe on scale/position/rotation/alpha; `--batch` supported | 0.3.0 |
| `add-effect` | Video FX by catalogue resource_id (`--full` for whole timeline) | 1.1.0 |
| `add-filter` | Filter by catalogue resource_id | 2.4.0 |
| `add-transition` | Transition attached to a segment | 2.5.0 |

### Réparer & Valider

| Verb | What it does | Since |
|---|---|---|
| `validate` | Read-only linter (broken refs, orphans, duplicate ids, durations, overlaps, timeline identity/divergence); `--fix --apply` aggregates all fixers (writes, CapCut closed required) | 1.8.0 |
| `sync-timelines` | Repair a stale `Timelines/<guid>/` mirror; also normalizes copied-draft timeline identity (`timelines.identity`) | 1.9.0 |
| `gc` | Delete orphaned text/video/audio materials (JSON only, never disk files) | 1.10.0 |

### Découvrir

| Verb | What it does | Since |
|---|---|---|
| `query` | Search effects/filters/transitions/fonts/stickers/masks/animations/curves by name across the drafts library (`--all` inventory) | 1.13.0 |
| `catalogue` | Persistent memory of validated resources (name → resource_id), append-only, hand-annotatable; default store `<vault>/Shared/capcut-catalogue.json` | 2.6.0 |
| `info` / `tracks` / `segments` / `materials` / `segment` / `material` | Inspection surface | 0.1.0 |
| `calibration-ui` | Local ElevenLabs voice-calibration UI (corpus, dry-run, explicit approval, WPM publication) | 2.7.0 |
| `ui` | Open the capability map page bundled with the installed version | 2.2.0 |

## Pipelines (chains)

1. **Montage Stickman / épisode v1** — `Shared/montage-tools assemble_draft.py` drives:
   `init` → `init-meta --register` → `add-video --batch` → `add-audio` → `add-text` →
   `restyle` → `import-captions --clone-style --transform-y` → `add-keyframe --batch` →
   `sync-timelines` → `validate` (final gate before opening CapCut).
2. **Repost Amélioré phase 5** (b-roll under the voice): `init` → `init-meta --register` →
   `add-audio` → `import-captions` → `restyle` → `add-video --batch` → `validate`.
3. **psycho-build** — one verb, full draft.

## Sub-systems beyond single verbs

| Sub-system | Code | Docs |
|---|---|---|
| ElevenLabs voice calibration (dry-run → approval → execute → WPM publication) — own npm workspace, adapter verb in the CLI | `packages/voice-calibration/src/` (ports & adapters), `packages/voice-calibration/src/calibration-cli.ts`, root `src/commands/calibration-ui.ts` | [`../packages/voice-calibration/docs/calibration-architecture.md`](../packages/voice-calibration/docs/calibration-architecture.md), [`../packages/voice-calibration/docs/calibration-mvp.md`](../packages/voice-calibration/docs/calibration-mvp.md), [`../packages/voice-calibration/docs/elevenlabs-calibration-contract-inventory.md`](../packages/voice-calibration/docs/elevenlabs-calibration-contract-inventory.md) |
| Cascade words + font metrics (OpenType measurement, alpha-lines mode, calibrated profiles) | `src/commands/cascade-words.ts`, `src/utils/font-metrics.ts`, `src/utils/font-calibration.ts`, `src/utils/font-resolver.ts` | [`cascade-words-font-calibration.md`](./cascade-words-font-calibration.md), [`plan-2026-08-28-cascade-words-font-metrics.md`](./plan-2026-08-28-cascade-words-font-metrics.md) |
| Draft model & timeline mirrors (load/save, identity normalization, mirror sync) | `src/draft.ts`, `src/utils/timelines.ts` | [`draft-schema/`](./draft-schema/) |
| Capability registry (this map's source) | `src/capabilities.ts`, `src/ui/` | [`../README.md`](../README.md) |

## External contracts (the vault's `Shared/` tree)

- `Shared/voice-calibration/voice_wpm.json` — canonical WPM authority; local profiles
  are projections validated against it (see the calibration bridge).
- `Shared/capcut-catalogue.json` — default `catalogue` store.
- `Shared/montage-tools/` — episode pipeline driving chain 1.
- `cartographie/capcut-cli-*.html` — mirrors regenerated by `npm run build` (capabilities + catalogue UIs).
