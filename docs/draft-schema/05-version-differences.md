# 05 — Version Differences

CapCut, Jianying (剪映, the Chinese sibling), and cutcli all touch `draft_content.json`. They share the same schema integer (`version: 360000` at time of writing) but emit subtly different field sets. This doc enumerates the known deltas and the port's detection / forward-compat strategy.

> 📌 **Status of this document.** Tested deltas: cutcli (CapCut 167.x) vs CapCut UI (169.x) — captured 2026-05-11. **JianYing schema delta: NOT EMPIRICALLY VERIFIED** (the maintainer does not have JianYing installed). See §3 for resolution paths.

---

## 1 · Version identifiers

Every draft carries two version fields at the top level:

```jsonc
{
  "version": 360000,             // schema integer — load-time gate
  "new_version": "167.0.0",      // human version, informational
  ...
}
```

### Observed values

| `version` | `new_version` | Emitter | Source |
|---|---|---|---|
| `360000` | `"167.0.0"` | cutcli (binary on disk as of 2026-05-08) | cutcli output |
| `360000` | `"169.0.0"` | CapCut UI 8.4.x | Point 1b CapCut-UI captures |
| ≤ `359999` | various | older CapCut 7.x / 8.0–8.1 | untested, likely compatible |

### Detection helper

```ts
export interface DraftVersion {
  schemaInt: number;       // draft.version
  human: string;           // draft.new_version
  major: number;           // parsed major from new_version (167 / 169 / ...)
  minor: number;
  patch: number;
  emitter: "cutcli" | "capcut-ui" | "unknown";
}

export function detectVersion(draft: Pick<Draft, "version" | "new_version">): DraftVersion {
  const [maj, min, pat] = draft.new_version.split(".").map(n => parseInt(n, 10) || 0);
  // Heuristic — cutcli pins to 167.x, CapCut UI emits 168.x+ in current builds.
  const emitter: DraftVersion["emitter"] =
    maj === 167 ? "cutcli" : maj >= 168 ? "capcut-ui" : "unknown";
  return { schemaInt: draft.version, human: draft.new_version,
           major: maj, minor: min, patch: pat, emitter };
}
```

> ⚠ The emitter heuristic is fragile — a future cutcli release will likely bump to 168+. Use it for telemetry, NOT for behaviour gating. Gate behaviour on **field presence** instead (see §2.1).

---

## 2 · CapCut 167.x vs 169.x — empirical deltas

Two confirmed differences between cutcli output (CapCut 167.x) and CapCut UI output (169.x):

### 2.1 · `loudnesses` ref in `extra_material_refs`

For a plain video segment (no transition, no mask):

| Emitter | `extra_material_refs` length | `loudnesses[]` ref present? |
|---|---|---|
| cutcli (167.x) | **7** | ✅ at index 5 (or 6 depending on transition/mask slot) |
| CapCut UI (169.x) | **6** | ❌ omitted entirely |

The `materials.loudnesses[]` slot is also missing the corresponding entry in 169.x output.

**Rule:** the port reads both shapes. When **writing**, match the source draft's shape on a round-trip; when **creating fresh**, follow the cutcli convention (emit `loudnesses`) so existing cutcli-aware tooling keeps working. The presence/absence of the `loudnesses` ref is the cheapest detection signal.

```ts
export function emitsLoudnesses(draft: Draft): boolean {
  for (const t of draft.tracks) {
    if (t.type !== "video") continue;
    for (const s of t.segments) {
      // a fresh video segment WITH loudnesses has 7 refs (or 8 with transition/mask)
      // WITHOUT loudnesses has 6 (or 7 with transition/mask)
      // The reliable way: check whether any ref resolves to a loudnesses material.
      for (const refId of s.extra_material_refs) {
        if (draft.materials.loudnesses?.some(l => l.id === refId)) return true;
      }
    }
  }
  return false;
}
```

### 2.2 · Filter routing

cutcli routes filters through `materials.video_effects[]` on an `"effect"` track. CapCut UI routes filters through `materials.effects[]` on a `"filter"` track (see `04-effects-filters-stickers.md` §4). The schema integer is identical — the two routes coexist in the same `version: 360000` namespace.

The port reads both routes and emits to match the source. On `create`, default to cutcli's route (video_effects + effect track) so cutcli's CLI calls still find the data they expect.

---

## 3 · JianYing (剪映) — schema delta status

**Status: not empirically verified.**

JianYing is ByteDance's domestic-market Chinese app; CapCut is the international rebrand. The two share an engine and write to the same `draft_content.json` schema, but historically diverged on:

