# Batch Media Verbs + Mono-Engine Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the batch media verbs the montage pipeline still borrows from third-party `cutcli` into capcut-david (v2.1.0), then cut the prod pipeline over to capcut-david only.

**Architecture:** Three `--batch @file` modes on existing verbs (`add-video`, `add-audio`, `add-keyframe`) + `init --width/--height`. Batch = validate ALL items before the first mutation, mutate in item order, ONE `saveDraft` at the end, output ids in item order. Pipeline side (vault): `assemble_draft.py` / `build_montage.py` / `add_sfx_to_montage.py` swap their cutcli calls for the new verbs behind a new `require_batch_media()` gate.

**Tech Stack:** TypeScript (repo `capcut-cli-david`, node:test against `dist/`), Python (vault `Shared/montage-tools/`, pytest, hermetic).

**Spec:** `docs/superpowers/specs/2026-07-13-batch-media-mono-engine-design.md`

## Global Constraints

- Engine version: **v2.1.0** (minor). Node >= 18 promise unchanged.
- Batch contract: **all-or-nothing** (validate every item before first mutation; die without saving on any invalid item), **ONE saveDraft per batch**, output arrays **in item order**.
- `--batch` is mutually exclusive with the positional single-file form (die if both).
- Oracle: a batch of N items ≡ N unitary calls (same draft JSON modulo uuids).
- Repo conventions: TDD (node:test in `test/*.test.mjs`, imports from `../dist/`), `npm run build` before `npm test`, Biome clean, frequent commits on a feature branch `feat/batch-media`, FF-merge to master.
- Vault edits go through `vault-session start <sujet>` worktrees; pipeline RUNS use the canonical vault path.
- Two repos in play: **engine** = `C:\Users\dbele\Documents\ObsidianVault\Wiki_Claude\Projects\capcut-cli-david\repo` (Tasks 1–5), **vault** = `C:\Users\dbele\Documents\ObsidianVault\Wiki_Claude` (Tasks 6–10).

---

### Task 1: `init --width <n> --height <n>`

**Files:**
- Modify: `src/utils/cli.ts` (Flags interface, ~line 44)
- Modify: `src/index.ts` (`parseFlags` ~line 255, help text `init` line, `cmd === "init"` branch ~line 323)
- Modify: `src/commands/create.ts` (`InitOptions` + `initDraft` ~line 18, `cmdInit` ~line 547)
- Test: `test/create.test.mjs`

**Interfaces:**
- Produces: `initDraft({name, templateDir, draftsDir, width?, height?})` rewrites `draft_content.json`'s `canvas_config.width/height` when both are given. CLI: `capcut-david init <name> --width 1080 --height 1920`. One-sided flag → `die`.

- [ ] **Step 1: Write the failing tests** (append to `test/create.test.mjs`, reusing the file's local `makeTemplateDir`/`makeScratchDir` helpers)

```js
// =============================================================
// init --width/--height (v2.1.0)
// =============================================================

test("initDraft rewrites canvas_config when width+height given", (t) => {
  const templateDir = makeTemplateDir(t);
  const draftsDir = makeScratchDir(t);
  const { filePath } = initDraft({ name: "portrait", templateDir, draftsDir, width: 1080, height: 1920 });
  const content = JSON.parse(readFileSync(filePath, "utf-8"));
  strictEqual(content.canvas_config.width, 1080);
  strictEqual(content.canvas_config.height, 1920);
});

test("initDraft keeps template canvas when width/height omitted", (t) => {
  const templateDir = makeTemplateDir(t);
  const draftsDir = makeScratchDir(t);
  const { filePath } = initDraft({ name: "landscape", templateDir, draftsDir });
  const content = JSON.parse(readFileSync(filePath, "utf-8"));
  strictEqual(content.canvas_config.width, 1920);
  strictEqual(content.canvas_config.height, 1080);
});

test("CLI: init dies on one-sided --width", async (t) => {
  const templateDir = makeTemplateDir(t);
  const draftsDir = makeScratchDir(t);
  const r = await runCli(["init", "onesided", "--template", templateDir, "--drafts", draftsDir, "--width", "1080"]);
  strictEqual(r.code, 1);
  match(r.stderr, /--width and --height must be given together/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && node --test test/create.test.mjs`
Expected: the 3 new tests FAIL (unknown option / canvas stays 1920×1080 / exit 0).

- [ ] **Step 3: Implement**

`src/utils/cli.ts` — add to `Flags`:

```ts
  width?: number;
  height?: number;
```

`src/index.ts` `parseFlags` — add branches (next to `--y`):

```ts
    } else if (a === "--width" && i + 1 < args.length) {
      flags.width = parseInt(args[++i], 10);
    } else if (a === "--height" && i + 1 < args.length) {
      flags.height = parseInt(args[++i], 10);
```

`src/commands/create.ts` — extend `InitOptions` with `width?: number; height?: number;`. In `initDraft`, after the existing template copy + JSON rewrite, when both are set:

```ts
  if (opts.width !== undefined && opts.height !== undefined) {
    const content = JSON.parse(readFileSync(filePath, "utf-8"));
    content.canvas_config = { ...content.canvas_config, width: opts.width, height: opts.height };
    writeFileSync(filePath, JSON.stringify(content));
  }
```

(Match the file's existing read/write style — if `initDraft` already holds the parsed JSON in a variable before writing, set the fields there instead of re-reading.)

`cmdInit` — validate + pass through:

```ts
  const oneSided = (flags.width === undefined) !== (flags.height === undefined);
  if (oneSided) die("--width and --height must be given together");
  const result = initDraft({ name, templateDir, draftsDir, width: flags.width, height: flags.height });
```

`src/index.ts` help text: `init <name> [--template <dir>] [--drafts <dir>] [--width <n> --height <n>]`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test test/create.test.mjs`
Expected: PASS (all, including pre-existing).

- [ ] **Step 5: Commit**

```bash
git checkout -b feat/batch-media
git add -A && git commit -m "feat(init): --width/--height canvas override (portrait drafts without cutcli)"
```

---

### Task 2: `add-video <project> --batch @items.json`

**Files:**
- Modify: `src/utils/cli.ts` (Flags: `batch?: string`)
- Modify: `src/index.ts` (`parseFlags`: `--batch`; `cmd === "add-video"` branch ~line 416; help text)
- Modify: `src/commands/create.ts` (`AddVideoOptions` + `addVideo` volume; new `readBatchItems` helper + `cmdAddVideoBatch`)
- Test: `test/batch-media.test.mjs` (new file)

**Interfaces:**
- Consumes: `addVideo(draft, filePath, opts)` → `{segmentId, materialId, trackId}` (existing).
- Produces:
  - `AddVideoOptions.volume?: number` — applied to the created segment (`segment.volume`), default 1.0 like addAudio.
  - `readBatchItems(spec: string, verb: string): unknown[]` — resolves `@file` (with or without the `@` prefix), parses JSON, dies unless non-empty array.
  - `cmdAddVideoBatch(draft: Draft, filePath: string, flags: Flags): void` — items `[{path, start, duration, width?, height?, volume?, trackName?}]`; `start`/`duration` accept number (µs) or string (`parseTimeInput`); output `{ok, count, segment_ids, material_ids, track_ids}` in item order.

- [ ] **Step 1: Write the failing tests** (`test/batch-media.test.mjs`, new)

```js
// Tests for --batch modes on add-video / add-audio / add-keyframe (v2.1.0).
// Contract: all-or-nothing, ONE save, ids in item order, batch ≡ N× unitary.
import { test } from "node:test";
import { strictEqual, deepStrictEqual, ok, match } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

import { initDraft, addVideo, addAudio } from "../dist/commands/create.js";
import { loadDraft } from "../dist/draft.js";
import { FIXTURES, fixturePath } from "./helpers/load-fixture.mjs";
import { runCli } from "./helpers/spawn-cli.mjs";

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), "capcut-batch-"));
  t.after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });
  return dir;
}

