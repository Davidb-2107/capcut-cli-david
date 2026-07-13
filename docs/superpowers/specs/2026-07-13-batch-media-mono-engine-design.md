# Batch media verbs — mono-engine montage pipeline (v2.1.0)

**Date:** 2026-07-13
**Status:** approved (brainstorm 2026-07-13, David)

## Problem

The production montage pipeline (`Shared/montage-tools/` in the vault) needs TWO
engines to build an episode. `capcut-david` handles captions/restyle/keyframes-edit/
validate/register, but draft creation and batch media placement still shell out to
`cutcli` — a **third-party** standalone binary (cut_cli, cutcli.com, v1.3.6,
`~/bin/cutcli.exe`, 101 MB): not on npm, not pinnable, not reproducible, tied to a
cloud backend (`ts-api.fyshark.com`). It is the only link in the chain that cannot be
reinstalled from source. The 2026-07-13 ghost-draft incident (draft built in
`~/.cut/drafts`, invisible in CapCut) came from this dependency.

cutcli verbs still used by the prod pipeline:

| cutcli verb | Consumer | Contract to preserve |
|---|---|---|
| `config show` | assemble_draft.py | drafts-root discovery |
| `draft create --width 1080 --height 1920 --name <slug>` | assemble_draft.py | portrait draft in the CapCut root |
| `videos add <slug> --video-infos @file` | assemble_draft.py | batch; **returns segment ids in item order** (consumed by Ken Burns keyframes); places IMAGES as `photo` materials ("plan noir" rule); per-item `volume: 0` |
| `keyframes add <slug> --keyframes @file` | assemble_draft.py | batch scale keyframes, ease-out |
| `audios add <name> --audio-infos @file` | add_sfx_to_montage.py | batch SFX |

Narration ([3/9]) already uses `capcut-david add-audio`. Captions already use
`import-captions`.

## Goal

The prod chain (`assemble_draft.py`, `build_montage.py`, `add_sfx_to_montage.py`)
depends on **capcut-david only**. Out of scope (separate later effort): the legacy
skill `1_CapCut-Draft-Builder/Tools/build_draft.py` keeps cutcli; `cutcli.exe` stays
on the machine for it.

## Decisions (brainstorm)

1. **Scope: prod first.** montage-tools only; legacy skill migrates later.
2. **Native batch verbs**, not cutcli-grammar emulation, not pipeline loops over
   unitary verbs. One node spawn + ONE draft save per batch (atomicity), explicit
   ordered-ids contract. Consumers are ours and get updated.
3. **A/B proof then hard cutover.** No `--engine` fallback flag, no dual path.

## Engine changes (repo `capcut-cli-david`, v2.1.0, minor)

### 1. `init <name> --width <n> --height <n>`

After template copy, rewrite `canvas_config.width/height` in `draft_content.json`
(template `minimal` is 1920×1080; pipeline needs 1080×1920). Both flags or neither
(die on one-sided). Existing JSON output unchanged (`draft_path` already returned —
it replaces `config show` for the pipeline).

### 2. `add-video <project> --batch @items.json`

- Items: `[{path, start, duration, width?, height?, volume?, trackName?}]`
  (`start`/`duration` accept the same time inputs as the unitary form; µs integers
  in practice).
- Photo/video detection per item by extension — **already implemented**
  (`create.ts` `addVideo`, jpg/jpeg/png/webp/bmp/tiff → `photo`).
- New: `volume?` in `AddVideoOptions` applied to the created segment (montage clips
  are muted, `volume: 0`).
- **All-or-nothing:** validate every item (file exists, times parse, schema) BEFORE
  the first mutation; on any invalid item die without saving. ONE `saveDraft` at the
  end.
- Output: `{ok: true, segment_ids: [...], material_ids: [...], track_ids: [...]}` —
  all three arrays **in item order** (items may target different tracks via
  `trackName`; hard contract, tested).
- `--batch` is mutually exclusive with the positional single-file form.

### 3. `add-audio <project> --batch @items.json`

Same shape and semantics; `volume` already exists on the unitary verb.

### 4. `add-keyframe <project> --batch @file`

Entries: `[{segment_id, property, keyframes: [{time, value, curve?}]}]`. Reuses
`cmdAddKeyframe` internals — the Δ-scaling Cubic Out parity (v1.3.0) is preserved by
construction. ONE save. Output `{ok: true, count}`.

### Key test — batch ≡ N× unitary oracle

A batch of N items must produce a draft **byte-identical** (modulo uuids) to N
unitary calls. The batch path cannot drift from the already-proven unitary path.
Plus standard TDD suite (node:test) per repo conventions: schema validation errors,
all-or-nothing on item k failure, ordered ids, photo/video mix, volume applied,
empty batch dies.

## Pipeline changes (vault `Shared/montage-tools/`)

- **assemble_draft.py**: `config show` + `draft create` → `capcut-david init <slug>
  --width 1080 --height 1920`; returned `draft_path` becomes `draft_dir`.
  `videos add` → `add-video --batch @video_infos.json`. `keyframes add` →
  `add-keyframe --batch @kenburns_keyframes.json` (curve naming `ease_out` →
  `ease-out`). The drafts-root gate + self-heal calls are REMOVED here (no cutcli
  left; init targets the platform root explicitly) — they stay in `engine.py` for
  the legacy skill.
- **build_montage.py**: emits the new item schema (`path` instead of `videoUrl`,
  etc.) — adapt the producer, not translate at the consumer.
- **add_sfx_to_montage.py**: `cutcli audios add <name>` → `capcut-david add-audio
  <path> --batch @sfx_audio_infos.json`; name→path resolved via a new
  `engine.default_projects_root()` helper (mirror of `capcut-paths.ts`).
- **engine.py**: new version gate `require_batch_media()` (marker `--batch` in
  global `--help`) so the pipeline refuses an engine < 2.1.0; new
  `default_projects_root()` helper.
- Hermetic tests updated (`test_engine.py`, `test_add_sfx_to_montage.py`,
  `test_build_montage.py`).

## A/B proof then cutover

1. Pick the last shipped known-good Stickman episode.
2. Build it twice: current cutcli path (pre-change master) and new path (branch).
3. Disposable structural comparator (`script_temp/`): tracks (type/count/order),
   segments (timings µs, volumes, photo/video material types), keyframes
   (property/values/curves), materials/Resources — canonical comparison, uuids
   excluded.
4. Both drafts pass `validate` rc=0; David opens both in CapCut visually.
5. Equivalent → delete the cutcli calls from montage-tools (hard cutover).

## Release + docs

- npm **v2.1.0** + GitHub release + tag (first release exercising the Node 22 /
  npm@latest Release workflow).
- CHANGELOG, `--help`, engine-explained if applicable.
- Vault: SKILLS MAP badge, ENGINE-FACTS (prod is mono-engine; cutcli = legacy skill
  only), ship via vault-session.

## Acceptance criteria

1. A full episode builds through assemble_draft.py with **zero** cutcli invocation
   (grep-proof on montage-tools).
2. A/B structural equivalence on a real episode + validate rc=0 + visual CapCut OK.
3. Batch ≡ unitary oracle green; whole engine suite green (≥ current 500 tests, CI
   3 OS × 3 Node).
4. `require_batch_media()` gate blocks an engine < 2.1.0 with an actionable message.
5. npm 2.1.0 published `latest`; global binary updated.