- Field names with English vs Chinese keys (rare; most are English)
- Default values for `platform.app_source` (`"cc"` for CapCut, `"jy"` for JianYing — observed but unverified for current versions)
- Effect / sticker / animation catalogues — different `resource_id` namespaces because the asset stores are regional

The maintainer of `capcut-cli-david` does not have JianYing installed, so no `jianying-draft.json` fixture exists in `test-fixtures/fixtures/` at the time of this writing.

### 3.1 · Resolution paths

Two paths to close this gap, in order of preference:

1. **Inspect `pyJianYingDraft`** ([github.com/GuanYixuan/pyJianYingDraft](https://github.com/GuanYixuan/pyJianYingDraft)) — an open-source Python library that reads/writes JianYing drafts. Its struct definitions are the authoritative third-party reverse-engineering of the JianYing schema. A side-by-side comparison with this doc would surface the delta without needing a live JianYing install.
2. **Defer to first user-supplied JianYing draft.** Once a real user opens a JianYing draft against `capcut-cli-david`, the read path will surface unknown fields. Treat them as opaque (preserve verbatim) and capture the diff into a fixture.

Until one of those happens, the port assumes JianYing drafts are CapCut-shaped on read. The `extra_info` and `platform` top-level fields are the most likely divergence points.

### 3.2 · Tracking

JianYing delta is tracked in the upstream planning vault (see [project repo](https://github.com/Davidb-2107/capcut-cli-david)) and will land in an in-repo `COMPATIBILITY.md` when resolved.

---

## 4 · OS-specific paths and encoding

### 4.1 · Drafts root

| OS | Drafts root | Verified |
|---|---|---|
| Windows | `%LOCALAPPDATA%\CapCut\User Data\Projects\com.lveditor.draft\<draftId>` | ✅ |
| macOS | `~/Movies/CapCut/User Data/Projects/com.lveditor.draft/<draftId>` | ✅ (`platform.os: "mac"` observed in cutcli output) |
| Linux | n/a — CapCut has no native Linux build | — |

`capcut-cli-david` reads the drafts root from:
1. An explicit `--drafts-root <path>` CLI flag (highest precedence).
2. The `CAPCUT_DRAFTS_ROOT` env var.
3. The default for the running platform (table above).

### 4.2 · Path separators inside `draft_content.json`

```jsonc
// cutcli output on Windows:
"path": "##_draftpath_placeholder_...##\\Resources\\459b78b5-....png"

// CapCut UI output on macOS:
"path": "##_draftpath_placeholder_...##/Resources/459b78b5-....png"
```

Both casings appear in fixtures. The port **preserves the separator from the source draft on round-trip** and emits OS-native separators on `create` (forward slashes on macOS / Linux, backslashes on Windows). The `##_draftpath_placeholder_...##` token is location-agnostic.

### 4.3 · Font paths

`materials.texts[].font_path` is an **absolute** path to a font file on disk. Examples observed:

```jsonc
// macOS
"font_path": "/System/Library/Fonts/Supplemental/Helvetica Neue.ttc"

// Windows
"font_path": "C:/Users/.../PlayfairDisplay-VariableFont_wght.ttf"
```

CapCut tolerates a missing font path (falls back to a default) but the caption renders with the wrong typography. The port preserves the font path verbatim on round-trip. On `create`, the port either accepts an explicit `--font-path` or emits an empty string and lets CapCut use its default.

### 4.4 · File encoding

`draft_content.json` is UTF-8 without BOM. cutcli writes UTF-8; CapCut UI does the same. Embedded text content may contain any Unicode (Chinese, Arabic, emoji) — the port uses Node's native UTF-8 JSON parser without recoding.

---

## 5 · Forward-compat strategy

The schema **will** evolve. CapCut bumps `new_version` on most releases (167 → 168 → 169 visible in the wild within weeks of each other). New fields appear; existing fields rarely change semantics.

### 5.1 · Read path — be liberal

1. **Treat unknown fields as opaque.** Read them into the in-memory model as `unknown`, write them back verbatim on save. Do NOT drop fields the port doesn't recognise.
2. **Do NOT validate** that `version === 360000` on read. Accept any version; warn (but don't fail) on schemas the port hasn't seen.
3. **Gate features on field presence**, not on version numbers. Example: `if (draft.materials.effects?.length > 0) { … } else { … }` — works whether you're reading 167.x or 169.x.

### 5.2 · Write path — be conservative

1. **Preserve `version` and `new_version` byte-for-byte** on every round-trip. Never bump or downgrade them.
2. **On `create`, emit the cutcli shape** (`version: 360000`, `new_version: "167.0.0"`, `loudnesses` present, filters via `video_effects`). This keeps the port interoperable with the cutcli ecosystem.
3. **Never strip fields** the port doesn't understand. If a future CapCut release adds `materials.shiny_new_thing[]`, an in-place round-trip should leave it untouched.

### 5.3 · Detection helpers

```ts
/** Cheapest signal: did the writer emit the `loudnesses` ref on plain video segments? */
export function isCutcliShape(draft: Draft): boolean {
  return emitsLoudnesses(draft);
}

/** Did the writer use the CapCut-UI filter routing (effects[] + filter track)? */
export function usesUiFilterRoute(draft: Draft): boolean {
  return (draft.materials.effects?.length ?? 0) > 0
      || draft.tracks.some(t => t.type === "filter");
}

/** Best-effort identification of the writer for diagnostics only. */
export function identifyWriter(draft: Draft): "cutcli" | "capcut-ui" | "mixed" | "unknown" {
  const cutcli = isCutcliShape(draft);
  const ui     = usesUiFilterRoute(draft);
  if (cutcli && !ui)   return "cutcli";
  if (!cutcli && ui)   return "capcut-ui";
  if (cutcli && ui)    return "mixed";          // a draft hand-edited by both
  return "unknown";
}
```

### 5.4 · Schema-mismatch policy

| Situation | Port behaviour |
|---|---|
| `version: 360000` — known | Read normally. |
| `version < 360000` | Warn (`older schema — round-trip behaviour untested`). Proceed. |
| `version > 360000` | Warn (`newer schema — unknown fields will be preserved`). Proceed. |
| Unknown top-level keys | Preserve verbatim. Surface count in `--verbose`. |
| Unknown material slots | Preserve verbatim. |
| Unknown segment fields | Preserve verbatim. |
| Unknown `track.type` value | Read the track; refuse to mutate it on edit commands; preserve on round-trip. |

The fail-soft default: a draft the port can't fully understand can still be **read** (for inspection) and **round-tripped** (read → write unchanged). Only edits to recognised structures are committed.

---

## 6 · Compatibility matrix

| Feature | cutcli (167.x) | CapCut UI (169.x) | JianYing | Tested? |
|---|---|---|---|---|
| Top-level shape (36 keys) | ✅ | ✅ | ❓ | cutcli + UI |
| 6 track types | video, audio, text, effect | + sticker, filter | ❓ | both empirically |
| `loudnesses` in `extra_material_refs` | always emitted | omitted for unmodified clips | ❓ | both |
| `extra_material_refs[2]` polymorphic slot | not used by cutcli | transition OR mask | ❓ | UI only (Point 1b) |
| `material_animations` (text/sticker in/out/loop) | text only | text + sticker | ❓ | both |
| `common_keyframes` (Ken Burns, etc.) | full support | full support | ❓ | both |
| `keyframe_graph_list[]` for FreeCurveInOut | populated | populated | ❓ | both |
| Top-level `keyframes` 8-bucket holder | always empty | always empty | ❓ | both |
| Filters via `materials.effects[]` + filter track | ❌ (uses video_effects) | ✅ | ❓ | UI only |
| Effects via `materials.video_effects[]` + effect track | ✅ | ✅ | ❓ | both |
| Transitions via outgoing `extra_material_refs[2]` | not used by cutcli | ✅ | ❓ | UI only (Point 1b) |
| Masks via `materials.common_mask[]` + `enable_video_mask` | not used by cutcli | ✅ | ❓ | UI only (Point 1b) |
| Path placeholder token | emitted | emitted | ❓ | both |
| UTF-8 encoding (no BOM) | ✅ | ✅ | ❓ | both |

> ❓ = not empirically verified. The port assumes JianYing matches CapCut UI on read until a fixture proves otherwise.

---

## 7 · Rules summary

1. **Preserve `version` and `new_version` byte-for-byte** on every round-trip.
2. **Emit cutcli shape on `create`** — `version: 360000`, `new_version: "167.0.0"`, `loudnesses` present, filters via `video_effects`.
3. **Read liberally** — accept unknown fields, slots, track types; preserve verbatim.
4. **Gate behaviour on field presence**, never on version numbers.
5. **JianYing parity is presumed** until proven otherwise — the port treats JianYing drafts as CapCut-shaped on read; first divergent fixture closes the gap.