/** Fresh draft on disk + two tiny media files; returns absolute paths. */
function makeDraft(t) {
  const base = scratch(t);
  const templateDir = join(base, "template");
  const draftsDir = join(base, "drafts");
  // manufacture the template like create.test.mjs's makeTemplateDir
  const { mkdirSync } = require("node:fs");
  mkdirSync(templateDir, { recursive: true });
  copyFileSync(fixturePath(FIXTURES.MINIMAL), resolve(templateDir, "draft_content.json"));
  const { filePath, draftPath } = initDraft({ name: "batch-test", templateDir, draftsDir });
  const clip = resolve(base, "clip.mp4");
  const still = resolve(base, "still.png");
  writeFileSync(clip, "fake-mp4");
  writeFileSync(still, "fake-png");
  return { filePath, draftPath, clip, still, base };
}

function writeItems(base, name, items) {
  const p = resolve(base, name);
  writeFileSync(p, JSON.stringify(items));
  return p;
}

// ---------- add-video --batch ----------

test("add-video --batch: ordered ids, photo/video mix, volume, ONE track", async (t) => {
  const { filePath, clip, still, base } = makeDraft(t);
  const items = writeItems(base, "videos.json", [
    { path: clip, start: 0, duration: 2_000_000, width: 1080, height: 1920, volume: 0 },
    { path: still, start: 2_000_000, duration: 3_000_000, width: 1080, height: 1920, volume: 0 },
  ]);
  const r = await runCli(["add-video", filePath, "--batch", `@${items}`]);
  strictEqual(r.code, 0, r.stderr);
  const outJson = JSON.parse(r.stdout);
  strictEqual(outJson.ok, true);
  strictEqual(outJson.count, 2);
  strictEqual(outJson.segment_ids.length, 2);
  const draft = loadDraft(filePath);
  const track = draft.content.tracks.find((tr) => tr.type === "video");
  // order preserved: segment ids on the track match output order
  deepStrictEqual(track.segments.map((s) => s.id), outJson.segment_ids);
  strictEqual(track.segments[0].volume, 0);
  // photo detection by extension (existing addVideo behavior, exercised via batch)
  const stillMat = draft.content.materials.videos.find((m) => m.id === outJson.material_ids[1]);
  strictEqual(stillMat.type, "photo");
});

test("add-video --batch: all-or-nothing — invalid item 2 leaves draft untouched", async (t) => {
  const { filePath, clip, base } = makeDraft(t);
  const before = readFileSync(filePath, "utf-8");
  const items = writeItems(base, "bad.json", [
    { path: clip, start: 0, duration: 1_000_000 },
    { path: resolve(base, "missing.mp4"), start: 1_000_000, duration: 1_000_000 },
  ]);
  const r = await runCli(["add-video", filePath, "--batch", `@${items}`]);
  strictEqual(r.code, 1);
  match(r.stderr, /item 2/);
  strictEqual(readFileSync(filePath, "utf-8"), before, "draft mutated despite invalid batch");
});

test("add-video --batch: mutually exclusive with positional file", async (t) => {
  const { filePath, clip, base } = makeDraft(t);
  const items = writeItems(base, "one.json", [{ path: clip, start: 0, duration: 1_000_000 }]);
  const r = await runCli(["add-video", filePath, clip, "0", "1s", "--batch", `@${items}`]);
  strictEqual(r.code, 1);
  match(r.stderr, /--batch cannot be combined/);
});

