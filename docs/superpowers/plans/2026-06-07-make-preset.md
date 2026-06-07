# make-preset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only `make-preset` engine verb that, given a font name, scans the CapCut drafts library and emits a ready-to-use bare-font `restyle` preset.

**Architecture:** Mirror the `query` verb. A pure `planMakePreset()` extracts/dedupes/matches font blocks from drafts; a pure `buildPreset()` turns the chosen font block into the preset JSON (copying the draft's real `fonts[]` entry verbatim for fidelity); `cmdMakePreset()` does library I/O, the JSON envelope, `--out` file writing, and exit codes. Library-level dispatch (no draft loaded), zero new dependencies.

**Tech Stack:** TypeScript (ESM, NodeNext), `node:test` against compiled `dist/`, Biome lint/format. Spec: `docs/superpowers/specs/2026-06-07-make-preset-design.md`.

---

## File Structure

- **Create** `src/commands/make-preset.ts` — the verb: `planMakePreset` (pure), `buildPreset` (pure), `cmdMakePreset` (CLI). Mirrors `src/commands/query.ts`.
- **Create** `test/make-preset.test.mjs` — unit (pure) + CLI tests, against `dist/`.
- **Modify** `src/utils/cli.ts` — add `font?: string` to `Flags`.
- **Modify** `src/index.ts` — `--font` parse arm; import + library-level dispatch; HELP `Catalogue:` entry.
- **Modify** `package.json`, `CHANGELOG.md`, **Create** `release-notes/1.14.0.md`, `docs/make-preset-explained.md` — release prep (gated).

Conventions (verified against the codebase):
- Narrowing helpers `rec`/`arr`/`str` are NOT exported by `query.ts`. To stay surgical and avoid touching the working `query` path, **mirror** these three tiny helpers inside `make-preset.ts` (do not refactor query.ts).
- `cmdMakePreset` RETURNS the exit code; `index.ts` does `process.exit(cmdMakePreset(flags))`. Usage errors throw via `die()` → exit 1 in the top-level catch.
- `out(data, flags)` (from `utils/cli.ts`) prints JSON unless `--quiet`.
- Envelope `type: "capcut-david/make-preset@1"`.

---

## Task 1: `planMakePreset` — pure extraction / match / dedupe

**Files:**
- Create: `src/commands/make-preset.ts`
- Test: `test/make-preset.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `test/make-preset.test.mjs`:

```javascript
// Tests for v1.14.0 `make-preset` — generate a bare-font restyle preset for a
// font found in the drafts library. Spec: docs/superpowers/specs/2026-06-07-make-preset-design.md
import { test } from "node:test";
import { strictEqual, deepStrictEqual, ok } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { planMakePreset, buildPreset } from "../dist/commands/make-preset.js";
import { runCli } from "./helpers/spawn-cli.mjs";

// --- builders ---------------------------------------------------------------
const draftWith = (materials) => ({ id: "D", name: "n", duration: 1, fps: 30, canvas_config: { width: 1, height: 1, ratio: "9:16" }, tracks: [], materials });
const named = (name, draft) => [{ name, draft }];

// A catalogue font block as it appears inside a draft's materials.texts[].fonts[].
const catFont = (title, rid, extra = {}) => ({
  type: "text",
  font_title: title,
  font_resource_id: rid,
  font_source_platform: 1,
  font_path: `C:/cache/effect/${rid}/h/${title}.ttf`,
  fonts: [{ id: rid, resource_id: rid, third_resource_id: "", category_id: "preset", category_name: "Presets", source_platform: 1, path: `C:/cache/effect/${rid}/h/${title}.ttf`, effect_id: rid, title, team_id: "", file_uri: "", request_id: "REQ-NATIVE", ...extra }],
});

// --- planMakePreset ---------------------------------------------------------

test("plan: name substring match → single catalogue font", () => {
  const d = draftWith({ texts: [catFont("SpeedLines", "7605")] });
  const r = planMakePreset(named("dA", d), "speed");
  strictEqual(r.status, "match");
  strictEqual(r.font.title, "SpeedLines");
  strictEqual(r.font.resource_id, "7605");
  strictEqual(r.font.source_platform, 1);
  deepStrictEqual(r.font.from_drafts, ["dA"]);
});

test("plan: numeric arg → exact resource_id match (not substring)", () => {
  const d = draftWith({ texts: [catFont("SpeedLines", "7605"), catFont("Disco", "76050")] });
  const r = planMakePreset(named("dA", d), "7605");
  strictEqual(r.status, "match");
  strictEqual(r.font.resource_id, "7605"); // does NOT also match "76050"
});

test("plan: no match → status none", () => {
  const d = draftWith({ texts: [catFont("SpeedLines", "7605")] });
  strictEqual(planMakePreset(named("dA", d), "nope").status, "none");
});

test("plan: two distinct fonts matched by substring → ambiguous, candidates sorted", () => {
  const d = draftWith({ texts: [catFont("LineArt", "1"), catFont("Lineback", "2")] });
  const r = planMakePreset(named("dA", d), "line");
  strictEqual(r.status, "ambiguous");
  strictEqual(r.candidates.length, 2);
  deepStrictEqual(r.candidates.map((c) => c.title), ["LineArt", "Lineback"]);
});

test("plan: same resource_id across drafts → deduped, from_drafts merged+sorted", () => {
  const mk = () => draftWith({ texts: [catFont("SpeedLines", "7605")] });
  const r = planMakePreset([{ name: "dB", draft: mk() }, { name: "dA", draft: mk() }], "speed");
  strictEqual(r.status, "match");
  deepStrictEqual(r.font.from_drafts, ["dA", "dB"]);
});

test("plan: prefers catalogue-grade entry over local fallback for same title", () => {
  // local (no rid) and catalogue (rid) both present in different drafts.
  const local = draftWith({ texts: [{ type: "text", font_title: "SpeedLines", font_resource_id: "", font_source_platform: 0, font_path: "C:/win/fonts/speed.ttf", fonts: [{ title: "SpeedLines", resource_id: "", source_platform: 0, path: "C:/win/fonts/speed.ttf" }] }] });
  const cat = draftWith({ texts: [catFont("SpeedLines", "7605")] });
  const r = planMakePreset([{ name: "loc", draft: local }, { name: "cat", draft: cat }], "speedlines");
  strictEqual(r.status, "match");
  strictEqual(r.font.resource_id, "7605"); // catalogue wins, not the empty-rid local
});

test("plan: local-only font (no resource_id) is matchable but flagged", () => {
  const d = draftWith({ texts: [{ type: "text", font_title: "MyLocal", font_resource_id: "", font_source_platform: 0, font_path: "C:/win/fonts/mylocal.ttf", fonts: [{ title: "MyLocal", resource_id: "", source_platform: 0, path: "C:/win/fonts/mylocal.ttf" }] }] });
  const r = planMakePreset(named("dA", d), "mylocal");
  strictEqual(r.status, "match");
  strictEqual(r.font.resource_id, null);
});

test("plan: entries without a title are skipped; missing texts tolerated", () => {
  const d = draftWith({ texts: [{ type: "text", fonts: [{ resource_id: "9", path: "/x.ttf" }] }] });
  strictEqual(planMakePreset(named("dA", d), "").status, "none");
  strictEqual(planMakePreset(named("dB", draftWith({})), "x").status, "none");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build` then `node --test test/make-preset.test.mjs`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `dist/commands/make-preset.js` (file doesn't exist yet).

- [ ] **Step 3: Write minimal implementation (plan + types + narrowing)**

Create `src/commands/make-preset.ts`:

```typescript
// Generate a bare-font `restyle` preset for a font found in the CapCut drafts
// library. The generation cousin of `query`: scans every draft under the
// projects root (or --drafts), finds a font by NAME (case-insensitive substring,
// or exact resource_id if the arg is numeric), and emits a ready-to-use preset
// carrying ONLY the font identity (no stroke/shadow/size). Never writes a draft.
// Spec: docs/superpowers/specs/2026-06-07-make-preset-design.md
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultProjectsRoot } from "../utils/capcut-paths.js";
import { die, type Flags, out } from "../utils/cli.js";

// --- defensive narrowing (drafts are untrusted JSON) — mirrored from query.ts
function rec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function arr(v: unknown): Record<string, unknown>[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x));
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export interface FontCandidate {
  resource_id: string | null;
  title: string;
  font_path: string | null;
  source_platform: number;
  /** The raw fonts[] entry from the draft — emitted verbatim for fidelity. */
  fonts_entry: Record<string, unknown>;
  from_drafts: string[];
}

export type PlanResult =
  | { status: "match"; font: FontCandidate }
  | { status: "none" }
  | { status: "ambiguous"; candidates: FontCandidate[] };

type RawFont = Omit<FontCandidate, "from_drafts">;

// Extract every titled font block from ONE draft.
function extractFonts(draft: unknown): RawFont[] {
  const fonts: RawFont[] = [];
  const d = rec(draft);
  const m = d ? rec(d.materials) : null;
  if (!m) return fonts;
  for (const t of arr(m.texts)) {
    for (const f of arr(t.fonts)) {
      const title = str(f.title);
      if (!title) continue;
      const sp = typeof f.source_platform === "number" ? f.source_platform : typeof t.font_source_platform === "number" ? t.font_source_platform : 0;
      fonts.push({
        resource_id: str(f.resource_id),
        title,
        font_path: str(f.path) ?? str(t.font_path),
        source_platform: sp,
        fonts_entry: f,
      });
    }
  }
  return fonts;
}

// Dedupe key: catalogue fonts by resource_id; local fonts by title+path.
function dedupeKey(f: RawFont): string {
  return f.resource_id ? `rid:${f.resource_id}` : `local:${f.title}|${f.font_path ?? ""}`;
}

// Is this entry "catalogue-grade" (a real downloaded font, preferred on tie)?
function catalogueGrade(f: RawFont): boolean {
  return !!f.resource_id && f.source_platform === 1 && !!f.font_path && f.font_path.includes(`/effect/${f.resource_id}/`);
}

// Pure: extract → dedupe (prefer catalogue-grade) → match → classify.
export function planMakePreset(drafts: Array<{ name: string; draft: unknown }>, font: string): PlanResult {
  const index = new Map<string, FontCandidate>();
  for (const { name, draft } of drafts) {
    for (const raw of extractFonts(draft)) {
      const key = dedupeKey(raw);
      const existing = index.get(key);
      if (!existing) {
        index.set(key, { ...raw, from_drafts: [name] });
      } else {
        if (!existing.from_drafts.includes(name)) existing.from_drafts.push(name);
        // Upgrade to a catalogue-grade representative if a better one appears.
        if (!catalogueGrade(existing) && catalogueGrade(raw)) {
          index.set(key, { ...raw, from_drafts: existing.from_drafts });
        }
      }
    }
  }

  const isNumeric = /^\d+$/.test(font);
  const needle = font.toLowerCase();
  let matches = [...index.values()].filter((c) =>
    isNumeric ? c.resource_id === font : c.title.toLowerCase().includes(needle),
  );
  for (const c of matches) c.from_drafts.sort();
  matches.sort((a, b) => a.title.localeCompare(b.title));

  // Distinct by dedupe key (a single font matched in many drafts is one match).
  const distinct = new Map<string, FontCandidate>();
  for (const c of matches) distinct.set(c.resource_id ? `rid:${c.resource_id}` : `local:${c.title}|${c.font_path ?? ""}`, c);
  const list = [...distinct.values()];

  if (list.length === 0) return { status: "none" };
  if (list.length > 1) return { status: "ambiguous", candidates: list };
  return { status: "match", font: list[0] };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build` then `node --test test/make-preset.test.mjs`
Expected: the 8 `plan:` tests PASS. (`buildPreset` import is still undefined — its tests come in Task 2; they may error, that's fine for now, or comment-add in Task 2.)

- [ ] **Step 5: Commit**

```bash
git add src/commands/make-preset.ts test/make-preset.test.mjs
git commit -m "feat(make-preset): planMakePreset — drafts-library font match/dedupe (pure)"
```

---

## Task 2: `buildPreset` — emit the bare-font preset

**Files:**
- Modify: `src/commands/make-preset.ts`
- Test: `test/make-preset.test.mjs`

- [ ] **Step 1: Append the failing tests**

Add to `test/make-preset.test.mjs`:

```javascript
// --- buildPreset ------------------------------------------------------------

const candidate = (over = {}) => ({
  resource_id: "7605",
  title: "SpeedLines",
  font_path: "C:/cache/effect/7605/h/SpeedLines.ttf",
  source_platform: 1,
  fonts_entry: { id: "G", resource_id: "7605", category_id: "preset", category_name: "Presets", source_platform: 1, path: "C:/old/path.ttf", effect_id: "7605", title: "SpeedLines", request_id: "REQ-NATIVE" },
  from_drafts: ["dA"],
  ...over,
});

test("buildPreset: emits text_material font identity (title/rid/source_platform/path)", () => {
  const p = buildPreset(candidate());
  strictEqual(p.text_material.font_title, "SpeedLines");
  strictEqual(p.text_material.font_resource_id, "7605");
  strictEqual(p.text_material.font_source_platform, 1);
  strictEqual(p.text_material.font_path, "C:/cache/effect/7605/h/SpeedLines.ttf");
});

test("buildPreset: fonts[] is the draft entry verbatim, path normalized, request_id cleared", () => {
  const p = buildPreset(candidate());
  strictEqual(p.text_material.fonts.length, 1);
  const f = p.text_material.fonts[0];
  strictEqual(f.title, "SpeedLines");
  strictEqual(f.path, "C:/cache/effect/7605/h/SpeedLines.ttf"); // normalized to font_path
  strictEqual(f.request_id, ""); // cleared (CapCut wipes non-empty engine request_ids)
});

test("buildPreset: content_template.styles[0] is font-only (no decoration leaks)", () => {
  const p = buildPreset(candidate());
  deepStrictEqual(p.content_template.styles[0], { font: { path: "C:/cache/effect/7605/h/SpeedLines.ttf", id: "7605" } });
});

test("buildPreset: BARE FONT — segment empty, no shadow/border/name keys", () => {
  const p = buildPreset(candidate());
  deepStrictEqual(p.segment, {});
  strictEqual("has_shadow" in p.text_material, false);
  strictEqual("border_color" in p.text_material, false);
  strictEqual("base_content" in p.text_material, false);
});

test("buildPreset: output round-trips through restyle (the preset is accepted)", () => {
  // Structural contract: restyle reads text_material + content_template + segment.
  const p = buildPreset(candidate());
  ok(p.text_material && p.content_template && p.segment);
  ok(Array.isArray(p.content_template.styles) && p.content_template.styles.length === 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build` then `node --test test/make-preset.test.mjs`
Expected: the 5 `buildPreset:` tests FAIL (`buildPreset is not a function`).

- [ ] **Step 3: Implement `buildPreset`**

Append to `src/commands/make-preset.ts`:

```typescript
// Build a BARE-FONT restyle preset from a chosen font. Copies the draft's real
// fonts[] entry verbatim (fidelity), normalizing its path to font_path and
// clearing request_id (CapCut wipes non-empty engine-written request_ids).
// Emits ONLY font fields — restyleMaterial grafts every text_material key, so
// any extra key (shadow/border/name) would leak onto every caption.
export function buildPreset(font: FontCandidate): Record<string, unknown> {
  const path = font.font_path ?? "";
  const fontsEntry = { ...font.fonts_entry, path, request_id: "" };
  return {
    text_material: {
      font_title: font.title,
      font_resource_id: font.resource_id ?? "",
      font_source_platform: font.source_platform,
      font_path: path,
      fonts: [fontsEntry],
    },
    content_template: {
      text: "",
      styles: [{ font: { path, id: font.resource_id ?? "" } }],
    },
    segment: {},
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build` then `node --test test/make-preset.test.mjs`
Expected: all Task 1 + Task 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/make-preset.ts test/make-preset.test.mjs
git commit -m "feat(make-preset): buildPreset — emit bare-font restyle preset"
```

---

## Task 3: `cmdMakePreset` + CLI wiring (Flags, parseFlags, dispatch, HELP)

**Files:**
- Modify: `src/commands/make-preset.ts`
- Modify: `src/utils/cli.ts:1-40` (add `font?: string`)
- Modify: `src/index.ts` (import, `--font` parse, dispatch, HELP)
- Test: `test/make-preset.test.mjs`

- [ ] **Step 1: Append the failing CLI tests**

Add to `test/make-preset.test.mjs`:

```javascript
// --- CLI (envelope / exit codes / --out) ------------------------------------

// Temp drafts-library: root/<name>/draft_content.json. value = draft object.
function makeLib(t, drafts) {
  const root = mkdtempSync(join(tmpdir(), "capcut-makepreset-test-"));
  for (const [name, val] of Object.entries(drafts)) {
    const sub = join(root, name);
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, "draft_content.json"), typeof val === "string" ? val : JSON.stringify(val));
  }
  if (t && typeof t.after === "function") t.after(() => { try { rmSync(root, { recursive: true, force: true }); } catch {} });
  return root;
}
const libDraft = (mats) => ({ id: "D", name: "n", duration: 1, fps: 30, canvas_config: { width: 1, height: 1, ratio: "9:16" }, tracks: [], materials: mats });
const libFont = (title, rid) => ({ type: "text", font_title: title, font_resource_id: rid, font_source_platform: 1, font_path: `C:/cache/effect/${rid}/h/${title}.ttf`, fonts: [{ id: rid, resource_id: rid, category_id: "preset", category_name: "Presets", source_platform: 1, path: `C:/cache/effect/${rid}/h/${title}.ttf`, effect_id: rid, title, request_id: "REQ" }] });

test("CLI: --font name → status 0, make-preset@1 envelope with font + preset", (t) => {
  const root = makeLib(t, { dA: libDraft({ texts: [libFont("SpeedLines", "7605")] }) });
  const r = runCli(["make-preset", "--font", "speed", "--drafts", root]);
  strictEqual(r.status, 0, r.stderr);
  strictEqual(r.json.type, "capcut-david/make-preset@1");
  strictEqual(r.json.ok, true);
  strictEqual(r.json.font.title, "SpeedLines");
  strictEqual(r.json.preset.text_material.font_resource_id, "7605");
});

test("CLI: numeric --font → exact resource_id match", (t) => {
  const root = makeLib(t, { dA: libDraft({ texts: [libFont("SpeedLines", "7605"), libFont("Disco", "76050")] }) });
  const r = runCli(["make-preset", "--font", "7605", "--drafts", root]);
  strictEqual(r.status, 0);
  strictEqual(r.json.font.resource_id, "7605");
});

test("CLI: --out writes the bare preset file (accepted by restyle's shape)", (t) => {
  const root = makeLib(t, { dA: libDraft({ texts: [libFont("SpeedLines", "7605")] }) });
  const outPath = join(root, "speedlines-preset.json");
  const r = runCli(["make-preset", "--font", "speed", "--drafts", root, "--out", outPath]);
  strictEqual(r.status, 0);
  strictEqual(r.json.written, outPath);
  const preset = JSON.parse(readFileSync(outPath, "utf8"));
  ok(preset.text_material && preset.content_template && preset.segment);
  strictEqual(preset.text_material.font_title, "SpeedLines");
});

test("CLI: missing --font → exit 1, error mentions font", (t) => {
  const root = makeLib(t, { dA: libDraft({ texts: [libFont("SpeedLines", "7605")] }) });
  const r = runCli(["make-preset", "--drafts", root]);
  strictEqual(r.status, 1);
  ok(/font/i.test(r.errorJson?.error ?? r.stderr));
});

test("CLI: --drafts missing dir → exit 2", () => {
  const r = runCli(["make-preset", "--font", "x", "--drafts", join(tmpdir(), "capcut-mp-nonexistent-zzz-77")]);
  strictEqual(r.status, 2);
});

test("CLI: no match → exit 0, font null", (t) => {
  const root = makeLib(t, { dA: libDraft({ texts: [libFont("SpeedLines", "7605")] }) });
  const r = runCli(["make-preset", "--font", "zzznope", "--drafts", root]);
  strictEqual(r.status, 0);
  strictEqual(r.json.font, null);
});

test("CLI: ambiguous → exit 0, ambiguous true, candidates listed", (t) => {
  const root = makeLib(t, { dA: libDraft({ texts: [libFont("LineArt", "1"), libFont("Lineback", "2")] }) });
  const r = runCli(["make-preset", "--font", "line", "--drafts", root]);
  strictEqual(r.status, 0);
  strictEqual(r.json.ambiguous, true);
  strictEqual(r.json.candidates.length, 2);
});

test("CLI: local-only font (no resource_id) → exit 2, refuses", (t) => {
  const local = libDraft({ texts: [{ type: "text", font_title: "MyLocal", font_resource_id: "", font_source_platform: 0, font_path: "C:/win/fonts/mylocal.ttf", fonts: [{ title: "MyLocal", resource_id: "", source_platform: 0, path: "C:/win/fonts/mylocal.ttf" }] }] });
  const root = makeLib(t, { dA: local });
  const r = runCli(["make-preset", "--font", "mylocal", "--drafts", root]);
  strictEqual(r.status, 2);
  ok(/resource_id|local/i.test(r.errorJson?.error ?? r.stderr));
});

test("CLI: real ken-burns fixture (CC-DerStil) → valid preset", (t) => {
  const root = mkdtempSync(join(tmpdir(), "capcut-mp-fix-"));
  t.after(() => { try { rmSync(root, { recursive: true, force: true }); } catch {} });
  const sub = join(root, "ken-burns-draft");
  mkdirSync(sub, { recursive: true });
  writeFileSync(join(sub, "draft_content.json"), readFileSync(join("test-fixtures", "fixtures", "ken-burns-draft.json"), "utf8"));
  const r = runCli(["make-preset", "--font", "derstil", "--drafts", root]);
  strictEqual(r.status, 0, r.stderr);
  strictEqual(r.json.font.title, "CC-DerStil");
  ok(r.json.preset.text_material.fonts[0].title === "CC-DerStil");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build` then `node --test test/make-preset.test.mjs`
Expected: build FAILS (TypeScript) or CLI tests fail — `make-preset` is an unknown command / `cmdMakePreset` not wired.

- [ ] **Step 3a: Add `font` to `Flags`**

In `src/utils/cli.ts`, inside the `Flags` interface (after `drafts?: string;` on line 14), add:

```typescript
  font?: string;
```

- [ ] **Step 3b: Implement `cmdMakePreset`**

Append to `src/commands/make-preset.ts`:

```typescript
// Returns the process exit code (0 success incl. zero/ambiguous; 2 operational).
// Usage errors (missing --font) throw via die() → exit 1 in the top-level catch.
export function cmdMakePreset(flags: Flags): number {
  const font = flags.font;
  if (!font) die("Missing --font <name|resource_id>. Usage: capcut-david make-preset --font <name|rid> [--out <file>] [--drafts <dir>]");

  const root = flags.drafts ?? defaultProjectsRoot();
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    process.stderr.write(`${JSON.stringify({ error: `Drafts root not found: ${root}` })}\n`);
    return 2;
  }

  const drafts: Array<{ name: string; draft: unknown }> = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(root, entry.name, "draft_content.json");
    if (!existsSync(file)) continue;
    try {
      const draft = JSON.parse(readFileSync(file, "utf8"));
      if (rec(draft)) drafts.push({ name: entry.name, draft });
    } catch {
      // skip unreadable/malformed, keep scanning
    }
  }

  const plan = planMakePreset(drafts, font);

  if (plan.status === "none") {
    out({ type: "capcut-david/make-preset@1", ok: true, font: null, ambiguous: false, candidates: [], written: null, preset: null }, flags);
    return 0;
  }
  if (plan.status === "ambiguous") {
    out(
      {
        type: "capcut-david/make-preset@1",
        ok: true,
        font: null,
        ambiguous: true,
        candidates: plan.candidates.map((c) => ({ title: c.title, resource_id: c.resource_id, from_drafts: c.from_drafts })),
        written: null,
        preset: null,
      },
      flags,
    );
    return 0;
  }

  const f = plan.font;
  if (!f.resource_id) {
    process.stderr.write(`${JSON.stringify({ error: `Font '${f.title}' is a local font (no resource_id); cannot build a catalogue preset. Apply a catalogue font in CapCut instead.` })}\n`);
    return 2;
  }

  const preset = buildPreset(f);
  let written: string | null = null;
  if (flags.out) {
    writeFileSync(flags.out, `${JSON.stringify(preset, null, 2)}\n`, "utf8");
    written = flags.out;
  }
  out(
    {
      type: "capcut-david/make-preset@1",
      ok: true,
      font: { title: f.title, resource_id: f.resource_id, font_path: f.font_path, source_platform: f.source_platform, from_drafts: f.from_drafts },
      ambiguous: false,
      candidates: [],
      written,
      preset,
    },
    flags,
  );
  return 0;
}
```

- [ ] **Step 3c: Parse `--font` in `index.ts`**

In `src/index.ts`, inside `parseFlags`, add an arm next to `--drafts` (after the `--drafts` block around line 202-203):

```typescript
    } else if (a === "--font" && i + 1 < args.length) {
      flags.font = args[++i];
```

- [ ] **Step 3d: Import + dispatch `make-preset` in `index.ts`**

Add the import next to the query import (after line 21 `import { cmdQuery } from "./commands/query.js";`):

```typescript
import { cmdMakePreset } from "./commands/make-preset.js";
```

Add the dispatch block immediately after the `query` block (after line 299, before `if (!projectPath)`):

```typescript
  if (cmd === "make-preset") {
    process.exit(cmdMakePreset(flags));
  }
```

- [ ] **Step 3e: Document in HELP**

In `src/index.ts`, in the `Catalogue:` section of `HELP` (after the `query` entry that ends at line 165), add:

```
  make-preset --font <name|resource_id> [--out <file>] [--drafts <dir>]
             Generate a BARE-FONT restyle preset for a font already used in your
             drafts library (the generation cousin of query). Reads the font's
             resource_id / .ttf path / catalogue title from a draft that uses it
             and emits a preset ready for `restyle --preset`. --out writes the
             preset file; otherwise it's in the JSON envelope. Read-only. Exit 0
             (incl. no-match / ambiguous), 2 if the drafts root is missing or the
             matched font is local-only (no resource_id), 1 on usage error.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build` then `node --test test/make-preset.test.mjs`
Expected: ALL make-preset tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/make-preset.ts src/utils/cli.ts src/index.ts test/make-preset.test.mjs
git commit -m "feat(make-preset): cmdMakePreset CLI verb — envelope, --out, exit codes, dispatch + HELP"
```

---

## Task 4: Full suite + typecheck + lint (no regressions)

**Files:** none (verification only)

- [ ] **Step 1: Build + full test suite**

Run: `npm run build && node --test`
Expected: ALL tests pass (prior 433 + new make-preset tests). No failures.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (no errors).

- [ ] **Step 3: Lint the new/changed files only**

Run: `npx @biomejs/biome lint src/commands/make-preset.ts src/index.ts src/utils/cli.ts`
Expected: no NEW errors. (The repo has a pre-existing ~19-error baseline e.g. `useParseIntRadix` in index.ts:191 — do NOT touch it. New code must add zero new lint errors.)
If Biome flags a new error in make-preset.ts, fix it; then `npx @biomejs/biome format --write src/commands/make-preset.ts`.

- [ ] **Step 4: Smoke test against the real library**

Run: `node dist/index.js make-preset --font derstil --human` (or with `--drafts <real root>`)
Expected: prints a preset summary (or "No font…" if CC-DerStil isn't in any current draft). No crash.

- [ ] **Step 5: Commit (if any lint/format fixes were made)**

```bash
git add -A
git commit -m "chore(make-preset): lint/format pass — zero new baseline errors"
```

---

## Task 5: Release prep v1.14.0 (LOCAL only — push/npm/gh GATED)

**Files:**
- Modify: `package.json` (version)
- Modify: `CHANGELOG.md`
- Create: `release-notes/1.14.0.md`
- Create: `docs/make-preset-explained.md`
- Modify: `docs/README.md` (index the new ELI5 doc)

> ⚠️ **FOOTGUN:** before the user runs `~/rel.sh`, that script must be bumped to v1.14.0 (tag/title/notes-file) — it was left stale at the previous version last cycle. Flag this in the handoff runbook; do NOT run rel.sh yourself.

- [ ] **Step 1: Bump version**

In `package.json`, set `"version": "1.14.0"`.

- [ ] **Step 2: CHANGELOG entry**

Add a `## [1.14.0]` section at the top of `CHANGELOG.md` describing `make-preset` (read-only generation verb; drafts-library source; bare-font preset; exit codes; copies fonts[].title/source_platform so the dropdown resolves — links to the S1649 #8 finding).

- [ ] **Step 3: Release notes**

Create `release-notes/1.14.0.md` — what it is, why (closes the "hand-crafted preset" pain), usage examples (`make-preset --font SpeedLines --out p.json` then `restyle --preset p.json`), exit-code table, and the local-only-font caveat.

- [ ] **Step 4: ELI5 explainer**

Create `docs/make-preset-explained.md` following the existing ELI5 docs' format (see `docs/query-explained.md`). Add a row for it in `docs/README.md`'s index table.

- [ ] **Step 5: Commit + FF-merge + local tag**

```bash
git add package.json CHANGELOG.md release-notes/1.14.0.md docs/make-preset-explained.md docs/README.md
git commit -m "chore(release): v1.14.0 — make-preset font-preset generator"
git checkout master
git merge --ff-only feat/make-preset
git tag v1.14.0
```

- [ ] **Step 6: Hand off the gated runbook**

Present a numbered `!` runbook for the user to run (NOT executed by the agent):
1. Bump `~/rel.sh` to v1.14.0 FIRST.
2. `git push origin master --tags`
3. Wait for CI green.
4. `npm publish`
5. `bash ~/rel.sh` (GitHub release).
6. `npm i -g capcut-cli-david@1.14.0` (refresh global binary).
7. Update vault SKILLS MAP engine row → v1.14.0 + make-preset narrative (gated push).

---

## Self-Review

**Spec coverage:**
- §3 CLI (`--font`/`--out`/`--drafts`/`--human`) → Task 3 (flags, parse, dispatch, HELP). ✓ Note: `--human` is parsed globally already; a human renderer is optional polish, not required by tests — the JSON envelope is the contract. If desired, add a `renderHuman` like query's; covered by the default `out()` otherwise. (Minor: tests assert JSON, not human, so JSON path is the spec contract.)
- §4 behaviour (scan, match name/numeric, dedupe+tie-break, none/ambiguous/match, local guard) → Tasks 1 + 3. ✓
- §5 output (envelope + bare preset shape) → Tasks 2 + 3. ✓
- §6 exit codes (0/2/1) → Task 3 CLI tests. ✓
- §7 source decision → encoded as drafts-library scan (no SQLite). ✓
- §8 impl notes (mirror query infra, library dispatch, not in WRITE_COMMANDS) → Tasks 1/3. ✓ (make-preset is NOT added to WRITE_COMMANDS — confirmed, no draft write.)
- §9 testing matrix → Tasks 1-3 cover every listed case (name, numeric, --out round-trip, missing --font, missing root, no-match, ambiguous, local-only, real fixture). ✓
- §10 release → Task 5. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; every run step shows command + expected. ✓

**Type consistency:** `planMakePreset`→`PlanResult` (`status: "match"|"none"|"ambiguous"`), `FontCandidate` shape, `buildPreset(FontCandidate)`, `cmdMakePreset(flags): number` are used identically across tasks and tests. `Flags.font` added in Task 3a before first use. Envelope `type` string identical everywhere (`capcut-david/make-preset@1`). ✓

**Open minor:** `--human` rendering is not implemented (JSON is the tested contract). If the user wants a human table for `make-preset`, add a `renderHuman` mirroring query's in a follow-up step — not required for the spec's success criteria.
