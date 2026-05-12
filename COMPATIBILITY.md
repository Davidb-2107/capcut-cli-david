# Compatibility

What `capcut-cli-david` supports, what it doesn't, and how it decides.

> 📌 **Living document.** Last verified: **2026-05-11** against the 9 fixtures in `test-fixtures/fixtures/`. The deep schema deltas live in [`docs/draft-schema/05-version-differences.md`](docs/draft-schema/05-version-differences.md); this page is the compatibility *contract*.

---

## 1 · TL;DR

| Surface | Support level | Notes |
|---|---|---|
| **CapCut 8.x desktop (Windows + macOS)** | ✅ tested | All 9 fixtures captured here; mac `8.2.0`, win `8.5.0`/`8.6.0` |
| **cutcli output (CapCut 8.x emitter)** | ✅ tested | 4 fixtures (`ken-burns`, `effects`, `subtitles`, `full-psycho`, `minimal`) |
| **CapCut UI output (Windows 8.6.0)** | ✅ tested | 4 fixtures (`animations`, `stickers`, `transitions`, `masks-filters`) |
| **CapCut 7.x and earlier (≤ `version: 359999`)** | 🟡 likely-OK, untested | Read path is liberal — no version gate. No fixtures on disk. |
| **CapCut 9.x+ (future)** | 🟡 liberal-read | Unknown fields preserved verbatim; new track types refused on edit. |
| **JianYing 5.x desktop** | 🟡 presumed-OK, untested | Same engine as CapCut; no live fixture. See §5. |
| **JianYing 6.x+ desktop** | ❌ **unsupported** | `draft_content.json` is **encrypted** in JianYing 6+. Plain JSON parse fails. See §5.2. |
| **CapCut Mobile** | ❌ out of scope | Mobile app uses a different storage layout — `draft_content.json` is not the source of truth there. |
| **CapCut Web (capcut.com)** | ❌ out of scope | Web app has its own server-side project format. |
| **Linux** | ❌ no native build | CapCut has no Linux desktop. WSL paths not supported. |

**The contract.** The port reads liberally and writes conservatively. It will open any draft it recognises as JSON-shaped CapCut/JianYing output, preserve unknown fields verbatim, and refuse to mutate structures it doesn't understand. Version numbers are diagnostic — not gating.

---

## 2 · Version identifiers in `draft_content.json`

Every draft carries two version fields at the top level plus a `platform` block:

```jsonc
{
  "version": 360000,             // schema integer — load-time gate (we don't gate)
  "new_version": "167.0.0",      // human string — emitter signal
  "platform": {
    "os": "windows",             // "windows" | "mac"
    "os_version": "10.0.26200",
    "app_id": 359289,            // 359289 = CapCut. JianYing has its own.
    "app_version": "8.6.0",      // CapCut desktop semver
    "app_source": "cc",          // "cc" = CapCut, "jy" = JianYing
    "device_id": "...",
    "hard_disk_id": "...",
    "mac_address": "..."
  },
  "last_modified_platform": { /* same shape — whoever wrote it last */ },
  ...
}
```

### 2.1 · Values observed in the fixture corpus

| Fixture | `version` | `new_version` | `app_source` | `app_id` | `os` | `app_version` |
|---|---|---|---|---|---|---|
| `minimal-draft.json` | `360000` | `167.0.0` | `cc` | `359289` | `windows` | `8.5.0` |
| `ken-burns-draft.json` | `360000` | `167.0.0` | `cc` | `359289` | `mac` | `8.2.0` |
| `effects-draft.json` | `360000` | `169.0.0` | `cc` | `359289` | `mac` | `8.2.0` |
| `subtitles-draft.json` | `360000` | `167.0.0` | `cc` | `359289` | `mac` | `8.2.0` |
| `full-psycho-draft.json` | `360000` | `167.0.0` | `cc` | `359289` | `mac` | `8.2.0` |
| `animations-draft.json` | `360000` | `169.0.0` | `cc` | `359289` | `windows` | `8.6.0` |
| `stickers-draft.json` | `360000` | `169.0.0` | `cc` | `359289` | `windows` | `8.6.0` |
| `transitions-draft.json` | `360000` | `169.0.0` | `cc` | `359289` | `windows` | `8.6.0` |
| `masks-filters-draft.json` | `360000` | `169.0.0` | `cc` | `359289` | `windows` | `8.6.0` |