test("add-video --batch: empty array dies", async (t) => {
  const { filePath, base } = makeDraft(t);
  const items = writeItems(base, "empty.json", []);
  const r = await runCli(["add-video", filePath, "--batch", `@${items}`]);
  strictEqual(r.code, 1);
  match(r.stderr, /empty/);
});

test("oracle: batch of 2 ≡ 2 unitary addVideo calls (modulo uuids)", async (t) => {
  const a = makeDraft(t);
  const b = makeDraft(t);
  // A: batch via CLI
  const items = writeItems(a.base, "v.json", [
    { path: a.clip, start: 0, duration: 2_000_000, volume: 0 },
    { path: a.still, start: 2_000_000, duration: 1_000_000, volume: 0 },
  ]);
  const r = await runCli(["add-video", a.filePath, "--batch", `@${items}`]);
  strictEqual(r.code, 0, r.stderr);
  // B: unitary via library (same params)
  const { saveDraft } = await import("../dist/draft.js");
  const draftB = loadDraft(b.filePath);
  addVideo(draftB, b.filePath, { path: b.clip, start: 0, duration: 2_000_000, volume: 0 });
  addVideo(draftB, b.filePath, { path: b.still, start: 2_000_000, duration: 1_000_000, volume: 0 });
  saveDraft(b.filePath, draftB);
  // canonicalize: strip uuids + machine paths, then compare
  const canon = (fp) =>
    JSON.stringify(JSON.parse(readFileSync(fp, "utf-8")))
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "UUID")
      .replaceAll(JSON.parse(readFileSync(fp, "utf-8")).id ?? "", "")
      .replace(/capcut-batch-[^"\\/]+/g, "TMP");
  strictEqual(canon(a.filePath), canon(b.filePath));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && node --test test/batch-media.test.mjs`
Expected: FAIL (unknown `--batch` option → CLI treats it as positional → usage error).

- [ ] **Step 3: Implement**

`src/utils/cli.ts` Flags: add `batch?: string;`

`src/index.ts` `parseFlags`:

```ts
    } else if (a === "--batch" && i + 1 < args.length) {
      flags.batch = args[++i];
```

`src/commands/create.ts`:

1. `AddVideoOptions` — add `volume?: number;`. In `addVideo`, when building the segment, set `volume: opts.volume ?? 1.0` exactly where addAudio does it (mirror the addAudio segment shape — read addAudio's segment literal and copy the volume line).

2. Batch helpers (place after `cmdAddVideo`):

```ts
interface MediaBatchItem {
  path: string;
  start: number | string;
  duration: number | string;
  width?: number;
  height?: number;
  volume?: number;
  trackName?: string;
}

/** Resolve `@file` (or bare path), parse JSON, require a non-empty array. */
export function readBatchItems(spec: string, verb: string): MediaBatchItem[] {
  const p = resolve(spec.startsWith("@") ? spec.slice(1) : spec);
  if (!existsSync(p)) die(`--batch file not found: ${p}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(p, "utf-8"));
  } catch (e) {
    die(`--batch file is not valid JSON (${p}): ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!Array.isArray(parsed)) die(`--batch expects a JSON array of items (${verb})`);
  if (parsed.length === 0) die(`--batch array is empty (${verb})`);
  return parsed as MediaBatchItem[];
}

/** Validate one media item; returns normalized {path, start, duration, ...}. 1-based index in errors. */
function normalizeMediaItem(raw: MediaBatchItem, idx: number, verb: string) {
  const label = `${verb} --batch item ${idx}`;
  if (typeof raw.path !== "string" || raw.path === "") die(`${label}: "path" (string) is required`);
  const abs = resolve(raw.path);
  if (!existsSync(abs)) die(`${label}: file not found: ${abs}`);
  const t = (v: number | string, field: string): number => {
    if (typeof v === "number") return v;
    if (typeof v === "string") return parseTimeInput(v);
    die(`${label}: "${field}" must be a number (µs) or time string`);
  };
  if (raw.start === undefined || raw.duration === undefined) die(`${label}: "start" and "duration" are required`);
  return { ...raw, path: abs, start: t(raw.start, "start"), duration: t(raw.duration, "duration") };
}

export function cmdAddVideoBatch(draft: Draft, filePath: string, flags: Flags): void {
  const raw = readBatchItems(flags.batch as string, "add-video");
  // all-or-nothing: validate EVERY item before the first mutation
  const items = raw.map((it, i) => normalizeMediaItem(it, i + 1, "add-video"));
  const segment_ids: string[] = [];
  const material_ids: string[] = [];
  const track_ids: string[] = [];
  for (const it of items) {
    const r = addVideo(draft, filePath, {
      path: it.path, start: it.start, duration: it.duration,
      width: it.width, height: it.height, volume: it.volume, trackName: it.trackName,
    });
    segment_ids.push(r.segmentId);
    material_ids.push(r.materialId);
    track_ids.push(r.trackId);
  }
  saveDraft(filePath, draft); // ONE save
  out({ ok: true, count: items.length, segment_ids, material_ids, track_ids }, flags);
}
```

3. `src/index.ts` `add-video` branch — route on `flags.batch`:

```ts
    if (cmd === "add-video") {
      if (flags.batch !== undefined && positional.length > 2) die("--batch cannot be combined with a positional file");
      if (flags.batch !== undefined) cmdAddVideoBatch(draft, filePath, flags);
      else cmdAddVideo(draft, filePath, positional, flags);
    }
```

(Adapt to the file's actual dispatch shape at line ~416 — keep the existing loadDraft/guard wrapping identical.)

4. Help text under `Add:`: `add-video … | add-video <project> --batch @items.json  (batch: [{path,start,duration,width?,height?,volume?,trackName?}] — ordered segment_ids out)`.

**Note:** `addVideo` currently ends with the caller doing `saveDraft` (`cmdAddVideo` calls `saveDraft` itself). Confirm `addVideo` does NOT save internally — the batch loop relies on that. It doesn't (line 616: `cmdAddVideo` calls `saveDraft` after `addVideo`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test test/batch-media.test.mjs test/create.test.mjs`
Expected: PASS. If the oracle test fails on `volume`: the unitary CLI path must produce the same segment shape — check `addVideo` applies `volume ?? 1.0` unconditionally (a `volume` key must exist in both paths).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(add-video): --batch @items.json — all-or-nothing, one save, ordered ids"
```

---

### Task 3: `add-audio <project> --batch @items.json`

**Files:**
- Modify: `src/commands/create.ts` (new `cmdAddAudioBatch`, reuses `readBatchItems`/`normalizeMediaItem`)
- Modify: `src/index.ts` (`add-audio` branch ~line 412, help text)
- Test: `test/batch-media.test.mjs`

**Interfaces:**
- Consumes: `addAudio(draft, filePath, opts)` → `{segmentId, materialId, trackId}`; `AddAudioOptions` already has `volume?`.
- Produces: `cmdAddAudioBatch(draft, filePath, flags)` — same item schema minus width/height; same output shape as cmdAddVideoBatch.

- [ ] **Step 1: Write the failing tests** (append to `test/batch-media.test.mjs`)

```js
// ---------- add-audio --batch ----------

test("add-audio --batch: ordered ids + volume per item", async (t) => {
  const { filePath, base } = makeDraft(t);
  const sfx1 = resolve(base, "a.mp3"); writeFileSync(sfx1, "x");
  const sfx2 = resolve(base, "b.mp3"); writeFileSync(sfx2, "y");
  const items = writeItems(base, "audios.json", [
    { path: sfx1, start: 0, duration: 500_000, volume: 0.8 },
    { path: sfx2, start: 500_000, duration: 500_000, volume: 0.3 },
  ]);
  const r = await runCli(["add-audio", filePath, "--batch", `@${items}`]);
  strictEqual(r.code, 0, r.stderr);
  const outJson = JSON.parse(r.stdout);
  strictEqual(outJson.count, 2);
  const draft = loadDraft(filePath);
  const track = draft.content.tracks.find((tr) => tr.type === "audio");
  deepStrictEqual(track.segments.map((s) => s.id), outJson.segment_ids);
  strictEqual(track.segments[0].volume, 0.8);
  strictEqual(track.segments[1].volume, 0.3);
});

test("add-audio --batch: all-or-nothing on missing file", async (t) => {
  const { filePath, base } = makeDraft(t);
  const before = readFileSync(filePath, "utf-8");
  const items = writeItems(base, "badaudio.json", [
    { path: resolve(base, "nope.mp3"), start: 0, duration: 100_000 },
  ]);
  const r = await runCli(["add-audio", filePath, "--batch", `@${items}`]);
  strictEqual(r.code, 1);
  strictEqual(readFileSync(filePath, "utf-8"), before);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && node --test test/batch-media.test.mjs`
Expected: the 2 new tests FAIL.

- [ ] **Step 3: Implement** (`src/commands/create.ts`, after `cmdAddVideoBatch`)

```ts
export function cmdAddAudioBatch(draft: Draft, filePath: string, flags: Flags): void {
  const raw = readBatchItems(flags.batch as string, "add-audio");
  const items = raw.map((it, i) => normalizeMediaItem(it, i + 1, "add-audio"));
  const segment_ids: string[] = [];
  const material_ids: string[] = [];
  const track_ids: string[] = [];
  for (const it of items) {
    const r = addAudio(draft, filePath, {
      path: it.path, start: it.start, duration: it.duration,
      volume: it.volume, trackName: it.trackName,
    });
    segment_ids.push(r.segmentId);
    material_ids.push(r.materialId);
    track_ids.push(r.trackId);
  }
  saveDraft(filePath, draft);
  out({ ok: true, count: items.length, segment_ids, material_ids, track_ids }, flags);
}
```

`src/index.ts` `add-audio` branch: same `flags.batch` routing + mutual-exclusion check as Task 2. Help text line for `add-audio --batch`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test test/batch-media.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(add-audio): --batch @items.json (SFX/multi-audio in one save)"
```

---

### Task 4: `add-keyframe <project> --batch @file`

**Files:**
- Modify: `src/commands/keyframe.ts` (new `cmdAddKeyframeBatch`)
- Modify: `src/index.ts` (`add-keyframe` branch ~line 443, help text)
- Test: `test/batch-media.test.mjs`

**Interfaces:**
- Consumes: `cmdAddKeyframe(draft, filePath, segId, timeStr, property, valueStr, curveStr, flags, save = true)` — the existing `save=false` mode is the reuse point (Δ-scaling Cubic Out parity preserved by construction).
- Produces: `cmdAddKeyframeBatch(draft, filePath, flags)` — entries `[{segment_id, property, keyframes: [{time, value, curve?}]}]`; output `{ok, count}` where count = total keyframes written; ONE save.

- [ ] **Step 1: Write the failing tests** (append to `test/batch-media.test.mjs`)

```js
// ---------- add-keyframe --batch ----------

test("add-keyframe --batch: Ken Burns pair on two segments, one save", async (t) => {
  const { filePath, clip, still, base } = makeDraft(t);
  const vids = writeItems(base, "kv.json", [
    { path: clip, start: 0, duration: 2_000_000 },
    { path: still, start: 2_000_000, duration: 2_000_000 },
  ]);
  const rv = await runCli(["add-video", filePath, "--batch", `@${vids}`]);
  const ids = JSON.parse(rv.stdout).segment_ids;
  const entries = writeItems(base, "kf.json", ids.flatMap((id, i) => [
    { segment_id: id, property: "scale_x", keyframes: [
      { time: 0, value: 1.0, curve: "ease-out" },
      { time: 2_000_000, value: 1.08, curve: "ease-out" },
    ]},
    { segment_id: id, property: "scale_y", keyframes: [
      { time: 0, value: 1.0, curve: "ease-out" },
      { time: 2_000_000, value: 1.08, curve: "ease-out" },
    ]},
  ]));
  const r = await runCli(["add-keyframe", filePath, "--batch", `@${entries}`]);
  strictEqual(r.code, 0, r.stderr);
  strictEqual(JSON.parse(r.stdout).count, 8);
  const draft = loadDraft(filePath);
  const seg = draft.content.tracks.find((tr) => tr.type === "video").segments[0];
  ok(seg.common_keyframes.length >= 2, "keyframe lists missing on segment 1");
});

test("add-keyframe --batch: unknown segment_id dies without saving", async (t) => {
  const { filePath, clip, base } = makeDraft(t);
  const vids = writeItems(base, "kv2.json", [{ path: clip, start: 0, duration: 1_000_000 }]);
  await runCli(["add-video", filePath, "--batch", `@${vids}`]);
  const before = readFileSync(filePath, "utf-8");
  const entries = writeItems(base, "badkf.json", [
    { segment_id: "00000000-0000-0000-0000-000000000000", property: "scale_x",
      keyframes: [{ time: 0, value: 1.0 }] },
  ]);
  const r = await runCli(["add-keyframe", filePath, "--batch", `@${entries}`]);
  strictEqual(r.code, 1);
  match(r.stderr, /Segment not found/);
  strictEqual(readFileSync(filePath, "utf-8"), before);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && node --test test/batch-media.test.mjs`
Expected: the 2 new tests FAIL.

- [ ] **Step 3: Implement** (`src/commands/keyframe.ts`)

```ts
interface KeyframeBatchEntry {
  segment_id: string;
  property: string;
  keyframes: { time: number | string; value: number | string; curve?: string }[];
}

export function cmdAddKeyframeBatch(draft: Draft, filePath: string, flags: Flags): void {
  const raw = readBatchItems(flags.batch as string, "add-keyframe") as unknown as KeyframeBatchEntry[];
  // all-or-nothing pass 1: structural validation + segment existence (cmdAddKeyframe
  // dies on bad property/curve/time BEFORE mutating, but only per call — so pre-check
  // the cheap structural facts here to fail before ANY mutation)
  raw.forEach((e, i) => {
    const label = `add-keyframe --batch entry ${i + 1}`;
    if (typeof e.segment_id !== "string" || !e.segment_id) die(`${label}: "segment_id" is required`);
    if (typeof e.property !== "string" || !e.property) die(`${label}: "property" is required`);
    if (!Array.isArray(e.keyframes) || e.keyframes.length === 0) die(`${label}: non-empty "keyframes" array required`);
    if (!findSegment(draft, e.segment_id)) die(`${label}: Segment not found: ${e.segment_id}`);
  });
  let count = 0;
  for (const e of raw) {
    for (const kf of e.keyframes) {
      cmdAddKeyframe(draft, filePath, e.segment_id, String(kf.time), e.property, String(kf.value), kf.curve, { ...flags, quiet: true }, /* save */ false);
      count++;
    }
  }
  saveDraft(filePath, draft); // ONE save
  out({ ok: true, count }, flags);
}
```

Imports needed in `keyframe.ts`: `readBatchItems` from `./create.js`, `saveDraft` from `../draft.js`, `findSegment` (already used at line ~229 — confirm its import). `cmdAddKeyframe` with `quiet: true` must not print per-keyframe output — check its `out(...)` call is guarded by `save` or quiet; if it prints unconditionally, add `if (save) out(...)` (behavior-preserving for the unitary path).

`src/index.ts` `add-keyframe` branch: route on `flags.batch` (positional segId absent in batch mode):

```ts
    if (cmd === "add-keyframe") {
      if (flags.batch !== undefined) cmdAddKeyframeBatch(draft, filePath, flags);
      else cmdAddKeyframe(draft, filePath, positional[2], positional[3], flags.property, flags.value, flags.curve, flags);
    }
```

Help text under `Keyframes:` documenting the entry schema.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test test/batch-media.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the FULL suite + lint (regression gate)**

Run: `npm run build && npm test && npx biome ci .`
Expected: all green (≥ 500 tests), biome exit 0.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(add-keyframe): --batch @file — Ken Burns lots in one save (reuses cmdAddKeyframe save=false)"
```

---

### Task 5: Release v2.1.0

**Files:**
- Modify: `package.json` (version), `CHANGELOG.md`, `src/index.ts` (help header if versioned)

**Interfaces:**
- Produces: npm `capcut-cli-david@2.1.0` (`latest`), tag `v2.1.0`, GitHub release. The `--batch` marker in global `--help` is the version probe Task 6's gate relies on.

- [ ] **Step 1: Bump + changelog**

`package.json`: `"version": "2.1.0"`. `CHANGELOG.md`: new section following the file's existing format (init --width/--height; add-video/add-audio/add-keyframe --batch; contracts: all-or-nothing, one save, ordered ids).

- [ ] **Step 2: Full verification**

Run: `npm run build && npm test && npx biome ci . && npx tsc --noEmit`
Expected: all green.

- [ ] **Step 3: Merge FF + tag + push (Release workflow publishes via OIDC)**

```bash
git checkout master && git merge --ff-only feat/batch-media
git tag v2.1.0 && git push origin master --tags
```

- [ ] **Step 4: Verify release**

Run (after CI): `gh run list --limit 3` then `npm view capcut-cli-david version`
Expected: Release workflow success; npm shows `2.1.0`. **First release exercising the Node 22 / npm@latest workflow (af5ee81) — if the npm upgrade step fails, check npm 12+ vs runner compatibility before anything else.**

- [ ] **Step 5: Update the global binary**

Run: `npm i -g capcut-cli-david@latest && capcut-david --help | grep -c "\-\-batch"`
Expected: ≥ 3 occurrences.

---

### Task 6: Vault — `engine.py` gate + root helper

**Files (in a vault worktree: `bash tools/vault-session.sh start batch-cutover`):**
- Modify: `Shared/montage-tools/engine.py`
- Test: `Shared/montage-tools/test_engine.py`

**Interfaces:**
- Produces:
  - `engine.require_batch_media(exe: str = "capcut-david") -> None` — dies unless `--batch` appears in global `--help` (same marker-probe pattern as `require_transform_y`, marker constant `BATCH_MARKER = "--batch"`).
  - `engine.default_projects_root() -> Path` — Windows: `%LOCALAPPDATA%/CapCut/User Data/Projects/com.lveditor.draft` (mirror of `capcut-paths.ts:23-27`; this codebase is Windows-only in prod, raise `sys.exit` on other platforms).

- [ ] **Step 1: Write the failing tests** (append to `test_engine.py`, mirroring the existing `require_transform_y` tests which monkeypatch `engine._help_text`)

```python
# ---------------------------------------------------------------- require_batch_media


def test_batch_media_ok(monkeypatch):
    monkeypatch.setattr(engine, "_help_text", lambda exe: "add-video <project> --batch @items.json")
    engine.require_batch_media()  # no exit


def test_batch_media_dies_on_old_engine(monkeypatch):
    monkeypatch.setattr(engine, "_help_text", lambda exe: HELP_1_16)
    with pytest.raises(SystemExit, match="2.1.0"):
        engine.require_batch_media()


# ---------------------------------------------------------------- default_projects_root


def test_default_projects_root_windows(monkeypatch):
    monkeypatch.setenv("LOCALAPPDATA", r"C:\Users\x\AppData\Local")
    root = engine.default_projects_root()
    assert str(root).replace("\\", "/").endswith("CapCut/User Data/Projects/com.lveditor.draft")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd <worktree>/Shared/montage-tools && python -m pytest test_engine.py -q`
Expected: 3 new tests FAIL (AttributeError).

- [ ] **Step 3: Implement** (`engine.py`)

```python
BATCH_MARKER = "--batch"


def require_batch_media(exe: str = "capcut-david") -> None:
    """Abort unless the engine supports `--batch` media verbs (>= 2.1.0) —
    the mono-engine pipeline has no cutcli fallback left."""
    try:
        help_text = _help_text(exe)
    except (FileNotFoundError, OSError) as e:
        sys.exit(f"[fail] capcut-david introuvable ({e}) — run: npm i -g capcut-cli-david@latest")
    if BATCH_MARKER not in help_text:
        sys.exit(
            "[fail] capcut-david >= 2.1.0 required (no `--batch` in --help) — the montage "
            "pipeline is mono-engine and needs add-video/add-audio/add-keyframe --batch. "
            "Run: npm i -g capcut-cli-david@latest"
        )


def default_projects_root() -> Path:
    """CapCut platform projects-root (mirror of the engine's capcut-paths.ts)."""
    local = os.environ.get("LOCALAPPDATA")
    if not local:
        sys.exit("[fail] LOCALAPPDATA absent — default_projects_root() est Windows-only")
    return Path(local) / "CapCut" / "User Data" / "Projects" / "com.lveditor.draft"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest test_engine.py -q`
Expected: PASS (all, including the 7 existing gate tests).

- [ ] **Step 5: Commit (worktree)**

```bash
git add -A && git commit -m "feat(engine.py): require_batch_media gate + default_projects_root helper"
```

---

### Task 7: Vault — `build_montage.py` emits the new item schema

**Files (same worktree):**
- Modify: `Shared/montage-tools/build_montage.py` (~line 220, the `video_infos` item literal)
- Test: `Shared/montage-tools/test_build_montage.py`

**Interfaces:**
- Produces: `_montage/video_infos.json` items become `{path, start, duration, width, height, volume}` — µs ints, `duration` = **timeline placement duration** (`end - start` of the old schema), `path` forward-slash absolute. The old keys `videoUrl`/`end` disappear.
- Consumed by: Task 8's `add-video --batch` call.

- [ ] **Step 1: Update the failing tests first**

In `test_build_montage.py`, find the assertions on `video_infos` items (grep `videoUrl`). Rewrite them to the new schema — e.g. where the test asserted `item["videoUrl"] == ...` and `item["end"] - item["start"] == ...`, assert:

```python
    assert item["path"] == str(src).replace("\\", "/")
    assert item["duration"] == expected_end_us - expected_start_us
    assert item["volume"] == 0
    assert "videoUrl" not in item and "end" not in item
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest test_build_montage.py -q`
Expected: FAIL on the rewritten assertions.

- [ ] **Step 3: Implement** — in `build_montage.py` ~line 218-227 replace the item literal:

```python
        infos.append(
            {
                "path": str(src.resolve()).replace("\\", "/"),
                "start": start_us,
                "duration": end_us - start_us,
                "width": w,
                "height": h,
                "volume": 0,
            }
        )
```

**Caveat:** the old cutcli schema carried BOTH the natural media duration (`duration`) and the timeline window (`start`/`end`). `add-video` only takes the placement duration — the natural-duration field is dropped. Check nothing else reads `_montage/video_infos.json` expecting `videoUrl`/`end`: `grep -rn "videoUrl\|video_infos" Shared/ Projects/*/scripts/ --include=*.py` and fix any other reader in this same task.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest test_build_montage.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(build_montage): emit capcut-david --batch item schema (path/start/duration/volume)"
```

---

### Task 8: Vault — `assemble_draft.py` cutover

**Files (same worktree):**
- Modify: `Shared/montage-tools/assemble_draft.py` (docstring pipeline diagram line ~15; gates block ~line 226-229; steps [1/9]–[2/9] lines ~236-249; Ken Burns step lines ~320-343)

**Interfaces:**
- Consumes: `engine.require_batch_media()` (Task 6), `capcut-david init/add-video --batch/add-keyframe --batch` (Tasks 1-5), new `video_infos.json` schema (Task 7).

- [ ] **Step 1: Swap the gates** (~line 226-229) — add `engine.require_batch_media()` after the two existing gates. REMOVE the `engine.ensure_cut_drafts_env()` + `engine.require_capcut_drafts_root(...)` calls (lines ~236-240): no cutcli left in this script; `init` targets the platform root itself.

- [ ] **Step 2: Replace [1/9] draft create** (~lines 236-244):

```python
    print("[1/9] init draft (capcut-david)")
    out = run(["capcut-david", "init", slug, "--width", "1080", "--height", "1920"]).stdout
    draft_dir = json.loads(out)["draft_path"]
```

(`init` dies by itself if the draft already exists — same protection `draft create` gave. If reruns on an existing slug are needed, that behavior is unchanged from cutcli.)

- [ ] **Step 3: Replace [2/9] videos add** (~line 246-249):

```python
    print(f"[2/9] add-video --batch ({len(episode['shots'])} segments)")
    out = run(["capcut-david", "add-video", draft_dir, "--batch", f"@{video_infos}"]).stdout
    seg_ids = json.loads(out)["segment_ids"]  # in shots order
```

- [ ] **Step 4: Replace the Ken Burns step** (~lines 320-343). The kf payload builder currently emits cutcli's shape (`easing: "ease_out"`); rewrite to the batch entry schema — for each image shot segment, two entries:

```python
            kf.extend(
                {
                    "segment_id": seg_id,
                    "property": prop,
                    "keyframes": [
                        {"time": 0, "value": KB_FROM, "curve": "ease-out"},
                        {"time": end_us, "value": KB_TO, "curve": "ease-out"},
                    ],
                }
                for prop in ("scale_x", "scale_y")
            )
```

(Match the existing loop variables around line 330 — the old payload's grouping by segment with a `keyframes` list becomes one entry per property. Then:)

```python
        run(["capcut-david", "add-keyframe", draft_dir, "--batch", f"@{kf_path}"])
```

**Check against the old payload first:** read lines 320-343 to confirm which properties cutcli was keyframing (if the old payload had a single combined scale property, keep exactly the same visual behavior: `scale_x` + `scale_y` pairs are what `ken-burns` itself writes — see `cmdKenBurns`).

- [ ] **Step 5: Grep-proof + docstring**

Run: `grep -n "cutcli" Shared/montage-tools/assemble_draft.py`
Expected: ZERO hits (update the docstring diagram line 15 and any comment mentioning cutcli). Update the module docstring gate list.

- [ ] **Step 6: Compile + hermetic suite**

Run: `python -m py_compile assemble_draft.py && python -m pytest -q` (montage-tools dir)
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(assemble_draft): mono-engine cutover — init/add-video --batch/add-keyframe --batch, cutcli out"
```

---

### Task 9: Vault — `add_sfx_to_montage.py` cutover

**Files (same worktree):**
- Modify: `Shared/montage-tools/add_sfx_to_montage.py` (item schema ~line 84-100; cutcli call ~line 158-166)
- Test: `Shared/montage-tools/test_add_sfx_to_montage.py`

**Interfaces:**
- Consumes: `engine.default_projects_root()`, `engine.require_batch_media()`, `add-audio --batch`.
- Produces: `_montage/sfx_audio_infos.json` in the new item schema `{path, start, duration, volume}`.

- [ ] **Step 1: Update tests** — in `test_add_sfx_to_montage.py`, rewrite the audio-infos schema assertions (grep `audioUrl`) to `path`/`start`/`duration`/`volume` (µs ints), same style as Task 7.

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest test_add_sfx_to_montage.py -q`
Expected: FAIL on the schema assertions.

- [ ] **Step 3: Implement**

1. Item builder (~line 84): emit `{"path": ..., "start": ..., "duration": ..., "volume": ...}` mapping the old fields 1:1 (old `audioUrl`→`path`; if the old schema used `start`/`end`, `duration = end - start`; read the current literal and map exactly).
2. Engine call (~line 158): replace the `ensure_cut_drafts_env` + cutcli block with:

```python
    import engine

    engine.require_batch_media()
    draft_dir = engine.default_projects_root() / args.draft_name
    if not (draft_dir / "draft_content.json").exists():
        sys.exit(f"[fail] draft introuvable: {draft_dir}")

    cmd = ["capcut-david", "add-audio", str(draft_dir), "--batch", f"@{sfx_json_path}"]
```

(keep the existing print/run/returncode handling below unchanged, message updated to `capcut-david add-audio failed`).

- [ ] **Step 4: Run tests + grep-proof**

Run: `python -m pytest test_add_sfx_to_montage.py -q && grep -rn "cutcli" add_sfx_to_montage.py build_montage.py assemble_draft.py`
Expected: tests PASS; grep = zero hits on all three files.

- [ ] **Step 5: Commit + save the branch**

```bash
git add -A && git commit -m "feat(add_sfx): add-audio --batch via capcut-david — montage-tools 100% mono-engine"
bash tools/vault-session.sh save "batch-cutover: engine gates + 3 consumers"
```

---

### Task 10: A/B proof, cutover ship, docs

**Files:**
- Create: `<canonical vault>/Projects/TikTok/Stickman_3d_Psychologie/script_temp/compare_drafts.py` (disposable)
- Vault ship of the worktree; ENGINE-FACTS + SKILLS MAP edits

**Interfaces:**
- Consumes: everything above. This task runs from the CANONICAL vault path (pipeline runs never happen in worktrees).

- [ ] **Step 1: Pick reference episode A** — the last shipped known-good Stickman draft (ask David or take the most recent `v_*` draft in the CapCut root whose episode inputs still exist under `Projects/TikTok/Stickman_3d_Psychologie/outputs/<slug>/`). Draft A = the EXISTING draft in the CapCut root (built by the cutcli path when it shipped).

- [ ] **Step 2: Build B with the new path** — from the worktree code but against canonical inputs: temporarily run `assemble_draft.py` FROM THE WORKTREE with `--name <slug>-abtest` (or the script's slug override flag — check `argparse` in assemble_draft.py) so it builds a SECOND draft next to A without touching it. Inputs (episode.json, _montage/) live in the canonical project dir — pass the canonical `--project-dir`. Note: `build_montage.py` must run first (new schema), also from the worktree, `--dry-run`-free but writing only into the project's `_montage/`.

- [ ] **Step 3: Structural comparator** (`script_temp/compare_drafts.py`):

```python
"""A/B structural diff of two CapCut drafts (uuids and draft names excluded).
Usage: python compare_drafts.py <draft_dir_A> <draft_dir_B>"""
import json, re, sys
from pathlib import Path

def canon(draft_dir: Path):
    c = json.loads((draft_dir / "draft_content.json").read_text(encoding="utf-8"))
    tracks = []
    for t in sorted(c["tracks"], key=lambda t: (t["type"], t.get("name") or "")):
        segs = []
        for s in t["segments"]:
            segs.append({
                "start": s["target_timerange"]["start"],
                "duration": s["target_timerange"]["duration"],
                "volume": s.get("volume"),
                "n_keyframes": sorted(
                    (k.get("keyframe_type") or k.get("type"), len(k.get("keyframe_list", [])))
                    for k in (s.get("common_keyframes") or [])
                ),
            })
        tracks.append({"type": t["type"], "segments": segs})
    mats = sorted(
        (m.get("type"), Path(m.get("path", "")).suffix.lower())
        for m in c["materials"].get("videos", []) + c["materials"].get("audios", [])
    )
    return {"canvas": c["canvas_config"], "tracks": tracks, "materials": mats}

a, b = canon(Path(sys.argv[1])), canon(Path(sys.argv[2]))
if a == b:
    print("EQUIVALENT")
else:
    import difflib
    da, db = json.dumps(a, indent=1).splitlines(), json.dumps(b, indent=1).splitlines()
    print("\n".join(difflib.unified_diff(da, db, "A", "B", lineterm="")))
    sys.exit(2)
```

Run it A vs B. Expected: `EQUIVALENT`, or a diff whose every line is explained (e.g. caption texts differ only if inputs drifted since A shipped — judge each).

- [ ] **Step 4: validate + visual gate**

Run: `capcut-david validate <A> -q; capcut-david validate <B> -q` → both rc 0 (or identical known findings). Then **STOP: David opens both drafts in CapCut and confirms B looks right.** Do not proceed without his OK.

- [ ] **Step 5: Ship the vault branch**

```bash
cd <worktree> && bash tools/vault-session.sh ship "feat(montage-tools): pipeline mono-moteur capcut-david (batch verbs 2.1.0), cutcli retiré de la prod"
```

Delete the `-abtest` draft folder + its root_meta entry (`capcut-david gc`-free: just remove the folder and re-run `capcut-david register` is NOT needed for deletion — CapCut drops missing entries; or leave it for David to delete in CapCut UI).

- [ ] **Step 6: Docs (new worktree or same ship)**
  - `Shared/ENGINE-FACTS.md`: update the bi-engine bullet — prod is now mono-engine (capcut-david >= 2.1.0); cutcli remains ONLY for the legacy skill `1_CapCut-Draft-Builder`.
  - `SKILLS MAP.md`: capcut-david badge → v2.1.0 + one-line changelog.
  - Memory note `~/.claude/projects/.../memory/`: update/create `batch-media-2.1.0-progress.md` with final state; update `MEMORY.md` index.

- [ ] **Step 7: Final acceptance sweep** (spec criteria)

```bash
grep -rn "cutcli" <vault>/Shared/montage-tools/*.py        # → zero hits
npm view capcut-cli-david dist-tags.latest                  # → 2.1.0
capcut-david --help | grep -c -- --batch                    # → >= 3
```

---

## Self-Review Notes

- **Spec coverage:** init dims (T1), add-video --batch + volume + photo (T2), add-audio --batch (T3), add-keyframe --batch (T4), oracle (T2 step 1 + per-verb tests), release v2.1.0 (T5), require_batch_media + default_projects_root (T6), build_montage schema (T7), assemble_draft cutover + gate removal (T8), add_sfx cutover (T9), A/B + hard cutover + docs + acceptance (T10). All spec sections mapped.
- **Known adaptation points (flagged in-task, not placeholders):** exact dispatch shape at index.ts add-video/add-audio branches; addAudio segment literal for the volume line; old kf payload grouping (T8 step 4 reads it first); `assemble_draft.py` slug-override flag name (T10 step 2). Each has the exact line to read and the target behavior specified.
- **Type consistency:** `readBatchItems` (create.ts) reused by keyframe.ts; output keys `segment_ids/material_ids/track_ids/count` uniform across T2/T3; `BATCH_MARKER`/`require_batch_media` names match between T5's help text and T6's gate.
