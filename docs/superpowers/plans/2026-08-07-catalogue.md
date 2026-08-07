# `catalogue` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `catalogue` verb that maintains an append-only, hand-annotatable JSON file recording every CapCut resource (font/effect/filter/transition) ever seen in the drafts library, so a `resource_id` survives deletion of the draft that proved it.

**Architecture:** One new command module (`src/commands/catalogue.ts`) built from four pure functions — `catalogueId` (durable key), `planCatalogueMerge` (append-only merge), `serializeCatalogue` / `parseCatalogue` (byte-stable I/O format) — plus a thin `cmdCatalogue` that does path resolution, scanning and atomic writing. Path discovery lives in a new `src/utils/vault.ts` shared with `scripts/build-ui.mjs`. The scan reuses `extractItems` from `query.ts`, which gets exported.

**Tech Stack:** TypeScript → `tsc` → `dist/`, Node `node:test` + `node:assert/strict`, Biome for lint/format. No runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-08-07-catalogue-design.md` — read it before Task 1. Where this plan and the spec disagree, the spec wins; report the discrepancy rather than guessing.

## Global Constraints

- **Zero runtime dependencies.** Node standard library only. `package.json` has no `dependencies` key and must not gain one.
- **Node ≥ 18** (`engines.node`). No `node:sqlite`, no `Array.prototype.findLast` on the hot path, no top-level `await` in `src/`.
- **Never `localeCompare` for persisted ordering.** Codepoint comparison only: `(a, b) => (a < b ? -1 : a > b ? 1 : 0)`. `localeCompare` depends on host locale and ICU build.
- **`note` and `ignored` are human-owned.** No code path may write, clear, reformat or reorder them.
- **A corrupt existing catalogue must exit 2 and write nothing.** Never fall back to an empty catalogue.
- **JSON envelope:** `type: "capcut-david/catalogue@1"`, emitted via `out()` so `--quiet` works.
- **Exit codes:** `0` success including zero changes; `1` usage errors via `die()`; `2` operational (drafts root missing, all drafts unreadable, existing catalogue unparseable, write refused).
- **Comment language follows the file being edited** — `query.ts`/`cli.ts` are English, `capabilities.ts` and `CHANGELOG.md` are French.
- Run `npm run build` before any test run: the test suite imports from `dist/`, not `src/`.
- `npm run lint` is **already red on master** (pre-existing baseline, unrelated files). Do not chase it; only ensure you add no new findings in files you touch. `npm run typecheck` **is** green and must stay green.

---

### Task 1: Vault-root discovery, shared with the build script

**Files:**
- Create: `src/utils/vault.ts`
- Modify: `scripts/build-ui.mjs` (replace its inline anchor walk with an import)
- Test: `test/vault-path.test.mjs`

**Interfaces:**
- Produces:
  - `findVaultRoot(startDir: string): string | null` — nearest ancestor of `startDir` (inclusive) containing BOTH a `Projects/` and a `Shared/` directory, else `null`.
  - `resolveCataloguePath(override: string | undefined, cwd: string): string` — `override` if set; else `<vaultRoot>/Shared/capcut-catalogue.json`; else `<cwd>/capcut-catalogue.json`.

- [ ] **Step 1: Write the failing test**

Create `test/vault-path.test.mjs`:

```js
import { test } from "node:test";
import { strictEqual } from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { findVaultRoot, resolveCataloguePath } from "../dist/utils/vault.js";