**Invariants across the corpus:**
- `version: 360000` — the schema-integer constant for CapCut 8.x.
- `app_id: 359289` — CapCut's stable app identifier (JianYing would differ; not yet observed).
- `app_source: "cc"` — CapCut, never JianYing (we don't have a JianYing fixture).
- Top-level key count: **35 keys, identical set across all 9 fixtures.**

**Variation observed:**
- `new_version` splits into two clusters: `"167.0.0"` (cutcli + older CapCut UI) vs `"169.0.0"` (current CapCut UI). See §4.1.
- `app_version` ranges `8.2.0` (mac), `8.5.0`/`8.6.0` (windows) — same `new_version` can come from different `app_version`.
- `os` is `"windows"` or `"mac"` only.

### 2.2 · Schema integer history (best-effort)

| `version` int | CapCut release range | Tested? |
|---|---|---|
| ≤ `359999` | CapCut 7.x and earlier | ❌ — no fixture; assume read-only-safe |
| `360000` | **CapCut 8.x** | ✅ — current corpus |
| `> 360000` | CapCut 9.x+ (hypothetical, not yet released as of 2026-05-11) | 🟡 — liberal-read, warn on save |

CapCut bumps the schema integer infrequently. Between 8.x point releases, `version` stays at `360000` while `new_version` rolls forward (`167` → `168` → `169` …). The integer is the only field we'd treat as a hard load gate — and we explicitly **don't** gate on it, see §6.1.

---

## 3 · Tested compatibility matrix

`✅` = exercised in a real fixture and the port's read/write round-trip is byte-equivalent for that capability.
`🟡` = exercised by inspection only — the port reads it; mutation API is not yet built.
`❌` = explicitly out of scope.
`❓` = unknown — no fixture, no inspection.

| Capability | cutcli (CapCut 167.x) | CapCut UI (169.x) | JianYing 5.x | JianYing 6+ | CapCut Mobile/Web |
|---|---|---|---|---|---|
| Open `draft_content.json` as plain JSON | ✅ | ✅ | ❓ | ❌ encrypted | ❌ not the storage format |
| 35-key top-level shape | ✅ | ✅ | ❓ | ❌ | ❌ |
| 6 track types (`video`, `audio`, `text`, `effect`, `sticker`, `filter`) | ✅ (4 of 6) | ✅ (6 of 6) | ❓ | ❌ | ❌ |
| 49-field segment shape | ✅ | ✅ | ❓ | ❌ | ❌ |
| `extra_material_refs` ordering | ✅ 7 refs | ✅ 6 refs (no `loudnesses`) | ❓ | ❌ | ❌ |
| `extra_material_refs[2]` polymorphic slot (transition/mask) | ❌ unused | ✅ | ❓ | ❌ | ❌ |
| `common_keyframes` (Ken Burns, etc.) | ✅ | ✅ | ❓ | ❌ | ❌ |
| `keyframe_graph_list[]` for `FreeCurveInOut` | ✅ | ✅ | ❓ | ❌ | ❌ |
| `material_animations` (in/out/loop) on text | ✅ | ✅ | ❓ | ❌ | ❌ |
| `material_animations` on sticker | ❌ no fixture | ✅ | ❓ | ❌ | ❌ |
| Filters via `materials.video_effects[]` + `"effect"` track | ✅ | ✅ | ❓ | ❌ | ❌ |
| Filters via `materials.effects[]` + `"filter"` track | ❌ unused | ✅ | ❓ | ❌ | ❌ |
| Masks via `materials.common_mask[]` + `enable_video_mask` | ❌ unused | ✅ | ❓ | ❌ | ❌ |
| UTF-8 (no BOM), Unicode text (CN/AR/emoji) | ✅ | ✅ | ❓ | ❌ | ❌ |
| `##_draftpath_placeholder_...##` token | ✅ | ✅ | ❓ | ❌ | ❌ |
| Windows backslash paths | ✅ | ✅ | ❓ | ❌ | ❌ |
| macOS forward-slash paths | ✅ | ✅ | ❓ | ❌ | ❌ |

Empty cells in JianYing 5.x are presumed-equivalent until a real JianYing fixture proves otherwise.

---

## 4 · CapCut version support

### 4.1 · cutcli emitter (`new_version: "167.0.0"`) vs CapCut UI emitter (`"169.0.0"`)

Two **schema-equivalent but byte-different** writers produce drafts in the wild:

| Delta | cutcli (167.x) | CapCut UI (169.x) | Detection |
|---|---|---|---|
| `loudnesses` material + ref | always emitted (7 refs on plain video segment) | omitted (6 refs) | `emitsLoudnesses(draft)` — see §7 |
| Filter routing | `materials.video_effects[]` + `"effect"` track | `materials.effects[]` + `"filter"` track | `usesUiFilterRoute(draft)` — see §7 |

Both deltas live inside the same `version: 360000` namespace — the schema integer doesn't change, only emitter conventions do. Deep coverage: [`docs/draft-schema/05-version-differences.md`](docs/draft-schema/05-version-differences.md) §2.

**Port rule:** match the source draft's shape on **round-trip**; emit cutcli convention on **create** (preserves interop with the cutcli ecosystem). See §6.2.

### 4.2 · CapCut 4 / 5 / 6 / 7 — older majors

No empirical data. CapCut's desktop app jumped through several major versions before 8.x. The schema integer almost certainly differed (`< 360000`). The port's strategy:

- **Read**: accept any schema integer. If `version < 360000`, log a warning `"older CapCut schema (X) — round-trip behaviour untested"`, then proceed.
- **Write**: never downgrade `version` or `new_version`. The draft saves back with whatever integer it came in with.
- **Edit-then-save on an old schema**: technically permitted, but the user is on their own — we have no fixture coverage.

If a user reports a bug on a `< 360000` draft, the first step is always: **capture the fixture, anonymise it, drop it in `test-fixtures/fixtures/legacy-X.json`** — then we know what we're looking at.

### 4.3 · CapCut 9.x and beyond — future majors

CapCut iterates fast; `new_version` rolled from 167 to 169 within weeks. The next schema-integer bump (`> 360000`) is a question of *when*, not *if*. The port's forward-compat strategy is in §6.

The detection helpers in §7 are written to **not** trip on a new `version` integer — they look at field presence, not version numbers.

---

## 5 · JianYing (剪映) support

### 5.1 · JianYing 5.x — presumed-equivalent

JianYing is ByteDance's domestic-market Chinese app; CapCut is the international rebrand. The two share the underlying engine and (in 5.x and earlier) write to the same JSON schema. Known divergence points:

- `platform.app_source`: `"jy"` instead of `"cc"`.
- `platform.app_id`: different integer (not observed; reportedly the JianYing app id).
- **Resource catalogues** (`resource_id` values for effects, stickers, filters) live in a separate regional asset store — a JianYing draft will reference resource IDs CapCut can't resolve, and vice versa. Resource IDs are otherwise format-equivalent.
- `materials.texts[].font_path` typically points to a Chinese-font path on the user's machine.

The port treats JianYing 5.x drafts as CapCut-shaped on read until a fixture surfaces a real divergence. The maintainer doesn't have JianYing installed; **no live JianYing fixture exists** in this repo as of 2026-05-11.

### 5.2 · JianYing 6.x and later — encrypted, **unsupported**

> ⚠ **Blocker.** Starting with JianYing 6.0, `draft_content.json` is **encrypted on disk**. The cleartext JSON shape that this entire project documents is not present in the file.

This is documented by `pyJianYingDraft` (the canonical third-party JianYing-draft library): "剪映6+版本对`draft_content.json`文件进行了加密" — "JianYing v6+ encrypts the `draft_content.json` file". `pyJianYingDraft` itself only supports unencrypted files.

**Consequence for `capcut-cli-david`:**

- `loadDraft()` on a JianYing-6+ draft will fail at `JSON.parse` with a malformed-JSON error.
- We will **not** ship a decryption layer. Reverse-engineering ByteDance's encryption is out of scope (legal, ethical, and effort-cost reasons; the keys live inside a closed binary).
- The error path is detection + user-friendly explanation, **not** a silent fallback.

The error message we'll surface on a non-JSON read of a `draft_content.json`:

```
✗ Could not parse <path> as JSON.
  This file may be a JianYing 6+ draft, which is encrypted on disk.
  capcut-cli-david only supports CapCut drafts and unencrypted JianYing 5.x drafts.
  Original parse error: <node-error>
```

### 5.3 · Path to closing the JianYing gap

In order of preference, when (if) a contributor with a JianYing install joins:

1. **Capture a real JianYing 5.x draft, anonymise it, drop it in `test-fixtures/fixtures/jianying-5x-draft.json`.** Run the existing fixture suite against it. Whatever fails is the divergence.
2. **Cross-reference `pyJianYingDraft`'s struct definitions** ([github.com/GuanYixuan/pyJianYingDraft](https://github.com/GuanYixuan/pyJianYingDraft)) for any field-name divergence we'd otherwise miss.
3. **Reject JianYing 6+** with the clear error message above — never silently try-and-fail.

JianYing 6+ encryption is tracked as a non-goal, not as TODO. If ByteDance ever publishes the key derivation, revisit.

---

## 6 · Forward-compat strategy

CapCut's schema **will** evolve. Three principles govern every read/write decision.

### 6.1 · Read liberally

1. **No version gate.** `loadDraft()` does **not** check `draft.version === 360000`. Any integer is accepted. Older or newer schemas open.
2. **Unknown fields are opaque.** Read them into the in-memory model as `unknown`, write them back verbatim on save. **Never drop fields the port doesn't recognise.**
3. **Gate features on field presence**, never on version numbers:
   ```ts
   // ✅ correct
   if ((draft.materials.effects?.length ?? 0) > 0) { /* CapCut-UI filter route */ }

   // ❌ wrong
   if (draft.new_version.startsWith("169")) { /* CapCut-UI filter route */ }
   ```

### 6.2 · Write conservatively

1. **Preserve `version` and `new_version` byte-for-byte on every round-trip.** Never bump or downgrade them. The writer that owned the file when we opened it still owns it semantically.
2. **On `create`, emit cutcli shape** (`version: 360000`, `new_version: "167.0.0"`, `loudnesses` present, filters via `video_effects`) — keeps the port interoperable with cutcli's CLI calls and existing pipelines.
3. **Never strip unknown fields.** A future CapCut release that adds `materials.shiny_new_thing[]` should round-trip unchanged through our read → write cycle.

### 6.3 · Edit policy on unknown structures

| Encountered | Edit behaviour |
|---|---|
| Unknown top-level key | Preserve. Surface count in `--verbose`. |
| Unknown material slot (e.g. `materials.shiny_new_thing[]`) | Preserve. `info` command counts it under "unknown materials: 1 type, N items". |
| Unknown `track.type` value | Read the track, refuse to mutate it (`shift`, `speed`, `volume` etc. error with a clear message), preserve on round-trip. |
| Unknown segment field | Preserve. Edit commands operate only on documented fields. |
| Unknown `keyframe.curveType` enum value | Preserve. `add-keyframe --curve <unknown>` is rejected at the CLI parser. |

The fail-soft default: **a draft the port can't fully understand can still be read (for inspection) and round-tripped (read → write unchanged). Only edits to recognised structures are committed.**

### 6.4 · Schema-mismatch warning matrix

| Situation | Port behaviour | Exit code |
|---|---|---|
| `version: 360000`, `app_source: "cc"` — known | Read silently. | 0 |
| `version: 360000`, `app_source: "jy"` | Read with one-line warning `"JianYing 5.x — schema delta presumed equivalent, please report divergences"`. | 0 |
| `version < 360000` | Warn `"older CapCut schema (X) — round-trip behaviour untested"`. Proceed. | 0 |
| `version > 360000` | Warn `"newer CapCut schema (X) — unknown fields will be preserved verbatim"`. Proceed. | 0 |
| File is not valid JSON | Error with the JianYing-6+ hint message (§5.2). Don't proceed. | 2 |
| File is JSON but lacks `tracks` or `materials` | Error `"not a CapCut draft (missing required fields)"`. Don't proceed. | 2 |

---

## 7 · Detection helpers

Inline TypeScript surfaces that `src/draft.ts` will export. All are pure (no side effects), all read-only.

```ts
export interface DraftVersion {
  schemaInt: number;           // draft.version
  human: string;               // draft.new_version
  major: number;               // parsed major from new_version (167 / 169 / ...)
  minor: number;
  patch: number;
  emitter: "cutcli" | "capcut-ui" | "jianying" | "unknown";
  os: "windows" | "mac" | "unknown";
}

/** Diagnostic only — never gate behaviour on this. Use field-presence helpers below. */
export function detectVersion(draft: Pick<Draft, "version" | "new_version" | "platform">): DraftVersion {
  const [maj, min, pat] = (draft.new_version || "0.0.0").split(".").map(n => parseInt(n, 10) || 0);
  const src = draft.platform?.app_source;
  const emitter: DraftVersion["emitter"] =
    src === "jy"          ? "jianying"
    : maj === 167         ? "cutcli"      // cutcli pins to 167.x as of 2026-05-11
    : maj >= 168 && src === "cc" ? "capcut-ui"
    : "unknown";
  const os: DraftVersion["os"] =
    draft.platform?.os === "windows" ? "windows"
    : draft.platform?.os === "mac"    ? "mac"
    : "unknown";
  return { schemaInt: draft.version, human: draft.new_version, major: maj, minor: min, patch: pat, emitter, os };
}

/** Cheapest cutcli-shape signal — does the writer emit the `loudnesses` ref on plain video segments? */
export function emitsLoudnesses(draft: Draft): boolean {
  const loudIds = new Set((draft.materials.loudnesses ?? []).map(l => l.id));
  if (loudIds.size === 0) return false;
  for (const t of draft.tracks) {
    if (t.type !== "video") continue;
    for (const s of t.segments) {
      for (const refId of s.extra_material_refs ?? []) {
        if (loudIds.has(refId)) return true;
      }
    }
  }
  return false;
}

/** Did the writer use the CapCut-UI filter routing (effects[] + filter track)? */
export function usesUiFilterRoute(draft: Draft): boolean {
  return (draft.materials.effects?.length ?? 0) > 0
      || draft.tracks.some(t => t.type === "filter");
}

/** Best-effort identification of the writer for diagnostics only. */
export function identifyWriter(draft: Draft): "cutcli" | "capcut-ui" | "mixed" | "jianying" | "unknown" {
  if (draft.platform?.app_source === "jy") return "jianying";
  const cutcli = emitsLoudnesses(draft);
  const ui     = usesUiFilterRoute(draft);
  if (cutcli && !ui) return "cutcli";
  if (!cutcli && ui) return "capcut-ui";
  if (cutcli && ui)  return "mixed";        // a draft hand-edited by both pipelines
  return "unknown";
}

/** True if the draft looks structurally readable. Use BEFORE edit operations. */
export function isReadableDraft(d: unknown): d is Draft {
  if (!d || typeof d !== "object") return false;
  const draft = d as Record<string, unknown>;
  return Array.isArray(draft.tracks)
      && typeof draft.materials === "object" && draft.materials !== null;
}
```

**Usage pattern.** The CLI's edit commands gate on `identifyWriter()` only for **diagnostics in `--verbose`**, never to refuse an edit. Refusal happens further downstream — on a per-field basis when an unknown enum or unknown track type is encountered.

---

## 8 · OS support

### 8.1 · Drafts root by platform

| OS | Drafts root | Verified |
|---|---|---|
| Windows | `%LOCALAPPDATA%\CapCut\User Data\Projects\com.lveditor.draft\<draftId>` | ✅ confirmed on David's machine |
| macOS | `~/Movies/CapCut/User Data/Projects/com.lveditor.draft/<draftId>` | ✅ inferred from fixture `platform.os: "mac"` + cutcli docs |
| Linux | n/a — CapCut has no native Linux build | — (out of scope) |
| Windows (JianYing) | `%LOCALAPPDATA%\JianyingPro\User Data\Projects\com.lveditor.draft\<draftId>` | 🟡 unverified — public docs only |
| macOS (JianYing) | `~/Movies/JianyingPro/User Data/Projects/com.lveditor.draft/<draftId>` | 🟡 unverified |

`capcut-cli-david` resolves the drafts root in this precedence order:

1. Explicit `--drafts-root <path>` CLI flag (highest).
2. `CAPCUT_DRAFTS_ROOT` environment variable.
3. Platform default from the table above.

**Linux users**: pass `--drafts-root` pointing at a Windows or macOS drafts folder accessed over a network share. The port doesn't care about the host OS — only about what's at the path.

### 8.2 · Path separators inside `draft_content.json`

`materials.videos[].path`, `materials.audios[].path`, and similar string fields use **OS-native separators** at the time the draft was written:

- Windows: `"##_draftpath_placeholder_...##\\Resources\\<uuid>.png"` (escaped backslash in JSON)
- macOS: `"##_draftpath_placeholder_...##/Resources/<uuid>.png"`

The port **preserves the separator from the source draft on round-trip** and emits OS-native separators on `create` (forward slashes on macOS / Linux, backslashes on Windows). The `##_draftpath_placeholder_...##` prefix is location-agnostic — CapCut substitutes it with the live draft folder at load time.

### 8.3 · Font paths

`materials.texts[].font_path` is an **absolute** path to a font file on disk. Examples:

```jsonc
// macOS
"font_path": "/System/Library/Fonts/Supplemental/Helvetica Neue.ttc"
// Windows
"font_path": "C:/Users/.../PlayfairDisplay-VariableFont_wght.ttf"
```

CapCut tolerates a missing font (falls back to its default font, with a typography mismatch). The port preserves font paths verbatim on round-trip; on `create`, the port either accepts an explicit `--font-path` or emits an empty string.

### 8.4 · File encoding

`draft_content.json` is UTF-8 **without BOM**. Both cutcli and CapCut UI emit this. Embedded text content may contain any Unicode (Chinese, Arabic, emoji). The port uses Node's native `JSON.parse` / `JSON.stringify` — no recoding.

Windows note: PowerShell defaults to UTF-16-LE on file write. If a user inspects a draft through `Set-Content` or `Out-File`, they can corrupt the encoding. The port writes through `fs.writeFileSync(filePath, JSON.stringify(...), "utf8")` and never invokes a shell text tool on its own output.

---

## 9 · Rules summary

1. **No load-time version gate.** Any `version` / `new_version` reads.
2. **Preserve `version`, `new_version`, and all unknown fields byte-for-byte on round-trip.**
3. **Emit cutcli shape on `create`** — `version: 360000`, `new_version: "167.0.0"`, `loudnesses` present, filters via `video_effects`.
4. **Gate behaviour on field presence**, never on version numbers.
5. **JianYing 5.x is presumed CapCut-equivalent on read** until a fixture proves otherwise.
6. **JianYing 6+ is unsupported** — encrypted on disk, no decryption layer planned. Detect via JSON-parse failure and surface a clear hint.
7. **CapCut Mobile / Web are out of scope** — `draft_content.json` is not their storage format.
8. **OS support is Windows + macOS**. Linux access is via `--drafts-root` against a mounted share, no native build.
9. **The corpus drives the contract.** Any capability not exercised by a fixture in `test-fixtures/fixtures/` is undocumented promise — treat as best-effort, not contract.

---

## 10 · Maintenance — adding a new tested version

When a new CapCut (or JianYing 5.x) version appears in the wild:

1. Capture a fresh draft from that version — minimum: a `minimal-draft` (empty new project) so we have a reference for the new emitter's defaults.
2. Run it through `test-fixtures/anonymize.py` and drop it in `test-fixtures/fixtures/<descriptive-name>-draft.json`.
3. Verify `version`, `new_version`, `platform.app_version` with the existing inspection: `capcut-david info <fixture>` (when the inspect command lands).
4. Run the `_final_integrity.py` cross-reference validator to confirm the new fixture has no broken refs.
5. Update §2.1 (the fixture table) and §3 (the compatibility matrix) here with the new row.
6. If the new draft surfaces a previously-undocumented field/track/material:
   - Document it in [`docs/draft-schema/`](docs/draft-schema/).
   - Add a delta entry in [`docs/draft-schema/05-version-differences.md`](docs/draft-schema/05-version-differences.md).
   - Update the detection helpers in §7 if its presence is a stable emitter signal.

The version-numbers table in §2.2 also gets a new row; if the schema integer bumped, this is the headline change.

---

## 11 · References

- [`docs/draft-schema/05-version-differences.md`](docs/draft-schema/05-version-differences.md) — deep delta between cutcli (167.x) and CapCut UI (169.x), full schema-mismatch policy.
- [`docs/draft-schema/00-overview.md`](docs/draft-schema/00-overview.md) — folder layout, top-level shape, glossary.
- [`docs/draft-schema/01-tracks-and-segments.md`](docs/draft-schema/01-tracks-and-segments.md) — 6 track types and `extra_material_refs` cases.
- [`test-fixtures/README.md`](test-fixtures/README.md) — fixture catalogue, anonymisation rules.
- [`UPSTREAM.md`](UPSTREAM.md) — sync cadence with `renezander030/capcut-cli` (whose Draft type is fully duck-typed and version-agnostic — same philosophy as this doc).
- External: [pyJianYingDraft](https://github.com/GuanYixuan/pyJianYingDraft) (JianYing-only Python lib; documents the JianYing-6+ encryption boundary).
- External: [pyCapCut](https://github.com/GuanYixuan/pyCapCut) (CapCut-port of pyJianYingDraft, English; companion reference for cross-checks).
