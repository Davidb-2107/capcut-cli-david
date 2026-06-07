# `make-preset` — generate a restyle preset for a font (design)

**Date:** 2026-06-07
**Status:** approved (design), pending implementation plan
**Author:** Claude (with David)
**Tracking:** follow-on to S1649 (#8 root-cause) — turns the font-discovery findings into a reusable engine verb.

## 1. Purpose

Today, applying a font to captions via `restyle` requires a hand-crafted preset JSON
(`Tools/preset_captions_style.json`-shaped). Building one by hand means digging the
font's `resource_id`, `.ttf` path, and catalogue `title` out of CapCut internals — the
exact pain the S1649 #8 investigation mapped.

`make-preset` is a new **read-only generation verb** for the `capcut-cli-david` engine.
Given a font name, it produces a ready-to-use **bare-font** restyle preset by reading
the font's complete metadata from the CapCut drafts library — the generation cousin of
`query` (v1.13.0). The output feeds directly into `restyle --preset`.

This keeps every capability inside the engine pipeline (validate → sync-timelines → gc
→ init-meta → validate --fix → query → make-preset), consistent with the v1.7→v1.13
trajectory. No external Python tool.

## 2. Non-goals (YAGNI)

- **No styling.** "Bare font" only — the preset carries font identity, never
  stroke/shadow/size/bold decoration. (A future `--template <preset.json>` to clone a
  style is explicitly out of scope here.)
- **No CapCut cache / SQLite reading.** The engine stays zero-runtime-dependency. We do
  NOT read `Cache/ressdk_db/*/rp.db` or `Cache/effect/`. (Rationale in §7.)
- **No font installation / download.** The font must already be applied in a draft (the
  natural precondition — see §7).
- **No writing into drafts.** `make-preset` is read-only over the library; it only emits
  a preset (stdout or `--out`).

## 3. CLI

```
capcut-david make-preset --font <name|resource_id> [--out <file>] [--drafts <dir>] [--human]
```

- `--font <name|resource_id>` (required): case-insensitive **substring** match on the
  font's catalogue title; if the value is **purely numeric**, it is matched as an exact
  `resource_id` instead.
- `--out <file>` (optional): write the bare preset JSON to `<file>` (ready for
  `restyle --preset <file>`). When omitted, the preset is included in the stdout
  envelope under `preset` and NOT written to disk.
- `--drafts <dir>` (optional): override the drafts library root (default
  `defaultProjectsRoot()`), same semantics as `query`.
- `--human` (optional): human-readable summary instead of JSON (same convention as
  other verbs).

`make-preset` is **read-only** and **library-level**: it is dispatched before the
`projectPath`/`loadDraft` guard (alongside `query`), takes a `--font`, not a project,
and is NOT in `WRITE_COMMANDS` (no CapCut-open guard).

## 4. Behaviour

1. Enumerate the drafts library (reuse `query`'s scan: `defaultProjectsRoot()` /
   `--drafts`, defensive `draft_content.json` read, skip malformed).
2. Across all `materials.texts[]`, collect candidate font blocks. A candidate =
   `{ resource_id, title, font_path, source_platform, fonts_entry, content_font }`
   extracted from a text material, using the same narrowing helpers as `query`.
3. **Match:**
   - numeric `--font` → keep candidates whose `resource_id` equals it exactly.
   - otherwise → keep candidates whose `title` contains `--font` (case-insensitive).
4. **Dedup + tie-break** by `resource_id`. When the same `resource_id` appears with
   divergent metadata, prefer the entry that is **catalogue-grade**: `source_platform == 1`
   AND non-empty `title` AND a `path` under `/effect/<resource_id>/`. Deterministic
   ordering otherwise (stable by draft scan order).
5. **Resolve to exactly one font:**
   - 0 matches → empty result (exit 0), message: apply the font once in CapCut, then retry.
   - >1 **distinct** `resource_id` matches → list the candidates (titles + ids) and
     exit 0 with `ambiguous: true`; do NOT pick silently. (`--human` prints a table.)
   - exactly 1 → build the preset.
6. **Guard:** if the resolved font has no `resource_id` (local-only, `source_platform 0`)
   → refuse with a clear message (cannot produce a resolvable catalogue preset).
7. Emit the bare-font preset (envelope to stdout; file if `--out`).

## 5. Output

### Envelope (stdout, default)
```jsonc
{
  "type": "capcut-david/make-preset@1",
  "ok": true,            // success/ambiguous: true · no-match: false (mirrors query)
  "font": { "title": "SpeedLines", "resource_id": "7605981975781887248",
            "font_path": "C:/.../effect/7605981975781887248/.../font.ttf",
            "source_platform": 1, "from_drafts": ["niche_pc_…"] },
  "ambiguous": false,
  "candidates": [],          // populated only when ambiguous
  "written": null,           // or the --out path
  "preset": { /* the bare-font preset object (see "Bare-font preset" below) */ }
}
```

### Bare-font preset (the artifact `--out` writes / `preset` carries)
```jsonc
{
  "text_material": {
    "font_path": "<abs .ttf path>",
    "font_resource_id": "<rid>",
    "font_title": "<catalogue title>",
    "font_source_platform": 1,
    "fonts": [ { "id": "<rid>", "resource_id": "<rid>", "third_resource_id": "",
                 "category_id": "preset", "category_name": "Presets",
                 "source_platform": 1, "path": "<abs .ttf path>",
                 "effect_id": "<rid>", "title": "<catalogue title>",
                 "team_id": "", "file_uri": "", "request_id": "" } ]
  },
  "content_template": {
    "text": "",
    "styles": [ { "font": { "path": "<abs .ttf path>", "id": "<rid>" } } ]
  },
  "segment": {}
}
```

Emit rules (constrained by `restyle.ts`):
- `restyleMaterial` copies **every** `text_material` key onto the caption material →
  emit ONLY font fields (no shadow/border/name/base_content/recognize_text).
- `fontFromPreset` needs `font_path` or `font_resource_id` present, else the font-mirror
  pass silently no-ops → always emit both.
- `spanStyleFromPreset` reads `content_template.styles[0]` minus `fill`+`range` → it must
  carry ONLY `{ font: {path, id} }` so no decoration leaks onto spans.
- **#8 correctness (critical):** `fonts[].title`, `font_title`, and `source_platform: 1`
  are copied from the draft's real `fonts[]` entry, never synthesized — otherwise the
  CapCut dropdown shows "System".

## 6. Exit codes (mirror `query`)

- `0` — success, including no-match (empty result) and ambiguous (candidate list).
- `2` — operational failure (e.g. drafts root missing/unreadable).
- `1` — usage error (missing `--font`), via `die()`.

The `cmdMakePreset` function RETURNS the exit code (`process.exit(cmdMakePreset(...))`
in index.ts), matching the query/validate/gc family.

## 7. Why drafts-library, not cache+SQLite (decision record)

Architect verdict: **Option A, HIGH confidence.**
- The complete font block — incl. catalogue `title`, `source_platform`, cache `.ttf`
  path — already lives in any draft that uses the font (confirmed in
  `test-fixtures/fixtures/full-psycho-draft.json`). SQLite's only claimed advantage
  (catalogue title) is therefore moot.
- Adding a SQLite reader (`better-sqlite3` native build, or sql.js WASM blob) to a
  **zero-runtime-dependency** engine is high cost on Windows + CI, and couples to
  CapCut's undocumented cache layout.
- Workflow reality: using a catalogue font in CapCut requires download=apply, which
  writes it into a draft. A never-applied font has no `resource_id` to put in a preset
  anyway. So Option A's "must be in a draft" is not a real limitation.

## 8. Implementation notes

- New file `src/commands/make-preset.ts`: pure `planMakePreset(drafts[], font)` →
  `{ match | candidates | none }`, plus `buildPreset(fontBlock)` (pure), plus
  `cmdMakePreset(flags): number`.
- Reuse from `query.ts`: the library-scan loop, `rec`/`arr`/`str` narrowing,
  `defaultProjectsRoot()`. Factor shared helpers if clean; otherwise mirror.
- Wire into `src/index.ts`: `--font`/`--out` flag parsing; dispatch `if (cmd === "make-preset")
  process.exit(cmdMakePreset(flags))` at the library level (next to `query`, before the
  project-path guard). HELP `Catalogue:` block gains a `make-preset` line. Not in
  `WRITE_COMMANDS`.
- `Flags` gains `font?: string`, `out?: string` (in `src/utils/cli.ts`).

## 9. Testing (TDD, `test/make-preset.test.mjs`, run from `dist/`)

Unit (pure):
- `planMakePreset`: name substring match; numeric→exact rid; no-match → none; multiple
  distinct rids → candidates (ambiguous); dedup prefers catalogue entry over local
  fallback; tie-break determinism.
- `buildPreset`: emits exactly the §5 field set; no decoration keys; `fonts[].title` +
  `font_title` + `source_platform` carried; `content_template.styles[0]` font-only.

CLI (envelope/exit):
- `--font SpeedLines` over a fixture lib → ok envelope + correct font + valid preset.
- numeric `--font <rid>` exact match.
- `--out <file>` writes a preset that `restyle --preset <file>` accepts (round-trip).
- missing `--font` → exit 1 (`die`).
- empty/missing drafts root → exit 2.
- no match → exit 0, empty.
- ambiguous (two fonts matching substring) → exit 0, `ambiguous:true`, candidates listed.
- local-only font (no resource_id) → refuse with message.

Fixtures: `full-psycho-draft.json` / `ken-burns-draft.json` (CC-DerStil), plus synthetic
temp libraries for ambiguity/local-only/no-match (inline `makeLib` helper, as in
`query.test.mjs`).

## 10. Release (gated, conventions)

Minor version bump (v1.14.0 — first generation verb). CHANGELOG `[1.14.0]` +
`release-notes/1.14.0.md`. `docs/` ELI5 explainer (`make-preset-explained.md`). Branch
`feat/make-preset`, FF-merge master + tag local. Push/CI/npm/gh-release **gated** on
explicit user go. **Footgun:** update `~/rel.sh` to v1.14.0 BEFORE running it.
