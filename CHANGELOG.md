# Changelog

All notable changes to `capcut-cli-david` are documented here.
Format follows [Keep a Changelog 1.1](https://keepachangelog.com/en/1.1.0/);
this project adheres to [SemVer 2.0.0](https://semver.org/spec/v2.0.0.html).
Fork-specific sub-sections (*Synced from upstream*, *Compatibility*) are added
per [`RELEASE.md`](../RELEASE.md) §4.

## [Unreleased]

### Planned
- `1.0.0` — graduation to stable per [`RELEASE.md`](../RELEASE.md) §1 once `1.0.0-rc.1` soaks clean.

## [1.0.0] — TBD

**Stable release.** Full SemVer guarantees per [`RELEASE.md`](../RELEASE.md) §1 now in effect.

### Highlights
- _(Final highlights go here — pulled from cumulative 0.x → 1.0 work.)_

### Migration from 0.x
- _(See `release-notes/1.0.0.md` for the full migration guide.)_

### Deprecated and removed
- The 5 legacy `cut-*` Claude skills are deprecated as of this release. Migrate to the unified `capcut-david` skill bundled in this package.

### Compatibility
- CapCut: ≥ 5.x desktop (cutcli 167.x and CapCut-UI 169.x both supported).
- JianYing 6+: unsupported (encrypted draft).
- Node: ≥ 18.
- Runtime deps: zero.

## [1.0.0-rc.1] — TBD

Release candidate for 1.0.0. No code changes vs 0.5.0 unless flagged below.

_(To be finalized at RC publish. Expected to contain: post-0.5.0 soak feedback fixes, docs polish, skill-cutover orchestration in `~/.claude/skills/`. Bump to `1.0.0` if no fixes after the soak window; bump `1.0.0-rc.N+1` otherwise.)_

## [0.5.0] — 2026-05-12

Phase E packaging consolidation — graduation prep. **No new commands** (feature-frozen per Phase E constraints). The fork ships its own Claude Code skill bundle and an in-repo CapCut draft-schema reference, in service of the imminent `1.0.0` graduation.

### Added
- `skills/capcut-david/SKILL.md` — unified Claude Code skill that supersedes `cut-draft`, `cut-storyboard`, `cut-motion`, `cut-audio`, and `cut-tiktok` (the 5 legacy `cut-*` skills). Bundled with the npm package under `skills/`.
- `skills/capcut-david/references/recipes-{motion,audio,tiktok,storyboard}.md` — full recipes migrated and consolidated from the 5 source skills, normalised against the `capcut-david` command surface.
- `docs/draft-schema/` (7 files, ~3000 lines) — in-repo reverse-engineered reference for CapCut's `draft_content.json` schema: overview, tracks/segments, materials, keyframes & animations, effects/filters/stickers, and version differences.
- `docs/README.md` — thin docs index pointing at `draft-schema/` and the existing top-level docs (`RELEASE.md`, `UPSTREAM.md`, `COMPATIBILITY.md`).
- `release-notes/` — per-version GitHub release-notes drafts (this directory). Each release tag pulls its body from the matching file.

### Changed
- `README.md` — full rewrite: tagline + comparison table (vs upstream `cutcli` and `capcut-cli`) + Quickstart + command index + pointers to `skills/capcut-david/SKILL.md` and `docs/draft-schema/`.
- `package.json` — `files` array extended to ship `skills/` and `docs/` with the npm package alongside the existing `dist/`, `templates/`, `README.md`, `LICENSE`, `NOTICE`.

### Compatibility
- CapCut: same as 0.4.0 (≥ 5.x desktop / JianYing 移动剪辑 ≥ 12.x).
- Node: `engines.node >= 18` (unchanged).
- Runtime deps: still zero.

## [0.4.0] — 2026-05-12

Phase D — the `psycho-build` YAML manifest pipeline. A single command that
composes the existing creation primitives (`init` + `add-video` × N +
`ken-burns` × N + `add-audio` × 2 + `add-text` × M) into a complete
TikTok-format (1080×1920) draft. Zero new draft-writing code lives in the
pipeline module — it orchestrates only.

### Added
- `capcut-david psycho-build <manifest.yaml> [--out <dir>] [--seed <n>]`
  — consumes a YAML manifest describing images (each with optional
  `ken_burns`), an optional voice track, optional music track (statically
  ducked via `volume`), and optional SRT-driven captions with a style
  preset. Produces a draft directory ready to open in CapCut.
- `src/commands/pipeline.ts` — hand-rolled YAML subset parser (block +
  flow mappings/sequences, scalars, quoted strings, comments, line-numbered
  errors), hand-rolled SRT parser (HH:MM:SS,mmm timing, multi-line text,
  CRLF tolerant, optional index line), manifest validator with field-level
  error messages, mulberry32 + FNV-1a seeded UUID generator for
  deterministic builds (RFC 4122 v4 layout).
- `--seed <n>` global flag — same seed + same manifest → byte-identical
  draft. Seed may also live in the manifest under `seed:` (the CLI flag
  wins).
- `examples/psycho/manifest.example.yaml` + placeholder assets
  (`assets/img{1,2,3}.jpg`, `assets/narration.mp3`, `assets/ambient.mp3`,
  `assets/captions.srt`) + `examples/psycho/README.md` Quickstart.
- `templates/minimal/draft_content.json` — bundled empty-draft template
  for `init`-style operations from the pipeline (shipped via
  `package.json:files`).
- `test/pipeline.test.mjs` — 39 new tests (212 total): YAML parser units
  (scalars, quoted strings, nested blocks, flow values, comments, errors),
  SRT parser units (3-entry blocks, multiline text, CRLF, missing index,
  empty input, malformed timestamps), manifest validator coverage (every
  required field's specific error message), duration parser, seeded UUID
  determinism, full E2E build vs the example manifest with structural
  assertions, determinism check (same seed twice → identical draft modulo
  volatile path fields), different-seed-different-ids check, and three
  CLI-level happy/error paths.

### Changed
- `--help` adds a new `Pipeline:` section documenting `psycho-build`.
- `src/utils/companion.ts` — `setUuidProvider(fn | null)` is new and lets
  pipeline.ts swap `randomUUID` for a seeded generator without touching
  any other module. Existing UUID semantics unchanged when no provider
  is installed.
- `package.json` — `files` includes `templates/` so the bundled minimal
  draft template ships with the npm package.

### Compatibility
- CapCut: same as 0.3.0 (≥ 5.x desktop / JianYing 移动剪辑 ≥ 12.x).
- Node: `engines.node >= 18` (unchanged).
- Runtime deps: still zero. Pipeline is built entirely on Node stdlib.

## [0.3.0] — 2026-05-12

Phase C — creation primitives: keyframes and Ken Burns. Two new commands, zero
behavioral change to existing surface.

### Added
- `capcut-david add-keyframe <project> <id> <time> --property <p> --value <v> [--curve <c>]`
  — generic per-property keyframe insertion. Properties: `scale_x`, `scale_y`,
  `position_x`, `position_y`, `rotation`, `alpha`. Maintains sort order by
  `time_offset` in `segment.common_keyframes[*].keyframe_list`. A keyframe at
  an existing `time_offset` is replaced in place. Curves: `linear` (default),
  `ease-in`, `ease-out`, `ease-in-out`.
- `capcut-david ken-burns <project> <id> --from <scale> --to <scale> [--curve <c>]`
  — opinionated paired `KFTypeScaleX` + `KFTypeScaleY` keyframes from `t=0`
  to `t=segment.target_timerange.duration`. Wipes any existing scale_x /
  scale_y containers on the segment before writing (deterministic output).
  Default curve: `ease-out` (CapCut "Cubic Out" preset). Refuses to act on
  segments without a `clip` block (e.g. audio).
- `test/keyframe.test.mjs` — 33 new tests (134 total): 6-property happy
  paths, insertion ordering, replace-at-same-time, curve override profiles,
  Ken Burns parity against `ken-burns-draft.json` (handle ratios 0.32 /
  −0.4 against keyframe interval, tolerance ±0.001), 13 error paths
  (missing flags, invalid property, out-of-range alpha, time exceeds
  duration, invalid curve, audio segment, etc.).

### Changed
- `--help` adds a new `Keyframes:` section documenting both commands.
- `Flags` interface (`src/utils/cli.ts`) adds `property`, `value`, `curve`,
  `from`, `to` string fields. Additive — does not affect any existing
  command.

### Compatibility
- No schema change. Output JSON for `common_keyframes[*]` matches the shape
  in `test-fixtures/fixtures/ken-burns-draft.json` (container with
  `id`/`material_id`/`property_type`/`keyframe_list`, keyframe with
  `id`/`curveType`/`time_offset`/`left_control`/`right_control`/`values`/`string_value`/`graphID`).
- Curve handle ratios for `ease-out` are empirically backed by the shipped
  fixture (`0.32` and `-0.4`). `ease-in` and `ease-in-out` use CSS
  `cubic-bezier` interior handles (`0.42`); fixture verification of those
  presets is deferred to a future minor.
- Zero runtime dependencies preserved.

### Coverage
- Aggregate on `src/commands/*` + `src/draft.ts`: **93.70 % lines,
  91.67 % functions** (above the 80 % gate).
- `dist/commands/keyframe.js`: **97.86 % lines**.

## [0.2.0] — 2026-05-12

Stable release of the Phase B test suite. Identical content to `0.2.0-beta.0`; promoted to `latest` after beta soak verified the published tarball + CI gate behave as designed.

See [`0.2.0-beta.0`](#020-beta0--2026-05-12) below for the full change list.

## [0.2.0-beta.0] — 2026-05-12

First beta of the Phase B test suite. No behavioral change to any command — purely additive coverage.

### Added
- Fixture-backed `node:test` suite covering every existing command (102 tests total, replaces the 9-test Phase A smoke suite):
  - `test/create.test.mjs` — `init`, `add-video`, `add-audio`, `add-text` (14 tests).
  - `test/edit.test.mjs` — `set-text`, `shift`, `shift-all`, `speed`, `volume`, `opacity`, `trim` (22 tests).
  - `test/inspect.test.mjs` — `info`, `tracks`, `materials`, `segments`, `texts`, `export-srt`, `segment`, `material` (24 tests).
  - `test/template.test.mjs` — `save-template`, `apply-template` (10 tests).
  - `test/cut.test.mjs` — `cut` long-form → short (9 tests).
  - `test/batch.test.mjs` — JSONL stdin orchestration (11 tests).
- Shared test helpers under `test/helpers/`:
  - `load-fixture.mjs` — `FIXTURES` keys + `loadFixture(key)` (fresh parse per call).
  - `tmp-draft.mjs` — deep-clones a fixture into `os.tmpdir()`; cleans up via `t.after()` so tests run isolated.
  - `spawn-cli.mjs` — spawns the built `dist/index.js`, parses JSON stdout + JSON error on stderr.
- `npm run test:coverage` — runs `node --test --experimental-test-coverage` with `--test-coverage-lines=80 --test-coverage-functions=80` against `dist/commands/**/*.js` and `dist/draft.js`.
- CI: new `coverage` job (Node 22 / ubuntu-latest) wired into the `ci-pass` gate.

### Coverage
- Aggregate on `src/commands/*` + `src/draft.ts`: **93.03 % lines, 95.65 % functions** (well above the 80 % gate).
- Per file: batch 100 %, edit 100 %, cut 98.70 %, create 97.76 %, template 93.53 %, draft 89.66 %, inspect 80.41 %.

### Notes
- Test files are `.test.mjs` (not `.test.ts`) so the Node 18 cell in the CI matrix can execute them without a TypeScript stripper. Tests import the compiled CLI from `dist/...js`, mirroring the existing `smoke.test.mjs` pattern.
- Each test that mutates a draft gets a fresh tmp copy of the fixture; no test mutates the on-disk fixture corpus.

### Compatibility
- No behavioral or schema changes. Pure test addition.
- Same Node ≥ 18 / 3-OS support as 0.1.0.

## [0.1.0] — 2026-05-12

First release of the fork. Baseline = upstream `capcut-cli@0.2.2` (commit `c922338`) restructured into a modular layout. No behavioral change to any existing command.

### Added
- Fork attribution surface:
  - `NOTICE` file crediting Rene Zander (upstream) and cutcli inspiration.
  - `LICENSE` carries both copyright lines (Rene Zander + David Beles).
  - README banner naming the upstream and explaining when to use which.
  - `package.json` `contributors[]` field credits Rene Zander.
- Dev tooling:
  - **Biome 2** for lint + format (`npm run lint`, `npm run lint:fix`).
  - **TypeScript 5.6** typecheck step (`npm run typecheck`), separate from build.
  - `tsconfig.json` ships declaration files (`declaration: true`) for downstream type consumers.
- CI: GitHub Actions workflow (`.github/workflows/ci.yml`) runs lint + typecheck + 3-Node × 3-OS test matrix (Node 18/20/22 × Ubuntu/macOS/Windows) plus fixture-integrity validation.
- Test corpus: 9 anonymized CapCut draft fixtures under `test-fixtures/fixtures/` (minimal, ken-burns, effects, subtitles, full-psycho, animations, stickers, transitions, masks-filters) + `_final_integrity.py` cross-reference validator. All 9 pass clean.
- Phase A smoke tests in `test/smoke.test.mjs` (time-format parsing, srtTime formatting, binary --help, binary info on minimal fixture, binary error on unknown command). Phase B will expand to fixture-backed coverage on every command.
- npm package `bin`: single name `capcut-david` (upstream ships `capcut` + `capcut-cli`).

### Changed
- **Module layout** — split upstream's `src/factory.ts` + monolithic `src/index.ts` cmd functions into a typed module tree (no behavior change):
  - `src/index.ts` — CLI entry, argument parser, dispatch only.
  - `src/draft.ts` — preserved from upstream (Draft types + load/save/find helpers).
  - `src/utils/time.ts` — moved from `src/time.ts`.
  - `src/utils/cli.ts` — new shared `Flags` / `CliError` / `die` / `out` / `requireArgs`.
  - `src/utils/companion.ts` — extracted upstream's `createCompanionMaterials`, `registerCompanions`, `baseSegment`, `uuid`, `hexToRgb`.
  - `src/commands/create.ts` — `initDraft`, `addText`, `addAudio`, `addVideo` + CLI wrappers.
  - `src/commands/edit.ts` — `cmdSetText`, `cmdShift`, `cmdShiftAll`, `cmdSpeed`, `cmdVolume`, `cmdTrim`, `cmdOpacity`.
  - `src/commands/inspect.ts` — `cmdInfo`, `cmdTracks`, `cmdSegments`, `cmdTexts`, `cmdMaterials`, `cmdSegmentDetail`, `cmdMaterialDetail`, `cmdExportSrt`.
  - `src/commands/template.ts` — `saveTemplate`, `applyTemplate` + CLI wrappers.
  - `src/commands/cut.ts` — `cutProject` + CLI wrapper.
  - `src/commands/batch.ts` — `cmdBatch` + `execBatchOp`.
- Help text addresses the binary as `capcut-david` (was `capcut`).

### Fixed
- `batch` command now reads stdin via fd 0 instead of `/dev/stdin`, making the command portable to Windows (where `/dev/stdin` does not resolve). This is the only deliberate behavioral delta from upstream `0.2.2`.

### Removed (from upstream's tree, none from the runtime contract)
- `marketplace.json` and `.claude-plugin/` (we ship our own Claude Code skill in Phase E; not the upstream's plugin metadata).
- `hooks/` and `skills/capcut-edit/` (upstream's Claude Code plugin assembly; replaced in Phase E).
- `bin/capcut` (we expose only `bin: { "capcut-david": "dist/index.js" }`).
- `README.zh-CN.md` (not maintained on this fork).
- Upstream README's Gumroad CTAs and `utm_*` tracking parameters (per `UPSTREAM.md` §5; not a license requirement, but a courtesy not to piggyback on upstream's marketing funnel).

### Synced from upstream
- Initial baseline: upstream commit `c922338` (v0.2.2, 2026-05-07). Future syncs land via the `upstream-sync` branch per [`UPSTREAM.md`](../UPSTREAM.md) §2.

### Compatibility
- Tested against CapCut 8.x desktop on Windows + macOS (per `COMPATIBILITY.md` §1).
- Node ≥ 18; CI matrix covers Node 18, 20, 22.
- JianYing 6+ remains unsupported (encrypted `draft_content.json` — see `COMPATIBILITY.md` §5).

[Unreleased]: https://github.com/Davidb-2107/capcut-cli-david/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Davidb-2107/capcut-cli-david/compare/v1.0.0-rc.1...v1.0.0
[1.0.0-rc.1]: https://github.com/Davidb-2107/capcut-cli-david/compare/v0.5.0...v1.0.0-rc.1
[0.5.0]: https://github.com/Davidb-2107/capcut-cli-david/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/Davidb-2107/capcut-cli-david/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/Davidb-2107/capcut-cli-david/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Davidb-2107/capcut-cli-david/releases/tag/v0.2.0
[0.2.0-beta.0]: https://github.com/Davidb-2107/capcut-cli-david/releases/tag/v0.2.0-beta.0
[0.1.0]: https://github.com/Davidb-2107/capcut-cli-david/releases/tag/v0.1.0
