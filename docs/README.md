# capcut-cli-david — Documentation

In-repo documentation for the `capcut-david` CLI. Start with
[`FEATURES.md`](./FEATURES.md) for the map of every verb and sub-system.

## Reference & explainers

| Path | What it covers |
|------|----------------|
| [`FEATURES.md`](./FEATURES.md) | **Feature map** — every verb (43) by category, pipelines, sub-systems, external contracts. Anchored on `src/capabilities.ts` (test-enforced). |
| [`draft-schema/`](./draft-schema/) | Full reverse-engineered reference for CapCut's `draft_content.json` schema (7 files, ~3000 lines) |
| [`engine-explained.md`](./engine-explained.md) | Plain-language ("explain like I'm 5") recap of the whole CLI, versions 1.7 → 1.13 |
| [`validate-fix-explained.md`](./validate-fix-explained.md) | Plain-language walkthrough of `validate --fix` (v1.12.0) and the pitfalls caught before release |
| [`query-explained.md`](./query-explained.md) | Plain-language walkthrough of the `query` catalogue lookup (v1.13.0) |
| [`make-preset-explained.md`](./make-preset-explained.md) | Plain-language walkthrough of the `make-preset` font-preset generator (v1.14.0) |

## Voice calibration (ElevenLabs)

The calibration subsystem lives in its own npm workspace —
[`packages/voice-calibration/`](../packages/voice-calibration/) — including its docs:

| Path | What it covers |
|------|----------------|
| [`packages/voice-calibration/README.md`](../packages/voice-calibration/README.md) | Launch, guarantees, architecture overview |
| [`packages/voice-calibration/docs/calibration-mvp.md`](../packages/voice-calibration/docs/calibration-mvp.md) | User journey, protocol and guarantees of the local calibration MVP |
| [`packages/voice-calibration/docs/calibration-architecture.md`](../packages/voice-calibration/docs/calibration-architecture.md) | Architecture (ports & adapters), HTTP API, storage, execution invariants; what a SaaS evolution replaces |
| [`packages/voice-calibration/docs/elevenlabs-calibration-contract-inventory.md`](../packages/voice-calibration/docs/elevenlabs-calibration-contract-inventory.md) | Observed contract of the Python calibration core (with SHA256 digests of `Shared/voice-calibration/` files) |

## Cascade words & font metrics

| Path | What it covers |
|------|----------------|
| [`cascade-words-font-calibration.md`](./cascade-words-font-calibration.md) | Traceability log of the measured-font work: Rubik factor, POCs (alpha-mask, wrapping), kerning probe results |
| [`plan-2026-08-28-cascade-words-font-metrics.md`](./plan-2026-08-28-cascade-words-font-metrics.md) | Plan for the font-metrics cascade-words iteration |

## Design history (`superpowers/`)

Specs (design) and plans (implementation) per feature, oldest first — historical
record of how each subsystem got built, including decisions later superseded:

| Pair | Feature |
|------|---------|
| [`specs/2026-06-07-make-preset-design.md`](./superpowers/specs/2026-06-07-make-preset-design.md) + [`plans/2026-06-07-make-preset.md`](./superpowers/plans/2026-06-07-make-preset.md) | `make-preset` |
| [`specs/2026-07-13-batch-media-mono-engine-design.md`](./superpowers/specs/2026-07-13-batch-media-mono-engine-design.md) + [`plans/2026-07-13-batch-media-mono-engine.md`](./superpowers/plans/2026-07-13-batch-media-mono-engine.md) | `--batch` modes / mono-engine media |
| [`specs/2026-07-13-capabilities-ui-design.md`](./superpowers/specs/2026-07-13-capabilities-ui-design.md) + [`plans/2026-07-13-capabilities-ui.md`](./superpowers/plans/2026-07-13-capabilities-ui.md) | `ui` capability page |
| [`specs/2026-08-07-catalogue-design.md`](./superpowers/specs/2026-08-07-catalogue-design.md) + [`plans/2026-08-07-catalogue.md`](./superpowers/plans/2026-08-07-catalogue.md) | `catalogue` |
| [`specs/2026-09-02-elevenlabs-corpus-calibration-ui-design.md`](./superpowers/specs/2026-09-02-elevenlabs-corpus-calibration-ui-design.md) + [`plans/2026-09-02-elevenlabs-corpus-calibration-ui.md`](./superpowers/plans/2026-09-02-elevenlabs-corpus-calibration-ui.md) | calibration UI (incl. the SaaS-migration strategy section) |

| Root plan | Feature |
|------|---------|
| [`plan-2026-07-06-add-audio-draft-rename-fix.md`](./plan-2026-07-06-add-audio-draft-rename-fix.md) | `add-audio` draft rename fix |

## See also

- [`../README.md`](../README.md) — project README (quickstart, compatibility)
- [`../CHANGELOG.md`](../CHANGELOG.md) — release history (Keep a Changelog 1.1, SemVer 2.0)
- The [`capcut-david` Claude skill](../skills/capcut-david/SKILL.md) — recipes and CLI reference for AI assistants
