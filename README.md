# capcut-cli-david

> One CLI to **build, edit, and inspect** CapCut `draft_content.json` projects — combining `cutcli`'s creation power (keyframes, Ken Burns, animations) with `capcut-cli`'s inspection surface (segments, tracks, SRT export), plus a `psycho-build` YAML pipeline for assembling complete TikTok-format vertical shorts in one command.

[![npm version](https://img.shields.io/npm/v/capcut-cli-david.svg)](https://www.npmjs.com/package/capcut-cli-david)
[![CI](https://github.com/Davidb-2107/capcut-cli-david/actions/workflows/ci.yml/badge.svg)](https://github.com/Davidb-2107/capcut-cli-david/actions/workflows/ci.yml)
[![Node ≥ 18](https://img.shields.io/node/v/capcut-cli-david.svg)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

## Why this exists

There are two existing tools in this space and each covers half the surface. Rene Zander's [`capcut-cli`](https://github.com/renezander030/capcut-cli) is excellent at **inspecting** existing drafts — segments, tracks, materials, SRT export — but is effectively read-only when it comes to creation primitives. The closed-source `cutcli` Go binary covers the **creation** half — keyframes, Ken Burns, animations, stickers, filters — but offers nothing for inspection or pipelined assembly.

`capcut-cli-david` is the fork that does both. One binary (`capcut-david`), zero runtime dependencies, fully scriptable. On top of the union of those two surfaces, it ships a **`psycho-build`** command that consumes a single YAML manifest (images + audio + captions) and produces a complete TikTok-format (1080×1920) vertical draft — deterministic via `--seed`, ready to open in CapCut.

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
| Test suite | minimal | minimal | **212 tests, 93%+ coverage** |
| Schema reference docs | partial (zh-CN) | minimal | full (`docs/draft-schema/`) |
| Lint / typecheck / CI matrix | none | none | Biome 2 + tsc + Node 18/20/22 × Ubuntu/macOS/Windows |
| Node version | n/a (Go) | ≥ 18 | ≥ 18 |
| Runtime deps | n/a | minimal | **zero** |
| License | unclear | MIT | MIT |

(Rows for `cutcli` reflect the closed-source Go binary's observed output and may be incomplete.)

## Install

```bash
npm install -g capcut-cli-david
# CLI binary: capcut-david
capcut-david --help
```

Requires Node ≥ 18. Zero runtime dependencies.

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
[`docs/elevenlabs-calibration-contract-inventory.md`](./docs/elevenlabs-calibration-contract-inventory.md).

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

Full index — group by family. For per-flag reference, run `capcut-david <command> --help`.

### Inspect
| Command | Purpose |
|---|---|
| `info <project>` | Draft summary: resolution, fps, duration, track + material counts |
| `tracks <project>` | List tracks with id, type, segment count |
| `materials <project> [--type <t>]` | List materials filtered by type (videos / audios / texts / …) |
| `segments <project> [--track <id>]` | List segments, optionally filtered to one track |
| `segment <project> <id>` | Detailed dump of a single segment |
| `material <project> <id>` | Detailed dump of a single material |
| `texts <project>` | All text segments with their content |
| `export-srt <project>` | Emit captions as SRT to stdout |

### Edit (writes `.bak` before mutating)
| Command | Purpose |
|---|---|
| `set-text <project> <id> "<text>"` | Replace text content of a text segment |
| `shift <project> <id> <±duration>` | Shift a single segment in time |
| `shift-all --offset <±duration> [--track <t>]` | Shift every segment (optionally per-track) |
| `speed <project> <id> <factor>` | Re-time a video/audio segment |
| `volume <project> <id> <0..1>` | Set audio segment volume |
| `trim <project> <id> <start> <end>` | Trim a segment to a sub-range |
| `opacity <project> <id> <0..1>` | Set visual segment opacity |
| `cut <project> <start> <end> --out <file>` | Long-form → short clipping |

### Create
| Command | Purpose |
|---|---|
| `init <name> --drafts <dir>` | Bootstrap an empty draft directory |
| `add-video <project> <path> <start> <end>` | Append a video/image segment |
| `add-audio <project> <path> <start> <end> [--volume]` | Append an audio segment |
| `add-text <project> <start> <end> "<text>" [--font-size --color]` | Append a text segment |
| `save-template <project> <id> <name> --out <file>` | Extract a segment as reusable template |
| `apply-template <project> <template> <start> <end> "<text>"` | Apply a saved template |

### Animate (Phase C)
| Command | Purpose |
|---|---|
| `add-keyframe <project> <id> <time> --property <p> --value <v> [--curve <c>]` | Insert one keyframe on `scale_x`/`scale_y`/`position_x`/`position_y`/`rotation`/`alpha`. Curves: `linear`, `ease-in`, `ease-out`, `ease-in-out`. |
| `ken-burns <project> <id> --from <s> --to <s> [--curve <c>]` | Paired `scale_x` + `scale_y` keyframes from `t=0` to `t=segment.duration`. Default curve `ease-out` (CapCut "Cubic Out"). |

### Batch
| Command | Purpose |
|---|---|
| `batch <project>` | Read JSONL ops on stdin (`{"cmd": "...", ...}`), apply atomically |

### Pipeline (Phase D)
| Command | Purpose |
|---|---|
| `psycho-build <manifest.yaml> [--out <dir>] [--seed <n>]` | Full TikTok-format draft from a YAML manifest |

### Discovery
| Command | Purpose |
|---|---|
| `query <term>\|--all [--kind <k>] [--drafts <dir>]` | Search the drafts library for effects, filters, transitions, fonts (read-only, stateless) |
| `make-preset --font <name\|resource_id> [--out <file>]` | Generate a bare-font restyle preset from a font already used in your drafts |
| `catalogue [--sync] [--kind <k>] [--dry-run] [--catalogue <path>]` | Mémoire persistante des ressources validées (nom → resource_id), annotable à la main |

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

- [`docs/draft-schema/`](./docs/draft-schema/) — reverse-engineered reference for CapCut's `draft_content.json` (the JSON Bible)
- [`skills/capcut-david/SKILL.md`](./skills/capcut-david/SKILL.md) — Claude Code skill for AI assistants (recipes + cookbook)
- [`CHANGELOG.md`](./CHANGELOG.md) — release history (Keep a Changelog 1.1, SemVer 2.0)
- [`examples/psycho/`](./examples/psycho/) — Quickstart manifest for the `psycho-build` pipeline

## Compatibility

- **CapCut**: 5.x+ desktop on Windows + macOS. Both the `cutcli`-emitted draft shape (`new_version: 167.x`) and the CapCut-UI-emitted shape (`169.x`) load.
- **JianYing**: 5.x is presumed-equivalent to CapCut 5.x. **JianYing 6+ is unsupported** — the on-disk `draft_content.json` is encrypted; `capcut-david` exits non-zero with a documented error. See `COMPATIBILITY.md` §5.
- **Node**: ≥ 18 (`engines.node` in `package.json`). CI matrix covers Node 18 / 20 / 22 on Ubuntu / macOS / Windows.
- **Runtime deps**: zero. Built entirely on the Node standard library.
- **Encoding**: UTF-8 without BOM. Never re-save edited drafts via PowerShell `Out-File` without `-Encoding utf8` — CapCut refuses BOM-prefixed JSON.

## Project status

| Phase | Goal | Version | State |
|---|---|---|---|
| A | Fork + restructure baseline | `0.1.0` | shipped |
| B | Fixture-backed test suite (102 tests) | `0.2.0` | shipped |
| C | `add-keyframe` + `ken-burns` (33 new tests) | `0.3.0` | shipped |
| D | `psycho-build` YAML pipeline (39 new tests, 212 total) | `0.4.0` | shipped |
| E | SKILL.md + polished docs + 1.0 graduation | `1.0.0` | in progress (`0.5.0` → `1.0.0-rc.N` → `1.0.0`) |

Aggregate test coverage on `src/commands/*` + `src/draft.ts`: **93%+ lines, 91%+ functions** (CI gate: 80%).

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
