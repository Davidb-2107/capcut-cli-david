# Changelog

All notable changes to `capcut-cli-david` are documented here.
Format follows [Keep a Changelog 1.1](https://keepachangelog.com/en/1.1.0/);
this project adheres to [SemVer 2.0.0](https://semver.org/spec/v2.0.0.html).
Fork-specific sub-sections (*Synced from upstream*, *Compatibility*) are added
per [`RELEASE.md`](../RELEASE.md) §4.

## [Unreleased]

### Planned
- `0.3.x` — Ken Burns + keyframe commands (Phase C)

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

[Unreleased]: https://github.com/Davidb-2107/capcut-cli-david/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Davidb-2107/capcut-cli-david/releases/tag/v0.2.0
[0.2.0-beta.0]: https://github.com/Davidb-2107/capcut-cli-david/releases/tag/v0.2.0-beta.0
[0.1.0]: https://github.com/Davidb-2107/capcut-cli-david/releases/tag/v0.1.0