// Builds <tmp>/vault/{Projects,Shared} and returns { root, deep } where deep is
// <root>/Projects/proj/repo/src — a path several levels below the anchor.
function makeVault(t) {
  const base = mkdtempSync(join(tmpdir(), "capcut-vault-test-"));
  const root = join(base, "vault");
  mkdirSync(join(root, "Shared"), { recursive: true });
  const deep = join(root, "Projects", "proj", "repo", "src");
  mkdirSync(deep, { recursive: true });
  t.after(() => {
    try {
      rmSync(base, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });
  return { root, deep };
}

test("findVaultRoot: walks up to the ancestor holding Projects/ + Shared/", (t) => {
  const { root, deep } = makeVault(t);
  strictEqual(findVaultRoot(deep), root);
});

test("findVaultRoot: the anchor itself is a valid answer", (t) => {
  const { root } = makeVault(t);
  strictEqual(findVaultRoot(root), root);
});

test("findVaultRoot: null when no ancestor qualifies", (t) => {
  const base = mkdtempSync(join(tmpdir(), "capcut-novault-test-"));
  const deep = join(base, "a", "b");
  mkdirSync(deep, { recursive: true });
  t.after(() => {
    try {
      rmSync(base, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });
  strictEqual(findVaultRoot(deep), null);
});

test("findVaultRoot: Projects/ alone is not enough", (t) => {
  const base = mkdtempSync(join(tmpdir(), "capcut-halfvault-test-"));
  const deep = join(base, "Projects", "x");
  mkdirSync(deep, { recursive: true });
  t.after(() => {
    try {
      rmSync(base, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });
  strictEqual(findVaultRoot(deep), null);
});

test("resolveCataloguePath: --catalogue override wins over everything", (t) => {
  const { deep } = makeVault(t);
  strictEqual(resolveCataloguePath("/tmp/x.json", deep), resolve("/tmp/x.json"));
});

test("resolveCataloguePath: inside a vault → Shared/capcut-catalogue.json", (t) => {
  const { root, deep } = makeVault(t);
  strictEqual(resolveCataloguePath(undefined, deep), join(root, "Shared", "capcut-catalogue.json"));
});

test("resolveCataloguePath: outside a vault → cwd", (t) => {
  const base = mkdtempSync(join(tmpdir(), "capcut-nov2-test-"));
  t.after(() => {
    try {
      rmSync(base, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });
  strictEqual(resolveCataloguePath(undefined, base), join(base, "capcut-catalogue.json"));
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run build && node --test test/vault-path.test.mjs
```

Expected: FAIL — `Cannot find module '../dist/utils/vault.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/utils/vault.ts`:

```ts
import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// The vault root is the nearest ancestor holding BOTH Projects/ and Shared/.
// Anchor-based, never a parents[N] count: a project moving one level deeper
// must not silently retarget the walk.
export function findVaultRoot(startDir: string): string | null {
  let dir = resolve(startDir);
  for (;;) {
    if (isDir(join(dir, "Projects")) && isDir(join(dir, "Shared"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null; // filesystem root reached
    dir = parent;
  }
}

function isDir(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isDirectory();
  } catch {
    return false; // permission denied on an ancestor must not abort the walk
  }
}

// --catalogue wins; else the vault's Shared/; else the current directory.
// The CLI is published on npm, so no vault path is ever hardcoded.
export function resolveCataloguePath(override: string | undefined, cwd: string): string {
  if (override) return resolve(override);
  const vault = findVaultRoot(cwd);
  if (vault) return join(vault, "Shared", "capcut-catalogue.json");
  return join(resolve(cwd), "capcut-catalogue.json");
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run build && node --test test/vault-path.test.mjs
```

Expected: PASS, 7 tests.

- [ ] **Step 5: De-duplicate the walk in the build script**

`scripts/build-ui.mjs` currently ends with an inline `ROOT.split(...).reduce(...)` anchor walk added in commit `ab8bea3`. It runs **after** `tsc`, so it can import the compiled module. Replace the block that starts with the comment `// Miroir vault :` through the end of the file with:

```js
// Miroir vault : cartographie/ garde une copie ouvrable sans passer par le CLI.
// Même ancre que le CLI (dist/utils/vault.js) — une seule implémentation.
// Absente hors du vault (CI, clone nu) → skip.
const { findVaultRoot } = await import(new URL("../dist/utils/vault.js", import.meta.url));
const vault = findVaultRoot(ROOT);
if (vault && existsSync(resolve(vault, "cartographie"))) {
  const mirror = resolve(vault, "cartographie", "capcut-cli-capabilities.html");
  writeFileSync(mirror, html);
  console.log(`build-ui: miroir → ${mirror}`);
}
```

- [ ] **Step 6: Verify the mirror still works**

```bash
npm run build
```

Expected: output contains both `build-ui: dist/ui/index.html (41 verbes, ...)` — 40 until Task 7 registers the verb — and `build-ui: miroir → ...cartographie/capcut-cli-capabilities.html`.

- [ ] **Step 7: Commit**

```bash
git add src/utils/vault.ts test/vault-path.test.mjs scripts/build-ui.mjs
git commit -m "feat(vault): findVaultRoot/resolveCataloguePath, partagés avec build-ui"
```

---

### Task 2: Strip the BOM in the drafts scan

A draft written by PowerShell carries a UTF-8 BOM. `query.ts:246` does a bare `JSON.parse` and swallows the throw at `:248`, so such a draft contributes **zero** items and the inventory silently under-reports. `draft.ts` already solves this; the scan path does not. Fixing it here fixes `query` and `catalogue` at once.

**Files:**
- Modify: `src/commands/query.ts` (the `JSON.parse` inside `cmdQuery`'s draft loop)
- Test: `test/query.test.mjs` (append)

**Interfaces:**
- Produces: `stripBom(text: string): string`, exported from `src/commands/query.ts`, reused by Task 4's scan.

- [ ] **Step 1: Write the failing test**

Append to `test/query.test.mjs`:

```js
test("CLI: a BOM'd draft is scanned, not silently skipped", (t) => {
  const root = makeLib(t, {
    "bom-draft": { raw: `\uFEFF${loadFixtureRaw("transitions-draft")}` },
  });
  const r = runCli(["query", "--all", "--drafts", root]);
  strictEqual(r.status, 0);
  ok(r.json.results.length > 0, "a BOM must not make the draft invisible");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run build && node --test test/query.test.mjs
```

Expected: FAIL — the run exits 2 with `No readable drafts found`, because the single draft failed to parse.

- [ ] **Step 3: Write the implementation**

In `src/commands/query.ts`, add next to the other narrowing helpers:

```ts
// PowerShell-written drafts carry a UTF-8 BOM; a bare JSON.parse throws on it
// and the caller's catch would silently drop the whole draft. draft.ts strips
// it on the load path — the scan path must too.
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
```

Then in `cmdQuery`, change the parse line:

```ts
      draft = JSON.parse(stripBom(readFileSync(file, "utf8")));
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run build && node --test test/query.test.mjs
```

Expected: PASS, 41 tests.

- [ ] **Step 5: Commit**

```bash
git add src/commands/query.ts test/query.test.mjs
git commit -m "fix(query): un BOM ne rend plus un draft invisible au scan"
```

---

### Task 3: The durable key — `catalogueId`

**Files:**
- Create: `src/commands/catalogue.ts`
- Modify: `src/commands/query.ts` (export `extractItems` and its `RawItem` type)
- Test: `test/catalogue-id.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `export type RawItem` and `export function extractItems(draft: unknown): RawItem[]` from `query.ts`. `RawItem` is the existing `Omit<QueryResultItem, "from_drafts">`: `{ kind, name, resource_id, effect_id, category_name, font_path }`.
  - `catalogueId(it: RawItem): string` from `catalogue.ts`.

Key order, from the spec §4: `resource_id` → `effect_id` → `local:<normalized font_path>` (fonts only) → `unresolved:<kind>|<NFC name>`. `kind` is **never** part of a resolved key: the same filter lands in `materials.video_effects` (`kind: effect`) when cutcli wrote it and in `materials.effects` (`kind: filter`) when CapCut UI wrote it.

- [ ] **Step 1: Write the failing test**

Create `test/catalogue-id.test.mjs`:

```js
import { test } from "node:test";
import { strictEqual, notStrictEqual } from "node:assert/strict";

import { catalogueId } from "../dist/commands/catalogue.js";

const item = (over = {}) => ({
  kind: "effect",
  name: "Vignette",
  resource_id: null,
  effect_id: null,
  category_name: null,
  font_path: null,
  ...over,
});

test("resource_id wins", () => {
  strictEqual(catalogueId(item({ resource_id: "739", effect_id: "111" })), "739");
});

test("effect_id is the fallback when resource_id is absent", () => {
  strictEqual(catalogueId(item({ effect_id: "111" })), "111");
});

test("empty-string resource_id is treated as absent", () => {
  strictEqual(catalogueId(item({ resource_id: "", effect_id: "111" })), "111");
});

test("kind is NOT in the key: same filter via both routes → one key", () => {
  const viaCutcli = item({ kind: "effect", resource_id: "670" });
  const viaCapCutUi = item({ kind: "filter", resource_id: "670" });
  strictEqual(catalogueId(viaCutcli), catalogueId(viaCapCutUi));
});

test("local font: key is the normalized path, not the name", () => {
  const a = item({ kind: "font", name: "CC-DerStil", font_path: "C:\\Fonts\\CC-DerStil.ttf" });
  const b = item({ kind: "font", name: "cc-derstil", font_path: "c:/fonts/cc-derstil.TTF" });
  strictEqual(catalogueId(a), "local:c:/fonts/cc-derstil.ttf");
  strictEqual(catalogueId(a), catalogueId(b), "separators and case must not split one font");
});

test("no id at all → unresolved, and two names stay distinct", () => {
  strictEqual(catalogueId(item({ name: "Glitch" })), "unresolved:effect|Glitch");
  notStrictEqual(catalogueId(item({ name: "Glitch" })), catalogueId(item({ name: "Blur" })));
});

test("unresolved names are NFC-normalized so NFD/NFC do not split", () => {
  const nfc = item({ name: "\u00c9cho" }); // É precomposed
  const nfd = item({ name: "E\u0301cho" }); // E + combining acute
  strictEqual(catalogueId(nfc), catalogueId(nfd));
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run build && node --test test/catalogue-id.test.mjs
```

Expected: FAIL — `Cannot find module '../dist/commands/catalogue.js'`.

- [ ] **Step 3: Export the scan primitives from `query.ts`**

In `src/commands/query.ts`, change two declarations to be exported (bodies unchanged):

```ts
export type RawItem = Omit<QueryResultItem, "from_drafts">;
```

```ts
// Extract every catalogue item from ONE draft (from_drafts filled by caller).
export function extractItems(draft: unknown): RawItem[] {
```

- [ ] **Step 4: Write the implementation**

Create `src/commands/catalogue.ts`:

```ts
// Persistent, append-only record of every CapCut resource seen in the drafts
// library. Where `query` is stateless (delete a draft, lose the resource_id),
// this file remembers forever and carries the human's hand-written notes.
// Frozen design: docs/superpowers/specs/2026-08-07-catalogue-design.md
import type { RawItem } from "./query.js";

// Durable identity. NEVER the display name for a resolved entry: CapCut names
// are localized (the same resource_id comes back as "Fade Out" or "渐隐"
// depending on which client wrote the draft), so a name key is a coin flip.
// `kind` is excluded too — it is a routing artifact, not a property of the
// resource: cutcli writes a filter to materials.video_effects (kind "effect"),
// CapCut UI writes it to materials.effects (kind "filter").
export function catalogueId(it: RawItem): string {
  if (it.resource_id) return it.resource_id;
  if (it.effect_id) return it.effect_id;
  if (it.kind === "font" && it.font_path) return `local:${normalizePath(it.font_path)}`;
  return `unresolved:${it.kind}|${nfc(it.name)}`;
}

// Backslashes → slashes and case folded: the same font file must not yield two
// keys because one draft spelled the path differently.
export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase();
}

export function nfc(s: string): string {
  return s.normalize("NFC");
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npm run build && node --test test/catalogue-id.test.mjs
```

Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add src/commands/catalogue.ts src/commands/query.ts test/catalogue-id.test.mjs
git commit -m "feat(catalogue): catalogueId, clé durable sur resource_id||effect_id"
```

---

### Task 4: The append-only merge — `planCatalogueMerge`

This is the correctness core. Every rule here exists because the verification pass reproduced its violation against the compiled code.

**Files:**
- Modify: `src/commands/catalogue.ts`
- Test: `test/catalogue-merge.test.mjs`

**Interfaces:**
- Consumes: `catalogueId`, `normalizePath`, `nfc` (Task 3); `RawItem` (Task 3).
- Produces:

```ts
export interface CatalogueEntry {
  id: string;
  kinds: string[];
  names: string[];
  resource_id: string | null;
  effect_id: string | null;
  font_paths: string[];
  first_seen: string; // YYYY-MM-DD, UTC
  witness_drafts: string[];
  note: string;
  ignored: boolean;
  merged_from: string[];
}

export interface ScannedItem {
  item: RawItem;
  draft: string;
}

export function planCatalogueMerge(
  existing: CatalogueEntry[],
  scanned: ScannedItem[],
  today: string,
): { entries: CatalogueEntry[]; added: string[]; promoted: string[] };
```

`added` holds the ids appended this run; `promoted` holds the abandoned `local:` keys that were folded into a `resource_id` entry. Both sorted by codepoint. The function is **pure**: no I/O, no clock — `today` is injected, exactly like `SyncOptions.nowMs` in `sync-timelines.ts:84`.

- [ ] **Step 1: Write the failing test**

Create `test/catalogue-merge.test.mjs`:

```js
import { test } from "node:test";
import { deepStrictEqual, strictEqual, ok } from "node:assert/strict";

import { planCatalogueMerge } from "../dist/commands/catalogue.js";

const TODAY = "2026-08-07";

const raw = (over = {}) => ({
  kind: "effect",
  name: "Vignette",
  resource_id: null,
  effect_id: null,
  category_name: null,
  font_path: null,
  ...over,
});
const seen = (over, draft = "dA") => ({ item: raw(over), draft });

const entry = (over = {}) => ({
  id: "739",
  kinds: ["effect"],
  names: ["Vignette"],
  resource_id: "739",
  effect_id: null,
  font_paths: [],
  first_seen: "2026-01-01",
  witness_drafts: ["dOld"],
  note: "",
  ignored: false,
  merged_from: [],
  ...over,
});

test("1: unknown id is appended with first_seen = today", () => {
  const r = planCatalogueMerge([], [seen({ resource_id: "739" })], TODAY);
  strictEqual(r.entries.length, 1);
  strictEqual(r.entries[0].first_seen, TODAY);
  deepStrictEqual(r.added, ["739"]);
});

test("2: a known id keeps the human's note verbatim", () => {
  const note = "la seule qui rend bien en 9:16";
  const r = planCatalogueMerge([entry({ note })], [seen({ resource_id: "739" })], TODAY);
  strictEqual(r.entries.length, 1);
  strictEqual(r.entries[0].note, note);
  strictEqual(r.entries[0].first_seen, "2026-01-01", "first_seen is never rewritten");
  deepStrictEqual(r.added, []);
});

test("3: witness_drafts is unioned, deduped and codepoint-sorted", () => {
  const r = planCatalogueMerge(
    [entry({ witness_drafts: ["dB"] })],
    [seen({ resource_id: "739" }, "dA"), seen({ resource_id: "739" }, "dB")],
    TODAY,
  );
  deepStrictEqual(r.entries[0].witness_drafts, ["dA", "dB"]);
});

test("4: a vanished witness draft empties the list but keeps the entry", () => {
  const r = planCatalogueMerge([entry({ witness_drafts: ["dGone"], note: "n" })], [], TODAY);
  strictEqual(r.entries.length, 1);
  deepStrictEqual(r.entries[0].witness_drafts, []);
  strictEqual(r.entries[0].note, "n");
});

test("5: ignored:true is never re-fed, even with a live witness", () => {
  const before = entry({ ignored: true, witness_drafts: [], names: ["Vignette"] });
  const r = planCatalogueMerge([before], [seen({ resource_id: "739", name: "Autre" })], TODAY);
  strictEqual(r.entries.length, 1);
  deepStrictEqual(r.entries[0].witness_drafts, [], "an ignored entry is not re-fed");
  deepStrictEqual(r.entries[0].names, ["Vignette"], "an ignored entry is not renamed");
  deepStrictEqual(r.added, []);
});

test("6: PROMOTION — a local font gaining a resource_id keeps its note", () => {
  const local = entry({
    id: "local:c:/f/cc-derstil.ttf",
    kinds: ["font"],
    names: ["CC-DerStil"],
    resource_id: null,
    font_paths: ["c:/f/cc-derstil.ttf"],
    first_seen: "2026-01-01",
    note: "ne pas confondre avec DerStil Pro",
  });
  const r = planCatalogueMerge(
    [local],
    [seen({ kind: "font", name: "CC-DerStil", resource_id: "745", font_path: "C:\\f\\CC-DerStil.ttf" })],
    TODAY,
  );
  strictEqual(r.entries.length, 1, "one font, one entry");
  const e = r.entries[0];
  strictEqual(e.id, "745");
  strictEqual(e.note, "ne pas confondre avec DerStil Pro");
  strictEqual(e.first_seen, "2026-01-01", "the older first_seen survives");
  deepStrictEqual(e.merged_from, ["local:c:/f/cc-derstil.ttf"]);
  deepStrictEqual(r.promoted, ["local:c:/f/cc-derstil.ttf"]);
});

test("7: one resource_id under two locales → one entry, two names", () => {
  const r = planCatalogueMerge(
    [],
    [seen({ resource_id: "672", name: "Fade Out" }, "en"), seen({ resource_id: "672", name: "渐隐" }, "fr")],
    TODAY,
  );
  strictEqual(r.entries.length, 1);
  strictEqual(r.entries[0].names.length, 2);
  ok(r.entries[0].names.includes("Fade Out"));
});

test("8: empty resource_id but distinct effect_id → two entries, no id lost", () => {
  const r = planCatalogueMerge(
    [],
    [
      seen({ resource_id: "", effect_id: "AAA", name: "Glitch" }),
      seen({ resource_id: "", effect_id: "BBB", name: "Glitch" }),
    ],
    TODAY,
  );
  strictEqual(r.entries.length, 2);
  deepStrictEqual(
    r.entries.map((e) => e.effect_id),
    ["AAA", "BBB"],
  );
});

test("9: one filter seen via both routes → one entry, two kinds", () => {
  const r = planCatalogueMerge(
    [],
    [seen({ kind: "effect", resource_id: "670" }, "cutcli"), seen({ kind: "filter", resource_id: "670" }, "ui")],
    TODAY,
  );
  strictEqual(r.entries.length, 1);
  deepStrictEqual(r.entries[0].kinds, ["effect", "filter"]);
});

test("10: entries are codepoint-sorted by id, and a no-op merge is identical", () => {
  const scan = [seen({ resource_id: "739" }), seen({ resource_id: "111" })];
  const first = planCatalogueMerge([], scan, TODAY);
  deepStrictEqual(
    first.entries.map((e) => e.id),
    ["111", "739"],
  );
  const second = planCatalogueMerge(first.entries, scan, TODAY);
  deepStrictEqual(second.entries, first.entries);
  deepStrictEqual(second.added, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run build && node --test test/catalogue-merge.test.mjs
```

Expected: FAIL — `planCatalogueMerge is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/commands/catalogue.ts`:

```ts
export interface CatalogueEntry {
  id: string;
  kinds: string[];
  names: string[];
  resource_id: string | null;
  effect_id: string | null;
  font_paths: string[];
  first_seen: string; // YYYY-MM-DD, UTC
  witness_drafts: string[];
  note: string;
  ignored: boolean;
  merged_from: string[];
}

export interface ScannedItem {
  item: RawItem;
  draft: string;
}

// Codepoint order. Never localeCompare: its result depends on the host locale
// and the ICU build, so the same catalogue would reorder between this machine
// and CI, destroying the empty-diff guarantee.
const byCodepoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const sortedSet = (values: Iterable<string>): string[] => [...new Set(values)].sort(byCodepoint);

function blank(id: string, today: string): CatalogueEntry {
  return {
    id,
    kinds: [],
    names: [],
    resource_id: null,
    effect_id: null,
    font_paths: [],
    first_seen: today,
    witness_drafts: [],
    note: "",
    ignored: false,
    merged_from: [],
  };
}

// Merge one sighting into an entry. Only ever widens: note, ignored and
// first_seen are untouchable here.
function absorb(e: CatalogueEntry, s: ScannedItem): void {
  const it = s.item;
  e.kinds = sortedSet([...e.kinds, it.kind]);
  e.names = sortedSet([...e.names, nfc(it.name)]);
  e.witness_drafts = sortedSet([...e.witness_drafts, s.draft]);
  if (it.font_path) e.font_paths = sortedSet([...e.font_paths, normalizePath(it.font_path)]);
  if (!e.resource_id && it.resource_id) e.resource_id = it.resource_id;
  if (!e.effect_id && it.effect_id) e.effect_id = it.effect_id;
}

/**
 * Append-only merge. Pure: no I/O, no clock — `today` is injected.
 *
 * Invariants, each one guarding a reproduced failure:
 *  - nothing is ever removed, even when every witness draft is gone;
 *  - `note` / `ignored` / `merged_from` belong to the human and are copied through;
 *  - `ignored` entries are inert: never re-fed, never renamed, never re-added;
 *  - a `local:` font entry that later shows up with a resource_id is PROMOTED
 *    into the id-bearing entry (note and oldest first_seen follow) instead of
 *    spawning a second entry that would orphan the note.
 */
export function planCatalogueMerge(
  existing: CatalogueEntry[],
  scanned: ScannedItem[],
  today: string,
): { entries: CatalogueEntry[]; added: string[]; promoted: string[] } {
  const index = new Map<string, CatalogueEntry>();
  for (const e of existing) index.set(e.id, { ...e, kinds: [...e.kinds], names: [...e.names], font_paths: [...e.font_paths], witness_drafts: [...e.witness_drafts], merged_from: [...e.merged_from] });

  // A witness list is rebuilt from this scan, so clear it on the entries this
  // run can speak for. Ignored entries are inert and keep whatever they had.
  const touched = new Set<string>();
  for (const s of scanned) {
    const id = catalogueId(s.item);
    const e = index.get(id);
    if (e && !e.ignored && !touched.has(id)) {
      e.witness_drafts = [];
      touched.add(id);
    }
  }

  const added: string[] = [];
  const promoted: string[] = [];

  for (const s of scanned) {
    const id = catalogueId(s.item);
    let e = index.get(id);
    if (e?.ignored) continue;
    if (!e) {
      e = blank(id, today);
      index.set(id, e);
      added.push(id);
    }
    absorb(e, s);

    // Promotion: this sighting carries a resource_id, so fold in any local:
    // entry for the same font. Path match first (the file IS the identity),
    // name match as the fallback for a re-downloaded font at a new path.
    if (s.item.resource_id && s.item.kind === "font") {
      const path = s.item.font_path ? normalizePath(s.item.font_path) : null;
      const name = nfc(s.item.name);
      for (const [otherId, other] of index) {
        if (otherId === id || !otherId.startsWith("local:") || other.ignored) continue;
        const samePath = path !== null && (otherId === `local:${path}` || other.font_paths.includes(path));
        const sameName = other.names.includes(name);
        if (!samePath && !sameName) continue;
        e.kinds = sortedSet([...e.kinds, ...other.kinds]);
        e.names = sortedSet([...e.names, ...other.names]);
        e.font_paths = sortedSet([...e.font_paths, ...other.font_paths]);
        e.witness_drafts = sortedSet([...e.witness_drafts, ...other.witness_drafts]);
        if (!e.effect_id && other.effect_id) e.effect_id = other.effect_id;
        if (byCodepoint(other.first_seen, e.first_seen) < 0) e.first_seen = other.first_seen;
        if (!e.note && other.note) e.note = other.note; // the note follows the resource
        e.merged_from = sortedSet([...e.merged_from, ...other.merged_from, otherId]);
        index.delete(otherId);
        promoted.push(otherId);
        const at = added.indexOf(otherId);
        if (at !== -1) added.splice(at, 1);
      }
    }
  }

  const entries = [...index.values()].sort((a, b) => byCodepoint(a.id, b.id));
  return { entries, added: sortedSet(added), promoted: sortedSet(promoted) };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run build && node --test test/catalogue-merge.test.mjs
```

Expected: PASS, 10 tests. If test 10's second assertion fails, the culprit is almost certainly a mutated input array — `planCatalogueMerge` must deep-copy the arrays it inherits from `existing`, which the `index.set` line above does.

- [ ] **Step 5: Commit**

```bash
git add src/commands/catalogue.ts test/catalogue-merge.test.mjs
git commit -m "feat(catalogue): planCatalogueMerge append-only, avec promotion des polices"
```

---

### Task 5: Byte-stable serialization and atomic write

**Files:**
- Modify: `src/commands/catalogue.ts`
- Test: `test/catalogue-io.test.mjs`

**Interfaces:**
- Consumes: `CatalogueEntry` (Task 4).
- Produces:
  - `parseCatalogue(text: string): CatalogueEntry[]` — throws `CliError` on malformed input; **never** returns `[]` as a fallback.
  - `serializeCatalogue(entries: CatalogueEntry[]): string`
  - `writeCatalogueAtomic(path: string, text: string): void`

- [ ] **Step 1: Write the failing test**

Create `test/catalogue-io.test.mjs`:

```js
import { test } from "node:test";
import { strictEqual, throws, deepStrictEqual } from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseCatalogue, serializeCatalogue, writeCatalogueAtomic } from "../dist/commands/catalogue.js";

const entry = (over = {}) => ({
  id: "739",
  kinds: ["effect"],
  names: ["Vignette"],
  resource_id: "739",
  effect_id: null,
  font_paths: [],
  first_seen: "2026-01-01",
  witness_drafts: ["dA"],
  note: "",
  ignored: false,
  merged_from: [],
  ...over,
});

function tmp(t) {
  const dir = mkdtempSync(join(tmpdir(), "capcut-cat-io-"));
  t.after(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });
  return dir;
}

test("round-trip is byte-identical", () => {
  const text = serializeCatalogue([entry()]);
  deepStrictEqual(parseCatalogue(text), [entry()]);
  strictEqual(serializeCatalogue(parseCatalogue(text)), text);
});

test("output ends with exactly one newline", () => {
  const text = serializeCatalogue([entry()]);
  strictEqual(text.endsWith("}\n"), true);
  strictEqual(text.endsWith("\n\n"), false);
});

test("a BOM and CRLF on read do not change the parsed value", () => {
  const text = serializeCatalogue([entry()]);
  const hostile = `\uFEFF${text.replace(/\n/g, "\r\n")}`;
  deepStrictEqual(parseCatalogue(hostile), parseCatalogue(text));
});

test("malformed JSON THROWS — it must never degrade to an empty catalogue", () => {
  throws(() => parseCatalogue("{ this is not json"), /catalogue/i);
});

test("valid JSON of the wrong shape also throws", () => {
  throws(() => parseCatalogue('{"type":"capcut-david/catalogue@1"}'), /catalogue/i);
  throws(() => parseCatalogue("[]"), /catalogue/i);
});

test("an empty catalogue is a legal round-trip", () => {
  deepStrictEqual(parseCatalogue(serializeCatalogue([])), []);
});

test("writeCatalogueAtomic writes the bytes and leaves no .tmp behind", (t) => {
  const dir = tmp(t);
  const p = join(dir, "capcut-catalogue.json");
  const text = serializeCatalogue([entry()]);
  writeCatalogueAtomic(p, text);
  strictEqual(readFileSync(p, "utf-8"), text);
  strictEqual(readFileSync(p, "utf-8").includes("\r\n"), false, "must write LF, never CRLF");
  throws(() => readFileSync(`${p}.tmp`, "utf-8"));
});

test("writeCatalogueAtomic overwrites an existing file", (t) => {
  const dir = tmp(t);
  const p = join(dir, "capcut-catalogue.json");
  writeFileSync(p, "old");
  const text = serializeCatalogue([entry()]);
  writeCatalogueAtomic(p, text);
  strictEqual(readFileSync(p, "utf-8"), text);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run build && node --test test/catalogue-io.test.mjs
```

Expected: FAIL — `parseCatalogue is not a function`.

- [ ] **Step 3: Write the implementation**

Add these imports at the top of `src/commands/catalogue.ts`:

```ts
import { renameSync, writeFileSync } from "node:fs";
import { die } from "../utils/cli.js";
```

Append:

```ts
const ENVELOPE = "capcut-david/catalogue@1";

/**
 * Parse an existing catalogue. THROWS on anything it does not recognize.
 *
 * This is the most important rule in the feature: a truncated write or a bad
 * hand-edit must stop the run, not silently reset the file. `note` is the only
 * datum here that nobody can regenerate.
 */
export function parseCatalogue(text: string): CatalogueEntry[] {
  const clean = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trim();
  if (clean === "") return [];
  let data: unknown;
  try {
    data = JSON.parse(clean);
  } catch (e) {
    die(`catalogue illisible (JSON invalide) : ${(e as Error).message}. Aucune écriture effectuée.`);
  }
  const rec = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  if (!rec) die("catalogue illisible : racine JSON inattendue (objet attendu). Aucune écriture effectuée.");
  if (rec.type !== ENVELOPE) die(`catalogue illisible : type "${String(rec.type)}" (attendu "${ENVELOPE}").`);
  if (!Array.isArray(rec.entries)) die("catalogue illisible : champ `entries` absent ou non-tableau.");
  return rec.entries.map((raw, i) => normalizeEntry(raw, i));
}

function normalizeEntry(raw: unknown, i: number): CatalogueEntry {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!r || typeof r.id !== "string" || r.id === "") die(`catalogue illisible : entrée #${i} sans \`id\`.`);
  const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const strOrNull = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
  return {
    id: r.id as string,
    kinds: strArr(r.kinds),
    names: strArr(r.names),
    resource_id: strOrNull(r.resource_id),
    effect_id: strOrNull(r.effect_id),
    font_paths: strArr(r.font_paths),
    first_seen: typeof r.first_seen === "string" ? r.first_seen : "",
    witness_drafts: strArr(r.witness_drafts),
    note: typeof r.note === "string" ? r.note : "",
    ignored: r.ignored === true,
    merged_from: strArr(r.merged_from),
  };
}

export function serializeCatalogue(entries: CatalogueEntry[]): string {
  return `${JSON.stringify({ type: ENVELOPE, entries }, null, 2)}\n`;
}

/**
 * Same-directory tmp + rename: the rename is atomic on one volume, so a crash
 * mid-write can never leave a truncated catalogue. On Windows the rename can
 * lose to Obsidian or a sync client holding the file — retry once, then fail
 * loudly. Never degrade to a direct (truncating) write.
 */
export function writeCatalogueAtomic(path: string, text: string): void {
  const tmpPath = `${path}.tmp`;
  writeFileSync(tmpPath, text, "utf-8");
  try {
    renameSync(tmpPath, path);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") throw e;
    try {
      renameSync(tmpPath, path);
    } catch {
      die(`catalogue verrouillé (${code}) : ${path}. Ferme Obsidian ou ton client de synchro et relance.`);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run build && node --test test/catalogue-io.test.mjs
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/commands/catalogue.ts test/catalogue-io.test.mjs
git commit -m "feat(catalogue): sérialisation stable + écriture atomique, illisible => throw"
```

---

### Task 6: The command — `cmdCatalogue`, flags, dispatch, registry

**Files:**
- Modify: `src/commands/catalogue.ts` (add `cmdCatalogue`)
- Modify: `src/utils/cli.ts` (`Flags`: add `sync?: boolean; catalogue?: string;`)
- Modify: `src/index.ts` (parse the two flags, import and dispatch the verb)
- Modify: `src/capabilities.ts` (register the verb)
- Test: `test/catalogue-cli.test.mjs`

**Interfaces:**
- Consumes: everything from Tasks 1, 3, 4, 5.
- Produces: `cmdCatalogue(flags: Flags): number` — returns the process exit code.

- [ ] **Step 1: Write the failing test**

Create `test/catalogue-cli.test.mjs`:

```js
import { test } from "node:test";
import { strictEqual, ok } from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runCli } from "./helpers/spawn-cli.mjs";
import { loadFixtureRaw } from "./helpers/load-fixture.mjs";

function makeLib(t, drafts) {
  const root = mkdtempSync(join(tmpdir(), "capcut-cat-cli-"));
  for (const [name, fixture] of Object.entries(drafts)) {
    const sub = join(root, name);
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, "draft_content.json"), loadFixtureRaw(fixture));
  }
  t.after(() => {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });
  return root;
}

const catPath = (t) => {
  const dir = mkdtempSync(join(tmpdir(), "capcut-cat-file-"));
  t.after(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });
  return join(dir, "capcut-catalogue.json");
};

test("11: a corrupt catalogue → exit 2, file untouched on disk", (t) => {
  const root = makeLib(t, { d1: "transitions-draft" });
  const cat = catPath(t);
  writeFileSync(cat, "{ not json");
  const r = runCli(["catalogue", "--sync", "--drafts", root, "--catalogue", cat]);
  strictEqual(r.status, 2);
  strictEqual(readFileSync(cat, "utf-8"), "{ not json", "the corrupt file must survive untouched");
  strictEqual(existsSync(`${cat}.tmp`), false);
});

test("12: --dry-run reports without writing", (t) => {
  const root = makeLib(t, { d1: "transitions-draft" });
  const cat = catPath(t);
  const r = runCli(["catalogue", "--sync", "--dry-run", "--drafts", root, "--catalogue", cat]);
  strictEqual(r.status, 0);
  ok(r.json.added.length > 0, "it must still report what it would add");
  strictEqual(existsSync(cat), false, "--dry-run writes nothing");
});

test("13a: --catalogue without a value → exit 1", (t) => {
  const root = makeLib(t, { d1: "transitions-draft" });
  const r = runCli(["catalogue", "--drafts", root, "--catalogue"]);
  strictEqual(r.status, 1);
});

test("13b: --catalogue=<x> is refused → exit 1", (t) => {
  const root = makeLib(t, { d1: "transitions-draft" });
  const r = runCli(["catalogue", "--drafts", root, "--catalogue=/tmp/x.json"]);
  strictEqual(r.status, 1);
});

test("14: --kind filters the listing", (t) => {
  const root = makeLib(t, { d1: "transitions-draft" });
  const cat = catPath(t);
  runCli(["catalogue", "--sync", "--drafts", root, "--catalogue", cat]);
  const r = runCli(["catalogue", "--kind", "transition", "--catalogue", cat]);
  strictEqual(r.status, 0);
  ok(r.json.entries.length > 0);
  ok(r.json.entries.every((e) => e.kinds.includes("transition")));
});

test("15: a drafts root under test-fixtures/ refuses to write → exit 2", (t) => {
  const cat = catPath(t);
  const fixtures = join(process.cwd(), "test-fixtures", "fixtures");
  const r = runCli(["catalogue", "--sync", "--drafts", fixtures, "--catalogue", cat]);
  strictEqual(r.status, 2);
  strictEqual(existsSync(cat), false);
});

test("16: sync is idempotent — the second run is byte-identical and adds nothing", (t) => {
  const root = makeLib(t, { d1: "transitions-draft" });
  const cat = catPath(t);
  const first = runCli(["catalogue", "--sync", "--drafts", root, "--catalogue", cat]);
  strictEqual(first.status, 0);
  const bytes = readFileSync(cat, "utf-8");
  const second = runCli(["catalogue", "--sync", "--drafts", root, "--catalogue", cat]);
  strictEqual(second.status, 0);
  strictEqual(readFileSync(cat, "utf-8"), bytes, "a no-op sync must produce an empty git diff");
  strictEqual(second.json.added.length, 0);
});

test("17: a hand-written note survives a re-sync", (t) => {
  const root = makeLib(t, { d1: "transitions-draft" });
  const cat = catPath(t);
  runCli(["catalogue", "--sync", "--drafts", root, "--catalogue", cat]);
  const doc = JSON.parse(readFileSync(cat, "utf-8"));
  doc.entries[0].note = "ma note à moi";
  writeFileSync(cat, `${JSON.stringify(doc, null, 2)}\n`);
  runCli(["catalogue", "--sync", "--drafts", root, "--catalogue", cat]);
  const after = JSON.parse(readFileSync(cat, "utf-8"));
  strictEqual(after.entries[0].note, "ma note à moi");
});

test("18: listing a missing catalogue is empty and exit 0, and creates nothing", (t) => {
  const cat = catPath(t);
  const r = runCli(["catalogue", "--catalogue", cat]);
  strictEqual(r.status, 0);
  strictEqual(r.json.entries.length, 0);
  strictEqual(existsSync(cat), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run build && node --test test/catalogue-cli.test.mjs
```

Expected: FAIL — every case, because `catalogue` is not a known verb.

- [ ] **Step 3: Add the two flags**

In `src/utils/cli.ts`, inside `interface Flags`, next to `all?: boolean;`:

```ts
  sync?: boolean;
  catalogue?: string;
```

In `src/index.ts`, in `parseFlags`, right after the `--all` branch added in 2.6.0:

```ts
    } else if (a === "--sync") {
      flags.sync = true;
    } else if (a === "--catalogue" || a.startsWith("--catalogue=")) {
      // parseFlags does not reject unknown flags — anything unmatched becomes a
      // positional. Without this guard a typo'd --catalog would be ignored and
      // the sync would write to the anchor-resolved default path instead.
      if (a !== "--catalogue") die(`--catalogue takes a space-separated value (use --catalogue <path>), got "${a}"`);
      if (i + 1 >= args.length) die("--catalogue requires a value (e.g. --catalogue ./capcut-catalogue.json)");
      flags.catalogue = args[++i];
```

- [ ] **Step 4: Write `cmdCatalogue`**

Add these imports to `src/commands/catalogue.ts`:

```ts
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { defaultProjectsRoot } from "../utils/capcut-paths.js";
import { isCapCutRunning } from "../utils/capcut-guard.js";
import { die, type Flags, out } from "../utils/cli.js";
import { extractItems, stripBom } from "./query.js";
```

(Fold the `renameSync`/`writeFileSync`/`die` imports from Task 5 into this one line rather than importing twice.)

Append:

```ts
const KINDS = new Set(["effect", "filter", "transition", "font"]);

function scanDrafts(root: string): { scanned: ScannedItem[]; draftCount: number } {
  const scanned: ScannedItem[] = [];
  let draftCount = 0;
  for (const dirent of readdirSync(root, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const file = join(root, dirent.name, "draft_content.json");
    if (!existsSync(file)) continue;
    let draft: unknown;
    try {
      draft = JSON.parse(stripBom(readFileSync(file, "utf8")));
    } catch {
      continue; // unreadable draft: skip, keep scanning
    }
    draftCount++;
    for (const item of extractItems(draft)) scanned.push({ item, draft: dirent.name });
  }
  return { scanned, draftCount };
}

// Returns the process exit code. 0 success (incl. nothing new), 2 operational.
export function cmdCatalogue(flags: Flags): number {
  if (flags.kind && !KINDS.has(flags.kind)) {
    die(`Invalid --kind '${flags.kind}'. Expected one of: effect, filter, transition, font.`);
  }
  const cataloguePath = resolveCataloguePath(flags.catalogue, process.cwd());

  let entries: CatalogueEntry[] = [];
  if (existsSync(cataloguePath)) {
    // parseCatalogue throws (exit 1 via CliError) rather than resetting the file.
    entries = parseCatalogue(readFileSync(cataloguePath, "utf-8"));
  }

  let added: string[] = [];
  let promoted: string[] = [];

  if (flags.sync) {
    const root = flags.drafts ?? defaultProjectsRoot();
    if (!existsSync(root) || !statSync(root).isDirectory()) {
      process.stderr.write(`${JSON.stringify({ error: `Drafts root not found: ${root}` })}\n`);
      return 2;
    }
    // The repo lives UNDER the vault, so the anchor walk from `node --test`
    // resolves to the real catalogue. Fixture data must never reach it.
    if (`${root}${sep}`.includes(`${sep}test-fixtures${sep}`)) {
      process.stderr.write(
        `${JSON.stringify({ error: "Refusing to sync from a test-fixtures/ drafts root." })}\n`,
      );
      return 2;
    }
    const { scanned, draftCount } = scanDrafts(root);
    if (draftCount === 0) {
      process.stderr.write(`${JSON.stringify({ error: `No readable drafts found under: ${root}` })}\n`);
      return 2;
    }
    // CapCut holds the draft in memory and only flushes on save/close: a sync
    // run seconds after applying an effect captures nothing, and the user would
    // conclude the catalogue is complete.
    if (!flags.quiet && isCapCutRunning()) {
      process.stderr.write("[warn] CapCut est ouvert : sauvegarde le draft avant de synchroniser.\n");
    }
    const plan = planCatalogueMerge(entries, scanned, todayUtc());
    entries = plan.entries;
    added = plan.added;
    promoted = plan.promoted;
    if (!flags.dryRun) writeCatalogueAtomic(cataloguePath, serializeCatalogue(entries));
  }

  const shown = flags.kind ? entries.filter((e) => e.kinds.includes(flags.kind as string)) : entries;
  if (flags.human) {
    renderCatalogueHuman(shown, flags);
    return 0;
  }
  out(
    { type: ENVELOPE, path: cataloguePath, dry_run: flags.dryRun === true, added, promoted, entries: shown },
    flags,
  );
  return 0;
}

// UTC, not local: a reproducible field in tests and identical on every machine.
// Cost: a sync at 00:30 CET is stamped with the previous day.
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function renderCatalogueHuman(entries: CatalogueEntry[], flags: Flags): void {
  if (flags.quiet) return;
  if (entries.length === 0) {
    console.log("Catalogue vide.");
    return;
  }
  const rows = entries.map((e) => ({
    kinds: e.kinds.join(","),
    name: e.names.join(" / "),
    id: e.id,
    seen: e.first_seen,
    note: e.ignored ? "(ignorée)" : e.note,
  }));
  const w = (key: keyof (typeof rows)[0], min: number) => Math.max(min, ...rows.map((r) => r[key].length));
  const wk = w("kinds", 5);
  const wn = w("name", 4);
  const wi = w("id", 2);
  const pad = (s: string, n: number) => s.padEnd(n);
  console.log(`${pad("KINDS", wk)}  ${pad("NAME", wn)}  ${pad("ID", wi)}  FIRST_SEEN  NOTE`);
  for (const r of rows) {
    console.log(`${pad(r.kinds, wk)}  ${pad(r.name, wn)}  ${pad(r.id, wi)}  ${r.seen}  ${r.note}`);
  }
}
```

- [ ] **Step 5: Dispatch the verb**

In `src/index.ts`, add the import next to the other command imports:

```ts
import { cmdCatalogue } from "./commands/catalogue.js";
```

And the dispatch immediately after the `query` block (`catalogue` takes no project path, so it must return before the `if (!projectPath) die(...)` line):

```ts
  if (cmd === "catalogue") {
    process.exit(cmdCatalogue(flags));
  }
```

- [ ] **Step 6: Register the verb**

In `src/capabilities.ts`, in the `decouvrir` category right after the `query` entry:

```ts
  {
    verb: "catalogue",
    category: "decouvrir",
    summary:
      "Mémoire persistante des ressources validées : fige nom + resource_id de chaque police/effet/filtre/transition vue dans un draft, pour qu'ils survivent à la suppression du draft témoin. Append-only, annotable à la main (champs `note` et `ignored`, jamais réécrits). Sans --sync : lecture seule.",
    signature: "catalogue [--kind effect|filter|transition|font] [--sync] [--dry-run] [--drafts <dir>] [--catalogue <path>]",
    flags: [
      { flag: "--sync", desc: "moissonne les drafts et fusionne dans le catalogue", since: "2.6.0" },
      { flag: "--dry-run", desc: "avec --sync : rapporte sans écrire", since: "2.6.0" },
      { flag: "--kind <k>", desc: "restreint à effect | filter | transition | font" },
      { flag: "--catalogue <path>", desc: "chemin du fichier (défaut : <vault>/Shared/capcut-catalogue.json)" },
      { flag: "--drafts <dir>", desc: "root de la bibliothèque de drafts à scanner" },
    ],
    example: "capcut-david catalogue --sync -H",
    readOnly: false,
    capcutClosed: false,
    since: "2.6.0",
  },
```

Do **not** add `catalogue` to `WRITE_COMMANDS` in `src/utils/capcut-guard.ts`. That guard protects *drafts* from CapCut's on-close overwrite; blocking sync while CapCut is open would forbid the exact moment the user wants to capture a resource they just discovered. The `isCapCutRunning()` warning in Step 4 covers the real hazard.

- [ ] **Step 7: Run the new tests**

```bash
npm run build && node --test test/catalogue-cli.test.mjs
```

Expected: PASS, 8 tests.

- [ ] **Step 8: Run the whole suite and typecheck**

```bash
npm run build && npm test 2>&1 | tail -8 && npm run typecheck
```

Expected: all tests pass (552 before this plan + 7 + 1 + 7 + 10 + 8 + 8 = 593), typecheck silent. `test/capabilities.test.mjs` asserts parity between `CAPABILITIES` and the verbs `index.ts` dispatches — if it fails, Step 5 or Step 6 is incomplete.

- [ ] **Step 9: Commit**

```bash
git add src/commands/catalogue.ts src/commands/query.ts src/utils/cli.ts src/index.ts src/capabilities.ts test/catalogue-cli.test.mjs
git commit -m "feat(catalogue): verbe catalogue --sync/--dry-run/--kind/--catalogue"
```

---

### Task 7: Documentation and release notes

**Files:**
- Modify: `CHANGELOG.md` (the `## [Unreleased]` → `### Added` block created for `query --all`)
- Modify: `README.md` (the verb table around line 151)
- Modify: `skills/capcut-david/SKILL.md`

- [ ] **Step 1: Extend the changelog entry**

In `CHANGELOG.md`, under the existing `## [Unreleased]` → `### Added`, add:

```markdown
- `catalogue` — mémoire persistante des ressources validées. Fige nom +
  `resource_id` de chaque police / effet / filtre / transition vue dans un draft,
  dans `<vault>/Shared/capcut-catalogue.json` (résolu par ancre, `--catalogue`
  pour outrepasser, dossier courant hors vault). Append-only : une entrée
  survit à la suppression du draft témoin. Les champs `note` et `ignored` sont
  écrits à la main et ne sont jamais réécrits par un sync. `--sync` moissonne,
  `--dry-run` rapporte sans écrire, `--kind` filtre l'affichage.
  Design : [`docs/superpowers/specs/2026-08-07-catalogue-design.md`](./docs/superpowers/specs/2026-08-07-catalogue-design.md).
```

- [ ] **Step 2: Add the verb to the README table**

In the command table in `README.md` (the block containing the `psycho-build` row around line 151), add a row:

```markdown
| `catalogue [--sync] [--kind <k>] [--dry-run] [--catalogue <path>]` | Mémoire persistante des ressources validées (nom → resource_id), annotable à la main |
```

- [ ] **Step 3: Document the loop in the skill**

In `skills/capcut-david/SKILL.md`, add a short section wherever the read-only/discovery verbs are described:

```markdown
### Retrouver un resource_id

`query <term>|--all` lit les drafts présents à l'instant T. `catalogue` est la
mémoire : elle survit à la suppression du draft témoin.

Boucle : David applique la ressource dans CapCut et **sauvegarde** (CapCut ne
l'écrit sur disque qu'à la sauvegarde) → `capcut-david catalogue --sync` →
l'entrée est figée pour toujours. Consulter avec `catalogue -H`, ou
`catalogue --kind font -H` pour une seule rubrique.

Ne jamais éditer `note` ni `ignored` depuis un agent : ces champs
appartiennent à l'humain, et le hook `no_main_tree_write` du vault bloque de
toute façon un Write/Edit sur ce fichier.
```

- [ ] **Step 4: Verify the docs mention nothing that does not exist**

```bash
npm run build && node dist/index.js catalogue --help 2>&1 | head -3; node dist/index.js --help | grep -A 3 catalogue
```

Expected: the verb appears in `--help` with the signature from Task 6 Step 6.

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md README.md skills/capcut-david/SKILL.md
git commit -m "docs(catalogue): changelog, README, skill"
```

---

### Task 8: Prove it on the real library

Not a code task — the acceptance run. Do this from the canonical vault path, never a worktree (gitignored files and the real drafts root only exist there).

- [ ] **Step 1: Dry-run against the real drafts library**

```bash
node dist/index.js catalogue --sync --dry-run -H
```

Expected: the 3 known resources — `Rubik-Bold` (`7517472189348695297`), `en` (a `local:` id), `Vignette` (`7399463239379209477`) — and no file created.

- [ ] **Step 2: Real sync**

```bash
node dist/index.js catalogue --sync -H
```

Expected: `<vault>/Shared/capcut-catalogue.json` exists with 3 entries.

- [ ] **Step 3: Prove idempotence on real data**

From the vault root:

```bash
node Projects/capcut-cli-david/repo/dist/index.js catalogue --sync
git status --short Shared/capcut-catalogue.json
```

Expected after the second sync: **no output** from `git status` beyond the first run's addition — a no-op sync leaves the bytes untouched.

- [ ] **Step 4: Prove the note survives**

Add a `note` to one entry by hand in Obsidian, re-run `catalogue --sync`, confirm the note is still there and `git diff` shows nothing but the note you typed.

- [ ] **Step 5: Version the file**

```bash
bash tools/vault-session.sh ship-main "catalogue: premier sync"
```

**Run this alone.** A vault hookify rule (`.claude/hookify.block-ship-piped.local.md`) blocks `vault-session.sh ship*` followed by `|` or `&&`.

- [ ] **Step 6: Release decision**

Bumping `package.json` to `2.6.0`, tagging and publishing is **David's call** — the release workflow fires on a tag push and publishes to npm automatically. Do not tag without an explicit go.

---

## Self-Review

**Spec coverage:** §3 location → Task 1. §4 format and `id` order → Task 3 (key) + Task 5 (shape/parse). §5 merge and promotion → Task 4. §6 write, atomicity, sort, BOM/CRLF, test-fixtures guard → Tasks 5 and 6. §7 CLI surface, flag guard, envelope, exits, registry, CapCut warning → Task 6. §8 BOM fix → Task 2. §9 tests 1-15 → Tasks 4 (1-10) and 6 (11-15, plus 16-18 for idempotence, note survival and the missing-file case). §10 non-goals → nothing built for them.

**Deviation from the spec worth flagging at review:** the spec's §6 says "relecture + refusion juste avant le rename" to close the note-loss window. Task 5 implements atomic write but **not** the re-read-and-re-merge. The window is a human saving a note in the seconds a sync takes; the mitigation costs a second parse plus merge. Ship without it, and add it if a note is ever lost — or say so now and it goes into Task 5 Step 3.

**Type consistency:** `CatalogueEntry` / `ScannedItem` / `RawItem` are used identically in Tasks 3-6; `catalogueId`, `normalizePath`, `nfc`, `planCatalogueMerge`, `parseCatalogue`, `serializeCatalogue`, `writeCatalogueAtomic`, `cmdCatalogue`, `findVaultRoot`, `resolveCataloguePath`, `stripBom`, `extractItems` all match between definition and call sites. `ENVELOPE` is defined in Task 5 and used in Task 6's `out()` call — Task 6 must not redeclare it.

**Placeholder scan:** clean.
