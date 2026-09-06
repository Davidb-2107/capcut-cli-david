# capcut-cli-david

> One CLI to **build, edit, and inspect** CapCut `draft_content.json` projects — combining `cutcli`'s creation power (keyframes, Ken Burns, animations) with `capcut-cli`'s inspection surface (segments, tracks, SRT export), plus a `psycho-build` YAML pipeline for assembling complete TikTok-format vertical shorts in one command.

[![CI](https://github.com/Davidb-2107/capcut-cli-david/actions/workflows/ci.yml/badge.svg)](https://github.com/Davidb-2107/capcut-cli-david/actions/workflows/ci.yml)
[![Node ≥ 18](https://img.shields.io/node/v/capcut-cli-david.svg)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

## Why this exists

There are two existing tools in this space and each covers half the surface. Rene Zander's [`capcut-cli`](https://github.com/renezander030/capcut-cli) is excellent at **inspecting** existing drafts — segments, tracks, materials, SRT export — but is effectively read-only when it comes to creation primitives. The closed-source `cutcli` Go binary covers the **creation** half — keyframes, Ken Burns, animations, stickers, filters — but offers nothing for inspection or pipelined assembly.

`capcut-cli-david` is the fork that does both. One binary (`capcut-david`), one runtime dependency (fontkit, for font metrics), fully scriptable. On top of the union of those two surfaces, it ships a **`psycho-build`** command that consumes a single YAML manifest (images + audio + captions) and produces a complete TikTok-format (1080×1920) vertical draft — deterministic via `--seed`, ready to open in CapCut.

The audience: anyone scripting CapCut drafts. TikTok creators automating shorts, video automation pipelines, AI-driven video assembly, and Claude Code skills (a bundled [`capcut-david`](./skills/capcut-david/SKILL.md) skill ships in the package).

## Comparison

| Feature | `cutcli` (upstream Go) | `capcut-cli` (renezander030) | **`capcut-cli-david`** |
|---|---|---|---|
| Inspect segments / tracks / materials | ❌ | ✅ | ✅ |
| Export SRT | ❌ | ✅ | ✅ |
| Edit (shift / speed / volume / trim / opacity / set-text) | partial | ✅ | ✅ |
| Add video / audio / text | ✅ | ✅ | ✅ |
| Keyframes (`add-keyframe`, any property) | ✅ (mid-level API) | ❌ | ✅ (CLI flag) |
| Ken Burns (`ken-burns`) | ✅ (manual keyframes) | ❌ | ✅ (one command) |
| Templates (save / apply) | ❌ | ✅ | ✅ |
| Long-form → short (`cut`) | ❌ | ✅ | ✅ |
| Batch JSONL stdin (`batch`) | ❌ | ✅ | ✅ |
| YAML manifest pipeline (`psycho-build`) | ❌ | ❌ | ✅ |
| Test suite | minimal | minimal | **740+ tests, 93%+ coverage** |
| Schema reference docs | partial (zh-CN) | minimal | full (`docs/draft-schema/`) |
| Lint / typecheck / CI matrix | none | none | Biome 2 + tsc + Node 18/20/22 × Ubuntu/macOS/Windows |
| Node version | n/a (Go) | ≥ 18 | ≥ 18 |
| Runtime deps | n/a | minimal | one (fontkit — font metrics) |
| License | unclear | MIT | MIT |

(Rows for `cutcli` reflect the closed-source Go binary's observed output and may be incomplete.)

## Install

The CLI is a private internal engine — it is **not published to npm**. Build from source:

```bash
git clone https://github.com/Davidb-2107/capcut-cli-david.git
cd capcut-cli-david
npm install
npm run build
npm link          # puts `capcut-david` on PATH (or call node dist/index.js)
capcut-david --help
```

Requires Node ≥ 18. Runtime dependency: fontkit (font metrics only).

## Quickstart

### Inspect an existing draft

```bash
capcut-david info ./MyProject -H
capcut-david tracks ./MyProject -H
capcut-david segments ./MyProject --track text
capcut-david export-srt ./MyProject > subs.srt
```

### Add Ken Burns to a still image

```bash
capcut-david add-video ./MyProject ./photo.jpg 0s 4s
# Take the segment id printed above, then:
capcut-david ken-burns ./MyProject <segment-id> --from 1.0 --to 1.15
```

### Build a complete TikTok draft from YAML

```bash
capcut-david psycho-build examples/psycho/manifest.example.yaml \
  --out ./build/my-short \
  --seed 42
```

`--seed` makes the build deterministic — same manifest + same seed → byte-identical draft, so you can diff outputs in CI. See [`examples/psycho/`](./examples/psycho/) for the full manifest example and minimal asset stubs.

A minimal manifest:

```yaml
title: Paranoia Spiral
resolution: { width: 1080, height: 1920 }
fps: 30

images:
  - { path: ./assets/img1.jpg, duration: 3s, ken_burns: { from: 1.0, to: 1.3, curve: ease-out } }
  - { path: ./assets/img2.jpg, duration: 3s, ken_burns: { from: 1.3, to: 1.0, curve: ease-out } }

voice: { path: ./assets/narration.mp3, volume: 1.0 }
music: { path: ./assets/ambient.mp3,   volume: 0.25 }   # statically ducked

captions:
  srt: ./assets/captions.srt
  style: { font_size: 24, color: "#FFD700", align: 0 }
```

### Calibrer une voix ElevenLabs localement

Le parcours local est BYOK : placez la clé dans le fichier `.env` déjà utilisé
par l’environnement (`ELEVENLABS_API_KEY=…`), puis lancez :

```bash
capcut-david calibration-ui --open
```

La clé reste côté backend et n’est jamais envoyée au navigateur. Publiez le
corpus standard avant de préparer une calibration : tous ses textes sont alors
envoyés ensemble au cœur de calibration, dans l’ordre publié. `postproc` est
toujours explicite. Le dry-run est obligatoire et une approbation explicite
est requise avant le run réel facturable.

Le WPM n’est réutilisable qu’après vérification ou mise à jour de la table
Python canonique `Shared/voice-calibration/voice_wpm.json`. Le profil affiché
localement est une projection traçable, pas une seconde source de vérité. L’outil
ou skill `calibrate-voice` reste
l’entrée manuelle/agent et appelle le même outil MCP `calibrate_voice` ; cette
interface est un client supplémentaire, pas un remplacement. Le contrat
effectif est inventorié dans
[`packages/voice-calibration/docs/elevenlabs-calibration-contract-inventory.md`](./packages/voice-calibration/docs/elevenlabs-calibration-contract-inventory.md).

Le gate d’approbation persistant est porté par le cœur Python : il expose les
opérations `propose`, `approve`, `execute`, `get` et `reconcile`, en figeant le
snapshot du corpus, les paramètres, le `postproc`, les digests et l’aperçu du
dry-run avant toute consommation. `run_calibration` reste la source de vérité
des effets de calibration (synthèse audio et écriture WPM), tandis que Node
sert de proxy et ne conserve qu’une projection locale de l’état. L’ancien appel
direct `calibrate_voice` ou la CLI Python peut donc contourner le gate dans le
MVP ; ces surfaces ne doivent pas être exposées comme une frontière de sécurité
sans un durcissement ultérieur.

## Commands

43 verbs across 7 categories (créer / peupler / captions / éditer / animer / réparer / découvrir), plus 3 named pipelines.

- **Full map with one-line summaries**: [`docs/FEATURES.md`](./docs/FEATURES.md) — anchored on `src/capabilities.ts` and test-enforced against the actual dispatch.
- **Interactive**: `capcut-david ui` opens the capability page bundled with the installed version.
- **Per-flag reference**: `capcut-david <verb> --help`.

Families in short: **inspect** (`info`, `tracks`, `segments`, `materials`, `segment`, `material`, `texts`, `export-srt`) · **create** (`init`, `init-meta`, `register`, `psycho-build`, `save-template`, `apply-template`) · **populate** (`add-video`, `add-audio`, `add-text`, `import-captions`, `cascade-words`) · **captions** (`restyle`, `make-preset`, `set-text`) · **edit** (`shift`, `shift-all`, `speed`, `volume`, `trim`, `opacity`, `remove-segment`, `cut`, `batch`) · **animate** (`ken-burns`, `add-keyframe`, `add-effect`, `add-filter`, `add-transition`) · **repair** (`validate`, `sync-timelines`, `gc`) · **discover** (`query`, `catalogue`, `ui`, `calibration-ui`).

## Output modes

JSON (default), human-readable (`-H` / `--human`), quiet (`-q` / `--quiet`).

```bash
capcut-david texts ./project | jq '.[].text'
capcut-david info ./project -H
capcut-david set-text ./project a1b2c3 "Fixed" -q && echo done
```

## Time formats

`1.5s`, `500ms`, `+0.5s`, `-1s`, `1:30`, `0:05.5`. Negative offsets allowed where they make sense (e.g. `shift`).

## IDs

Segment and material IDs are UUIDs. The first 6+ chars work as a prefix match.

## Documentation

- [`docs/FEATURES.md`](./docs/FEATURES.md) — the feature map (every verb, pipelines, sub-systems, external contracts)
- [`docs/draft-schema/`](./docs/draft-schema/) — reverse-engineered reference for CapCut's `draft_content.json` (the JSON Bible)
- [`skills/capcut-david/SKILL.md`](./skills/capcut-david/SKILL.md) — Claude Code skill for AI assistants (recipes + cookbook)
- [`CHANGELOG.md`](./CHANGELOG.md) — release history (Keep a Changelog 1.1, SemVer 2.0)
- [`examples/psycho/`](./examples/psycho/) — Quickstart manifest for the `psycho-build` pipeline

## Compatibility

- **CapCut**: 5.x+ desktop on Windows + macOS. Both the `cutcli`-emitted draft shape (`new_version: 167.x`) and the CapCut-UI-emitted shape (`169.x`) load.
- **JianYing**: 5.x is presumed-equivalent to CapCut 5.x. **JianYing 6+ is unsupported** — the on-disk `draft_content.json` is encrypted; `capcut-david` exits non-zero with a documented error. See `COMPATIBILITY.md` §5.
- **Node**: ≥ 18 (`engines.node` in `package.json`). CI matrix covers Node 18 / 20 / 22 on Ubuntu / macOS / Windows.
- **Runtime deps**: one — `fontkit`, used for OpenType font metrics (cascade-words width measurement).
- **Encoding**: UTF-8 without BOM. Never re-save edited drafts via PowerShell `Out-File` without `-Encoding utf8` — CapCut refuses BOM-prefixed JSON.

## Project status

Current release: **`2.7.0`** (stable) · **`2.8.0` in development** — cascade-words
measured-font metrics + ElevenLabs calibration UI hardening (see
[`CHANGELOG.md`](./CHANGELOG.md)). The historical Phase A–E graduation table
(0.1.0 → 1.0.0, May 2026) lives in the changelog.

Test coverage on `src/commands/*` + `src/draft.ts`: **93%+ lines, 91%+ functions** (CI gate: 80%). 740+ tests across 50 files.

## Contributing

PRs welcome for bug fixes, schema validation, additional fixtures, and portability fixes. For new commands or behavioral changes, open an issue first to discuss scope and the upstream-sync implication.

- Follow [Conventional Commits](https://www.conventionalcommits.org/).
- Run `npm test && npm run lint && npm run typecheck` before submitting.
- Portable bug fixes that apply to upstream `capcut-cli` are landed there too where reasonable — see `UPSTREAM.md` §4 (PR-back policy).

## Acknowledgements

- **[`capcut-cli`](https://github.com/renezander030/capcut-cli)** by [renezander030](https://github.com/renezander030) — the upstream this fork is built on. Provides the inspection surface and the modular draft helpers that everything else extends.
- **`cutcli`** — closed-source Go binary whose draft output informed the schema reverse-engineering and inspired the creation primitives. No code copied; behaviour reproduced from on-disk JSON observation.
- **CapCut** by **ByteDance** — the upstream product. This project is unaffiliated with ByteDance and operates only against locally-stored draft files.

## License

MIT — see [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE).
