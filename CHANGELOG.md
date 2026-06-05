# Changelog

All notable changes to `capcut-cli-david` are documented here.
Format follows [Keep a Changelog 1.1](https://keepachangelog.com/en/1.1.0/);
this project adheres to [SemVer 2.0.0](https://semver.org/spec/v2.0.0.html).
Fork-specific sub-sections (*Synced from upstream*, *Compatibility*) are added
per [`RELEASE.md`](./RELEASE.md) §4.

## [Unreleased]

### Planned
- `1.x` — see [`release-notes/1.0.0.md`](./release-notes/1.0.0.md) §Roadmap for the non-binding 1.x backlog.

## [1.8.0] — 2026-06-05

Minor release. New `validate` command — a strictly read-only linter that detects draft corruption and broken invariants **before** you open CapCut. It is the diagnostic backbone the future fix verbs (`--fix`, `gc`, `sync-timelines`, `relink`) will graft onto: every detector is a pure, exported `CHECKS` function emitting a stable finding schema (`id` / `severity` / `fixable` / `fix_hint`).

### Added
- **`validate <project>`** — runs a battery of checks over `draft_content.json` and prints a versioned JSON report (`schema: "capcut-david/validate@1"`) or, with `-H`, a human table grouped by severity. **Never writes a byte** (no `saveDraft`, no `.bak`, no `mkdir` — locked by a byte-identity test) and is deliberately **not** in `WRITE_COMMANDS`, so it runs fine while CapCut is open. Each detector is wrapped so a throw degrades into a diagnostic rather than crashing the run; an unparseable draft is a single clean `{"error":…}` (exit 1).
  - **Exit codes:** `0` = ran clean (or only info/warnings without `--strict`), `2` = `error` findings present (or warnings under `--strict`), `1` = tool failure (bad args / project not found / unreadable JSON). So *finding problems* never collapses to a tool error.
  - **Checks (always-on, CI-safe — pure graph):** `materials.dangling_ref` (error; resolves `segment.material_id` against an **exact** id Set, never the prefix-matching `findMaterialGlobal`), `materials.duplicate_id` (error; global across all ~54 material slots), `companions.missing` (warning; each *present* `extra_material_refs` entry must resolve — the slot bundle is polymorphic/positional), `segments.zero_duration` (error on video/audio/text tracks, warning elsewhere), `duration.underrun` (warning) / `duration.overrun` (info) with a µs epsilon, `segments.overlap` (warning; video/audio only — text/effect/overlay stack legitimately), `materials.orphan_text` / `materials.orphan_media` (info; scoped to the typed slots so per-segment companions never cry wolf — and the leftovers `import-captions`/`restyle` create by design stay info), `canvas.config_sanity` (warning; `fps` is read at the draft root).
  - **Checks (filesystem):** `meta.missing` (error), `meta.unregistered` (warning), `meta.duplicate_draft_id` (warning) run automatically when a **directory** is passed (a bare `draft_content.json` file → these report *skipped*, never error); they read `root_meta_info.json` from `--projects-root` or `defaultProjectsRoot()` and degrade quietly if it is absent. `assets.missing_file` (`--check-assets`) and `timelines.divergence` (`--check-timelines`, a cheap duration/segment-count signal — never a deep-equal) are **opt-in**.
  - **Flags:** `-H/--human`, `-q/--quiet` (exit code only — CI gate), `--strict`, `--id <id>` / `--skip <id>` (repeatable), `--check-assets`, `--check-timelines`, `--projects-root <dir>`.

### Notes
- `effect.bind_dangling` is intentionally **not** in the MVP: video FX bind via `material_id` on an `effect` track while a filter material's `bind_segment_id` is legitimately empty (`""` = track-wide); shipping it without handling both routing modes would cry wolf. It returns to a later minor once the fix verbs need it.
- No existing command changes behavior. `validate` adds 52 tests (331 total); `validate.js` coverage is 97.6% lines / 100% functions.

### Compatibility
- CapCut ≥ 5.x desktop (Windows + macOS) — unchanged. Node `>= 18` — unchanged. Runtime dependencies: zero — unchanged.

## [1.7.0] — 2026-06-05

Minor release. Hardens the engine against the two most expensive CLI footguns documented in the CapCut skills: absolute source paths breaking on Windows, and writing a draft while CapCut is open (silent loss to CapCut's on-close overwrite).

### Fixed
- **Absolute source paths on Windows.** `add-audio` / `add-video` resolved paths with `path.startsWith("/")`, which on Windows misclassifies an absolute path (`C:\…` / `C:/…`) as relative and joins it onto the cwd → `ENOENT` (or the asset silently not copied into `assets/`). Now uses `path.resolve()` (correct on Windows + POSIX) for the source, and `path.basename()` (was `split("/").pop()`, which returns the whole string for a backslash path) for the asset filename. A relative input that already worked produces a **byte-identical** draft (locked by test); an absolute input that previously failed now copies the source into `<draft>/assets/<type>/` and references it there.

### Added
- **"CapCut is open" preflight guard.** Every draft-writing command (`add-*`, `set-text`, `shift`/`shift-all`, `speed`, `volume`, `trim`, `opacity`, `import-captions`, `restyle`, `add-keyframe`, `ken-burns`, `apply-template`, `batch`, `cut`, `psycho-build`, `register`) now refuses to run while CapCut is detected running, with a clear error (`CapCut is running — close it before writing (or pass --force)`). CapCut holds `draft_content.json` / `root_meta_info.json` in memory and rewrites them on close, silently discarding CLI edits — this is gotcha #1 in every CapCut skill and Iron Law #4 of the build pipeline. Detection: `tasklist` (Windows) / `pgrep` (macOS/Linux); **fail-open** — if the probe is absent or finds nothing (e.g. CI), the command proceeds. Read-only commands and `init` (creates a brand-new draft) are not guarded.
- `--force` flag (and `CAPCUT_DAVID_FORCE` env var) to bypass the guard for automation.

### Notes
- The guard runs one process-list probe per write command (~tens of ms); library functions (`addText`, `importCaptions`, `applyCaptionStyle`, …) are never touched, so programmatic/batched use is unaffected.
- `add-text` / `import-captions` / `restyle` output is unchanged — no new behavior on existing paths beyond the absolute-path fix.

### Compatibility
- CapCut ≥ 5.x desktop (Windows + macOS) — unchanged. Node `>= 18` — unchanged. Runtime dependencies: zero — unchanged.
- 279 tracked tests pass (265 prior + 3 absolute-path + 11 guard). The absolute-path fix's Windows regression value is host-OS-specific (POSIX absolute paths already started with `/`); it was watched fail→pass on Windows.

## [1.6.0] — 2026-06-05

Minor release. New `restyle` command ports the CapCut-CaptionStyling font-mirroring patchers (`restyle.py` + `fix_fonts_full.py` + `fix_content_styles_font.py` + `fix_key_value.py`) into the engine, so that skill becomes pure orchestration. It applies a caption style preset (font / stroke / shadow / size) to every caption, **span-aware**: multi-span keyword-highlight captions keep each span's color + range while the font / stroke / shadow change on all spans (the inverse of `--clone-style`).

### Added
- `restyle <project> --preset <preset.json> [--track-name <name>]` — apply a caption style preset to every caption on the target text track(s) (default: **all** text tracks; `--track-name` scopes to one). Reuses the `preset_captions_style.json` schema (`text_material` + `content_template` + `segment`). Each span keeps its `fill` (keyword color) + `range`; `font` / `strokes` / `shadows` / `size` / `bold` come from the preset. Material-level font fields are grafted (`font_path`, `font_resource_id`, `fonts[]` with empty `request_id`, `has_shadow`, `shadow_*`, `border_*`); `recognize_task_id` is cleared (else CapCut Auto-Captions regenerate and wipe the style); `base_content` / `recognize_text` are preserved (not blanked from the preset).
- Sidecar font-mirroring — writes the new draft to `template-2.tmp` + `draft_content.json.bak`, forces `content.styles[].font.{path,id}` inside `Timelines/*/mini_draft.json` + `patch.json`, and injects the `key_value.json` registry entry keyed by `resource_id`. All targets are skip-if-absent; `key_value.json` is never fabricated.

### Changed
- `register` now stamps a fresh `tm_draft_modified` on the add path, so a cloned or engine-generated draft surfaces at the **top** of CapCut's grid instead of inheriting a stale timestamp that buries it at the bottom (present in the index but effectively invisible).

### Notes
- Single-span lean captions (legacy `add-text` UTF-16 byte-length range) are promoted to code-unit ranges on restyle, matching CapCut's rich-text convention.
- Restyle scopes to materials **reachable from text-track segments**, so orphaned text materials left by `import-captions` are never touched.
- `restyle` is a new, separate code path — `add-text` / `import-captions` output stays byte-identical (locked by test). The font dropdown showing "System" for a correctly-rendered preset font is a pre-existing CapCut cosmetic quirk, not a regression.

### Compatibility
- CapCut ≥ 5.x desktop (Windows + macOS) — unchanged. Node `>= 18` — unchanged. Runtime dependencies: zero — unchanged.
- 265 tracked tests pass (241 prior + restyle / mirror / register). Restyle output validated against a live CapCut render (CC-DerStil preset on a multi-span keyword caption — per-word colors survive the font change).

## [1.5.0] — 2026-06-04

Minor release. `import-captions --clone-style` preserves the existing caption look (font / strokes / shadows / size) from the target track when injecting keyword-highlight captions — font-agnostic, so any font the user set in CapCut (even one not in any preset library) survives, with the highlight color laid on top. This is the last piece needed to fully replace the standalone `inject_word_captions.py` patcher (which cloned the draft's caption style via template copy).

### Added
- `import-captions … --clone-style` — before replacing the target track, photocopy the style block (`font`, `strokes`, `shadows`, `size`, `bold`, …) of that track's first existing caption and apply it to every new caption, overriding only `range` + `fill` (solid highlight color). The template material is deep-cloned so material-level fields (`text_color`, `border_*`, `shadow_*`, `line_spacing`, …) are preserved too. In clone mode every card is rich-text (parity with the patcher). Opt-in — default behavior is unchanged from 1.4.0.
- `buildRichTextContent(text, fontSize, baseColor, highlights, baseStyle?)` — optional `baseStyle` param; when provided each span is a deep copy of it with `range` + solid `fill` overridden. Without it, the lean default span shape is byte-for-byte unchanged (locked by test).

### Changed
- `import-captions` without `--track-name` now targets the **first existing text track** (was: a track literally named `text`). CapCut caption tracks are usually unnamed, so the old default created a stray second track and clone had nothing to read. `add-text` is unaffected; `add-text`/`import-captions` content output is otherwise identical to 1.4.0.

### Notes
- `--clone-style` clones from the target track (`--track-name` if given, else the first text track). If that track is empty / its content can't be parsed, it falls back to the default style with a stderr warning — never an error.

### Compatibility
- CapCut ≥ 5.x desktop (Windows + macOS) — unchanged. Node `>= 18` — unchanged. Runtime dependencies: zero — unchanged.
- 241 tracked tests pass (235 prior + 6 clone-style). Clone output validated against a live CapCut render with a deliberately non-preset font.

## [1.4.0] — 2026-06-04

Minor release. Makes keyword highlight (per-word caption color) a first-class engine feature, replacing the standalone Python `inject_word_captions.py` patcher. CapCut multi-span rich-text is now produced natively, with colors emitted as float32 (`Math.fround`) to match CapCut's internal encoding and `range` offsets in UTF-16 code units.

### Added
- `add-text … --keyword <word> | --keyword-range <s,e> [--keyword-color <hex>]` — color one keyword inside a caption. `--keyword` matches the first substring occurrence (UTF-16 code-unit offsets via native `String.indexOf`/`.length`); `--keyword-range` takes explicit `start,end` offsets and takes precedence. Default color `#FFD600`. A keyword that is not found (or an out-of-bounds range) is a hard error — never a silent no-op.
- `import-captions <project> <captions.json> [--highlight-color <hex>] [--track-name <name>]` — batch word/keyword captions from `[{text,start,end,hl?:[s,e],color?}]`. Replaces the named text track's segments 1:1 with the patcher, leaves prior text materials orphaned (unreferenced ⇒ invisible ⇒ zero deletion risk), supports per-card `color` (falls back to `--highlight-color`), and extends `draft.duration` to the last caption end.
- `buildRichTextContent()` — shared core that emits N contiguous, non-overlapping CapCut style spans covering `[0, text.length]` in UTF-16 code units (gaps = base color, ranges = highlight color), `is_rich_text: true` on multi-span materials.

### Changed
- `add-text` / `import-captions` share `buildTextMaterial()`. The single-span `buildTextContent` path is **unchanged** — `add-text` without a keyword flag is byte-identical to v1.3.0 (single span, UTF-16 *byte* range, no `is_rich_text`). Locked by test.

### Fixed
- `set-text` and `apply-template` now **refuse** to mutate a multi-span (keyword-highlight) caption instead of silently corrupting it (they only re-ranged `styles[0]`, desyncing the remaining keyword spans). Clear error directs the user to rebuild via `add-text --keyword` / `import-captions`.
- `test-fixtures/fixtures/animations-draft.json` keyword-highlight oracle: restored the real caption text `"THE EYES ARE WATCHING ME."` (the LOREM anonymizer had replaced it at approximate length while leaving the style ranges, desyncing range↔text). Documented the policy exception in the fixtures README.

### Compatibility
- CapCut ≥ 5.x desktop (Windows + macOS) — unchanged. Node `>= 18` — unchanged. Runtime dependencies: zero — unchanged.
- 234 tracked tests pass (208 prior + 26 keyword-highlight). Highlight output validated against a live CapCut render.

## [1.3.0] — 2026-05-20

Minor release. Extends the CapCut "Cubic Out" Δ-scaling fix (shipped in v1.2.0 for `cmdKenBurns`) to the incremental path `cmdAddKeyframe`. Both code paths now converge on a single shared segment model (`computeSegmentHandles`).

### Fixed
- `cmdAddKeyframe` ease-out wrote `start.right_control.y = -0.47` fixed regardless of Δvalue at the inserted kf — now `round(0.94 × Δvalue, 6)`, coherent with the CapCut "Cubic Out" preset and the `cmdKenBurns` fix shipped in v1.2.0.
- `cmdAddKeyframe` did not retro-compute neighbor handles when inserting between two existing kfs — `prev.right_control` and `next.left_control` stayed pinned to obsolete intervals. Now both neighbors are retro-updated: `prev.right` (x AND y), `next.left` (x — y stays 0 for all supported curves).

### Changed
- `cmdAddKeyframe` output:
  - sequence (`add t=0, val=A, ease-out` + `add t=T, val=B, ease-out`) now produces byte-identical output to `cmdKenBurns(A, B, ease-out)` on the `scale_x` container;
  - insertion between 2 existing kfs now modifies the neighbors as well (cf. Fixed);
  - solitary kf (neither prev nor next) — both `left_control` AND `right_control` are `{x: 0, y: 0}` (previously `right` carried a "phantom" handle without a destination: `{round(0.32 × segDuration), -0.47}`);
  - replace of a kf at the same `timeOffset` now retro-updates neighbors using the new `value` (so the new Δ propagates).
- The curve specified to `cmdAddKeyframe` now applies to **both adjacent segments** (`prev→new` and `new→next`) — i.e., it overwrites the handles of `prev.right` and `next.left` at insertion. Semantics aligned with CapCut UI where changing a kf's curve affects both surrounding segments.
- `CURVE_PROFILES["ease-out"].startRightY`: `-0.47` → `0` (internal cleanup; this field is no longer consumed — the real value comes from the `curve === "ease-out"` gate via `KEN_BURNS_CUBIC_OUT_RIGHT_Y_RATIO`).

### Compatibility
- CapCut ≥ 5.x desktop (Windows + macOS), JianYing 6+ unsupported — unchanged.
- Node `>= 18` — unchanged.
- Runtime dependencies: zero — unchanged.
- New tests targeting `cmdAddKeyframe` oracle parity, behavioral coverage, and captured-CapCut-UI byte-identity (208 tracked tests). All tracked tests pass. The new byte-identity oracle (`test-fixtures/oracles/cubic-out-triplet-frame-aligned.json`) locks a formal contract vs CapCut UI: x byte-identical on frame-aligned intervals, ±1μs on non-aligned, ±1e-9 (~1 ULP) on y.
- `draft_content.json` output for `add-keyframe --curve ease-out` is **not** byte-identical to 1.2.0 when `Δ ≠ -0.5` (intended correctness fix). `ken-burns` output is byte-identical to 1.2.0.

## [1.2.0] — 2026-05-19

Minor release. Corrects a latent easing bug in `ken-burns`: the start keyframe's outgoing Bezier handle `y` was a fixed absolute (`-0.47`) regardless of the zoom range, so easing was wrong for every range except exactly `to − from = -0.5`. **Not** byte-identical for `Δ ≠ -0.5` (hence minor, not patch) — see **Changed**.

### Fixed
- **`ken-burns` ease-out easing** — `cmdKenBurns` wrote `start.right_control.y = -0.47` (the `CURVE_PROFILES["ease-out"]` fixed value) for every zoom, ignoring the value delta. CapCut's "Cubic Out" preset encodes `start.right_control.y = round(0.94 × (toVal − fromVal), 6)`; the `-0.47` was only the `Δ = -0.5` special case (a `1.5 → 1.0` zoom). A zoom-in `1.0 → 1.12` (`Δ = +0.12`) was getting `-0.47` instead of `0.1128` — a grossly wrong curve. Fix: `cmdKenBurns` now derives `y` from `0.94 × Δ` for `ease-out` (other curves keep their profile `y`, all `0`). Validated against the real-capture ground truth (`CapCut-ZoomFX/Tools/tests/fixtures/cubic-out-groundtruth.json`) and the cutcli-fix parity model. The incremental `add-keyframe` / `computeControlPoints` path is intentionally **not** changed (no proven ground truth there) — see release note backlog.

### Changed
- `ken-burns` draft output: `start.right_control.y` now varies with the zoom delta (`round(0.94 × (to − from), 6)`). Output is byte-identical to 1.1.1 **only** when `to − from = -0.5` (e.g. `1.5 → 1.0`); for any other range the value changes (from the previously-wrong `-0.47` to the correct Δ-scaled value). `start.right_control.x`, `end.left_control`, the `x` ratios, and all non-`ease-out` curves are unchanged. `cmdAddKeyframe` output is byte-identical.

### Compatibility
- CapCut ≥ 5.x desktop (Windows + macOS), JianYing 6+ unsupported — unchanged.
- Node `>= 18` — unchanged.
- Runtime dependencies: zero — unchanged.
- 3 new tests (199 tracked tests). All tracked tests pass (the pre-existing `cmdKenBurns: curve override changes control points` assertion was corrected from `-0.47` to `0.47` — it had encoded the bug). Aggregate coverage stays above the 80% gate.
- `draft_content.json` output is **not** byte-identical to 1.1.1 for `ken-burns` with `to − from ≠ -0.5` (intended correctness fix; see **Changed**).

## [1.1.1] — 2026-05-17

Patch fixing Bug #3, found during end-to-end verification of 1.1.0: the standalone `register` command failed on copied or moved drafts. Additive bugfix — no breaking changes, `draft_content.json` output byte-identical.

### Fixed
- **Bug #3** — `capcut-david register <dir>` trusted the target's `draft_meta_info.json` for `draft_name` / `draft_fold_path` instead of re-deriving them from the directory argument. A draft generated at path A then copied to CapCut path B kept A's name and path, so the `root_meta_info.json` entry pointed at the wrong location and CapCut couldn't open it. Dedup was also keyed on `draft_id`; a `cp -r` keeps the same id, so `register` returned `{"added": false}` and indexed nothing. Fix: `register` now derives `draft_name` from `basename(<dir>)` and `draft_fold_path` from the resolved absolute `<dir>`, rewrites the sidecar to match, regenerates a fresh `draft_id` when it collides with a *different* folder, and dedups on `draft_fold_path`. The `psycho-build --out <dir> --register` one-shot is unaffected (verified — it already writes a correct `--out`-derived sidecar before registering).

### Changed
- `register` idempotency key changed from `draft_id` to `draft_fold_path` (supersedes the "Idempotent on `draft_id`" note in [1.1.0]). Re-registering the same directory is still a no-op (`added: false`); registering a different directory that carries a duplicate `draft_id` now succeeds with a freshly generated id instead of being silently skipped. `register` also rewrites the target's `draft_meta_info.json` (`draft_name` / `draft_fold_path` / `draft_id`) so the sidecar stays consistent with the draft's on-disk location.

## [1.1.0] — 2026-05-17

First minor after 1.0 graduation. Closes the two post-1.0 bugs filed against the published surface: `psycho-build` drafts now appear in CapCut's UI (Bug #1), and `init` works out-of-the-box without `--template` (Bug #2). Additive only — no breaking changes.

### Added
- `capcut-david register <draft-dir> [--projects-root <dir>]` — append a built draft to CapCut's `<projects-root>/root_meta_info.json` `.all_draft_store[]` so it surfaces in the CapCut UI. Idempotent on `draft_id`. Cross-platform default projects-root (Win: `%LOCALAPPDATA%/CapCut/User Data/Projects/com.lveditor.draft`; macOS: `~/Movies/CapCut/User Data/Projects/com.lveditor.draft`; Linux best-effort under `~/.local/share/CapCut/...`).
- `--register` flag on `psycho-build` — when passed, runs the equivalent of `register <draft-dir>` after emitting the draft. `--projects-root <dir>` overrides the default.
- `psycho-build` now also emits **`draft_meta_info.json`** and **`draft_info.json`** alongside `draft_content.json`. These are the two CapCut sidecar files required for the draft to be indexed; without them the draft existed on disk but was invisible in the CapCut UI.
- `src/utils/capcut-paths.ts` — shared helpers `resolveTemplateDir()`, `defaultProjectsRoot()`, `nowUs()`. Replaces the per-module template-path resolution previously duplicated in `pipeline.ts` and shipped broken in `create.ts:cmdInit`.

### Fixed
- **Bug #1** — `psycho-build` produced drafts that were invisible in CapCut's UI. The output directory contained `draft_content.json` + `assets/` but was missing `draft_meta_info.json` + `draft_info.json`, and no entry was created in `root_meta_info.json`. Fix: `psycho-build` now always emits the two sidecar metadata files; the `--register` flag handles the root-meta indexing.
- **Bug #2** — `capcut-david init` (with no `--template` flag) tried to copy `../CapCutAPI/template`, a path inherited from the upstream Python project that never existed in this fork's distribution. Fix: default template now resolves to the bundled `templates/minimal/` via `resolveTemplateDir()`. Default `--drafts` also became cross-platform (was hard-coded to macOS `~/Movies/CapCut/...`).

### Changed
- `PsychoBuildResult` interface (`src/commands/pipeline.ts`) is additive: new fields `metaInfoPath`, `draftInfoPath`, `registered`, `registerRootMetaPath`. CLI output for `psycho-build` likewise gains `meta_info_path`, `draft_info_path`, `registered`, `register_root_meta_path`.
- `Flags` interface (`src/utils/cli.ts`) gains `register?: boolean` and `projectsRoot?: string`.
- `package.json` — `version` → `1.1.0`. `files`, `bin`, `engines`, deps unchanged.

### Compatibility
- CapCut: same as 1.0.0 (≥ 5.x desktop on Windows + macOS).
- JianYing 6+: unsupported (encrypted draft) — unchanged from 1.0.0.
- Node: `engines.node >= 18` (unchanged).
- Runtime deps: zero (unchanged).
- 21 new tests (194 total, up from 173). Aggregate coverage on `src/commands/*` + `src/draft.ts` remains above the 80% gate.
- All existing CLI commands and on-disk draft shapes are byte-identical to 1.0.0. `draft_content.json` output is unchanged.

## [1.0.0] — 2026-05-12

**Stable release.** Full SemVer 2.0.0 guarantees per [`RELEASE.md`](./RELEASE.md) §1 now in effect. **Code-identical to `0.5.0` and `1.0.0-rc.1`** — what changes is the contract.

### Highlights
- The fork graduates after 5 implementation phases (A → E):
  - `0.1.0` — fork from `renezander030/capcut-cli`, modular `src/` (Phase A)
  - `0.2.0` — fixture-backed `node:test` harness, ≥80% coverage, full CI matrix (Phase B)
  - `0.3.0` — creation primitives `add-keyframe` and `ken-burns` (Phase C)
  - `0.4.0` — `psycho-build` YAML manifest pipeline (Phase D)
  - `0.5.0` — packaging consolidation: bundled `capcut-david` skill, in-repo schema docs, README rewrite (Phase E)
- 27 CLI commands across 6 families. 173 tests, ≥80% coverage. 3000+ lines of in-repo schema reference. Zero runtime deps. Tarball ~110 kB / 52 files.

### Migration from 0.x
- Pinned to `0.4.0` or `0.5.0` → `1.0.0`: no change. CLI surface byte-identical between `0.5.0`, `1.0.0-rc.1`, `1.0.0`. Just bump the pin.
- Pinned to `0.1.0–0.3.0`: surface is additive across `0.x`; nothing was removed. Review use of inspect family (added `0.1.0`) and creation primitives (added `0.3.0`).
- `cut-*` Claude skills users (`cut-audio`, `cut-draft`, `cut-motion`, `cut-storyboard`, `cut-tiktok`): deprecated since `2026-05-12` with `deprecated: true` frontmatter + redirect callouts pointing at the bundled `capcut-david` skill. Install the new skill from `$(npm root -g)/capcut-cli-david/skills/capcut-david/`.

### Changed
- `package.json` — `version` → `1.0.0`. Dist-tag `latest` advances to `1.0.0` (was `0.4.0`).
- `release-notes/1.0.0.md` — finalised from placeholder to the published GitHub release body (Highlights / Migration / Roadmap / Thanks).

### Deprecated and removed
- The 5 legacy `cut-*` Claude skills are deprecated. Migrate to the unified `capcut-david` skill bundled in this package.
- Removed nothing else. The full `0.x` CLI surface is preserved.

### Compatibility
- CapCut: ≥ 5.x desktop (Windows + macOS); both `cutcli`-shape (`new_version: 167.x`) and CapCut-UI shape (`169.x`) supported.
- JianYing 6+: unsupported (encrypted draft) — see [`COMPATIBILITY.md`](./COMPATIBILITY.md) §5.
- Node: `engines.node >= 18`.
- Runtime deps: zero (Node stdlib only).

### Roadmap (1.x — non-binding)
- `1.x.0` — `capcut-david query` (animation / sticker / effect / filter catalogue lookup; recipe-referenced)
- `1.x.0` — `capcut-david validate <project>` (schema-invariant linter)
- `1.x.0` — JianYing 6+ research; `psycho-build` dynamic audio ducking

## [1.0.0-rc.1] — 2026-05-12

Release candidate for `1.0.0`. **No CLI / API / schema changes vs `0.5.0`.** Code is identical; this tag is the dress rehearsal for the SemVer 2.0.0 contract taking effect at `1.0.0` per [`RELEASE.md`](./RELEASE.md) §1.

### Changed
- `package.json` — `version` → `1.0.0-rc.1`. Published with `--tag next`.

### Cutover (orchestrator-side, outside the npm package)
- The 5 legacy `cut-*` Claude skills (`cut-audio`, `cut-draft`, `cut-motion`, `cut-storyboard`, `cut-tiktok`, in the upstream wiki vault) carry `deprecated: true` frontmatter + a redirect callout pointing at the bundled `capcut-david` skill — applied 2026-05-12.
- `Wiki_Claude/SKILLS MAP.md` lists `capcut-david` and the five deprecated `cut-*` entries with their migration targets.
- Pre-release audit (Explore sub-agent) — verdict **SHIP**: 7/7 Phase E criteria PASS, cross-links resolve, package.json `files` array complete, no v0.1.0 stragglers in repo content.

### Soak checklist (self-validation against this RC)
- [x] `npm view capcut-cli-david@1.0.0-rc.1` returns `1.0.0-rc.1`; dist-tag `next` advances to it
- [x] `capcut-david --help` prints all command families (Overview / Browse / Detail / Create / Edit / Animate / Pipeline)
- [x] `capcut-david psycho-build examples/psycho/manifest.example.yaml --out /tmp/test --seed 42` succeeds end-to-end
- [x] Skill loads in Claude Code from `~/.claude/skills/capcut-david/` (copied from `$(npm root -g)/capcut-cli-david/skills/capcut-david/`)
- [x] All 7 `docs/draft-schema/` files render on GitHub at `v1.0.0-rc.1`
- [x] Tarball contains `skills/`, `docs/`, `release-notes/`, `templates/`, `dist/`, the 7 root meta-docs (`README/CHANGELOG/LICENSE/NOTICE/COMPATIBILITY/UPSTREAM/RELEASE.md`)
- [x] CI matrix green on commit (13/13 jobs: Node 18/20/22 × Ubuntu/macOS/Windows + Lint+Typecheck + Coverage + Fixture integrity + CI Pass)

If every box stays checked through the soak window, promote to `1.0.0` per [`RELEASE.md`](./RELEASE.md) §1 (`--tag latest`). Otherwise bump to `1.0.0-rc.N+1`.

### Compatibility
- Unchanged from `0.5.0`. CapCut ≥ 5.x desktop. JianYing 6+ unsupported. Node ≥ 18. Runtime deps: zero.

## [0.5.0] — 2026-05-12

Phase E packaging consolidation — graduation prep. **No new commands** (feature-frozen per Phase E constraints). The fork ships its own Claude Code skill bundle and an in-repo CapCut draft-schema reference, in service of the imminent `1.0.0` graduation.

### Added
- `skills/capcut-david/SKILL.md` — unified Claude Code skill that supersedes `cut-draft`, `cut-storyboard`, `cut-motion`, `cut-audio`, and `cut-tiktok` (the 5 legacy `cut-*` skills). Bundled with the npm package under `skills/`.
- `skills/capcut-david/references/recipes-{motion,audio,tiktok,storyboard}.md` — full recipes migrated and consolidated from the 5 source skills, normalised against the `capcut-david` command surface.
- `docs/draft-schema/` (7 files, ~3000 lines) — in-repo reverse-engineered reference for CapCut's `draft_content.json` schema: overview, tracks/segments, materials, keyframes & animations, effects/filters/stickers, and version differences.
- `docs/README.md` — thin docs index pointing at `draft-schema/` and the existing top-level docs (`RELEASE.md`, `UPSTREAM.md`, `COMPATIBILITY.md`).
- `release-notes/` — per-version GitHub release-notes drafts (this directory). Each release tag pulls its body from the matching file.
- `COMPATIBILITY.md`, `UPSTREAM.md`, `RELEASE.md` — meta-docs moved from the upstream planning vault into the repo root so README + CHANGELOG cross-links resolve on GitHub and in the npm tarball.

### Changed
- `README.md` — full rewrite: tagline + comparison table (vs upstream `cutcli` and `capcut-cli`) + Quickstart + command index + pointers to `skills/capcut-david/SKILL.md` and `docs/draft-schema/`.
- `package.json` — `version` → `0.5.0`. `files` array extended to ship `skills/`, `docs/`, `release-notes/`, `CHANGELOG.md`, `COMPATIBILITY.md`, `UPSTREAM.md`, `RELEASE.md` with the npm package alongside the existing `dist/`, `templates/`, `README.md`, `LICENSE`, `NOTICE`.

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
- Initial baseline: upstream commit `c922338` (v0.2.2, 2026-05-07). Future syncs land via the `upstream-sync` branch per [`UPSTREAM.md`](./UPSTREAM.md) §2.

### Compatibility
- Tested against CapCut 8.x desktop on Windows + macOS (per `COMPATIBILITY.md` §1).
- Node ≥ 18; CI matrix covers Node 18, 20, 22.
- JianYing 6+ remains unsupported (encrypted `draft_content.json` — see `COMPATIBILITY.md` §5).

[Unreleased]: https://github.com/Davidb-2107/capcut-cli-david/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/Davidb-2107/capcut-cli-david/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/Davidb-2107/capcut-cli-david/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/Davidb-2107/capcut-cli-david/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Davidb-2107/capcut-cli-david/compare/v1.0.0-rc.1...v1.0.0
[1.0.0-rc.1]: https://github.com/Davidb-2107/capcut-cli-david/compare/v0.5.0...v1.0.0-rc.1
[0.5.0]: https://github.com/Davidb-2107/capcut-cli-david/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/Davidb-2107/capcut-cli-david/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/Davidb-2107/capcut-cli-david/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Davidb-2107/capcut-cli-david/releases/tag/v0.2.0
[0.2.0-beta.0]: https://github.com/Davidb-2107/capcut-cli-david/releases/tag/v0.2.0-beta.0
[0.1.0]: https://github.com/Davidb-2107/capcut-cli-david/releases/tag/v0.1.0
