# CapCut `draft_content.json` — Schema Reference

The single source of truth for the JSON document that `capcut-cli-david` reads, writes, and edits. Every CapCut / Jianying timeline — clips, captions, keyframes, transitions, stickers, masks, effects, filters — lives inside `draft_content.json`. This reference describes the shape `capcut-cli-david` must support.

The schema was reverse-engineered from **nine real drafts**: five produced by `cutcli` (CapCut 167.x) and four targeted CapCut-UI captures (169.x) used to close the open questions left after the first pass. See [Sources](#sources) below.

> ⚠ **Conventions used throughout:**
> - Time values are **microseconds** (1 s = 1 000 000 μs).
> - Coordinates are **normalised, center-origin**, range `[-1, 1]`, Y up.
> - IDs are **UUID-4**; `capcut-cli-david` emits lowercase but accepts either casing on read.
> - Numeric ranges (filter intensity, mask geometry, etc.) are documented per-section.

---

## Table of contents

| # | File | Covers |
|---|---|---|
| 00 | [Overview](./00-overview.md) | Draft folder layout, top-level shape, ID rules, schema versioning, common pitfalls, glossary |
| 01 | [Tracks & segments](./01-tracks-and-segments.md) | 6 track types, 49-field segment shape, `extra_material_refs` ordering, per-type defaults |
| 02 | [Materials](./02-materials.md) | `videos`, `audios`, `texts` (+ embedded styling JSON for keyword highlight), peripheral materials |
| 03 | [Keyframes & animations](./03-keyframes-and-animations.md) | `common_keyframes`, property-type enum, Bezier graph list, Ken Burns example, `material_animations` for text/sticker |
| 04 | [Effects, filters, stickers](./04-effects-filters-stickers.md) | Stickers, transitions, masks, filters (CapCut UI vs cutcli routing), `video_effects` |
| 05 | [Version differences](./05-version-differences.md) | CapCut 167.x vs 169.x deltas, JianYing status, OS paths, forward-compat strategy |

---

## How to use this reference

**Implementing a new command?** Read `00-overview.md` first, then the section that covers the structure you're touching. Each section ends with a "Rules summary" that lists the invariants the port must honour.

**Reading a draft?** The port's read path is **liberal** — accept any field, preserve verbatim, gate behaviour on field presence (not on version numbers). See `05-version-differences.md` §5.

**Writing a draft?** The port's write path is **conservative** — preserve all unknown fields, never bump `version`, default to cutcli shape on `create`. See `05-version-differences.md` §5.

**Building a new fixture?** All fixtures live in [`../../test-fixtures/fixtures/`](../../test-fixtures/) and must be anonymised via `anonymize.py` before commit. See `test-fixtures/README.md`.

---

## TypeScript surface

Each numbered file carries TypeScript interfaces inline. The composite shape:

```ts
import type { Draft } from "./00-overview";          // top-level
import type { Track, Segment } from "./01-tracks-and-segments";
import type {
  VideoMaterial, AudioMaterial, TextMaterial,
  Canvas, Speed, PlaceholderInfo, SoundChannelMapping,
  MaterialColor, Loudness, VocalSeparation,
} from "./02-materials";
import type {
  KeyframeGroup, Keyframe, KeyframeGraphRef,
  MaterialAnimation, Animation,
} from "./03-keyframes-and-animations";
import type {
  StickerMaterial, Transition, Mask,
  FilterMaterial, VideoEffect, AdjustParam,
} from "./04-effects-filters-stickers";
```

When the port lands in `src/draft.ts`, these interfaces are re-exported from a single barrel so callers see one cohesive type tree.

---

## Sources

The schema was extracted from these real drafts (anonymised copies in `test-fixtures/fixtures/`):

| Fixture | Source | Covers |
|---|---|---|
| `minimal-draft.json` | empty cutcli project | top-level shape baseline |
| `ken-burns-draft.json` | cutcli `paranoia-spiral` | `common_keyframes`, Ken Burns, Bezier graphs |
| `effects-draft.json` | cutcli `test-effect-clean` | `video_effects`, VHS Horror, `adjust_params` |
| `subtitles-draft.json` | cutcli `captions-test` | `texts[]` with full embedded styling |
| `full-psycho-draft.json` | cutcli `paranoia-spiral` | full constellation (81 video + 28 text + 162 keyframes) |
| `animations-draft.json` | CapCut UI 169.x capture | `material_animations` + keyword highlight |
| `stickers-draft.json` | CapCut UI 169.x capture | `materials.stickers[]` + sticker track |
| `transitions-draft.json` | CapCut UI 169.x capture | `materials.transitions[]` + outgoing-segment binding |
| `masks-filters-draft.json` | CapCut UI 169.x capture | `materials.common_mask[]` + `materials.effects[]` + filter routing |

Cross-checked against the official [cutcli LLM docs](https://github.com/guol1nag/cutcli-cookbook) snapshot (2026-05-08).

---

## Maintenance

- **Schema evolves.** When a new fixture surfaces an unknown field, document it in the relevant numbered file, add a row to the §5.4 mismatch table in `05-version-differences.md`, and capture the fixture in `test-fixtures/fixtures/`.
- **Round-trip tests** (in `test/round-trip.test.ts`, planned) read every fixture, write it back, and assert byte-identity. Adding a new fixture also adds a new round-trip test case automatically.
- **JianYing parity** is the largest known gap. When a JianYing draft arrives, capture it as `jianying-draft.json` and document the field-level delta in `05-version-differences.md` §3.
