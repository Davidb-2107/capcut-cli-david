# capcut-cli-david

> **Fork of [renezander030/capcut-cli](https://github.com/renezander030/capcut-cli)** —
> the upstream CLI by Rene Zander, being extended with creation primitives
> (keyframes, Ken Burns, animations) and an opinionated `psycho-build`
> pipeline for the TikTok paranoia/psycho niche.
>
> - **Want the lean, general-purpose CLI?** Use upstream: `npm i -g capcut-cli`.
> - **Want creation primitives + niche pipelines?** You're in the right place.

Create and edit CapCut / JianYing projects from the command line. Build drafts from scratch, add media, modify subtitles, cut long-form to shorts. Zero runtime dependencies, JSON-first, pipeable.

`0.1.0` is the **fork baseline**: a modular restructure of upstream `0.2.2` with no behavioral changes to existing commands. New commands (`ken-burns`, `psycho-build`, …) land in subsequent minors per the [roadmap](#roadmap).

## Status

| Phase | Goal | Version | State |
|---|---|---|---|
| A | Fork + restructure + ship 0.1.0 | `0.1.0` | this release |
| B | Fixture-backed tests for every command | `0.2.0` | next |
| C | `add-keyframe` + `ken-burns` | `0.3.0` | planned |
| D | `psycho-build` pipeline | `0.4.0` | planned |
| E | SKILL.md + docs polish + `1.0.0` | `1.0.0` | planned |

See [`RELEASE.md`](../RELEASE.md) for the full release contract.

## Install

```bash
npm install -g capcut-cli-david
capcut-david --help
```

Requires Node ≥ 18.

## Usage

```bash
# Overview
capcut-david info ./project
capcut-david tracks ./project -H
capcut-david materials ./project --type videos

# Browse
capcut-david segments ./project --track text
capcut-david texts ./project
capcut-david export-srt ./project > subs.srt

# Detail
capcut-david segment ./project a1b2c3
capcut-david material ./project a1b2c3

# Edit (creates .bak before writing)
capcut-david set-text ./project a1b2c3 "New subtitle"
capcut-david shift ./project a1b2c3 +0.5s
capcut-david speed ./project a1b2c3 1.5
capcut-david volume ./project a1b2c3 0.8
capcut-david trim ./project a1b2c3 2s 5s
capcut-david opacity ./project a1b2c3 0.5

# Create
capcut-david init "My Short" --drafts ~/Movies/CapCut/User\ Data/Projects/com.lveditor.draft
capcut-david add-video ./my-short ./clip.mp4 0s 10s
capcut-david add-audio ./my-short ./narration.mp3 0s 10s --volume 0.9
capcut-david add-text  ./my-short 0s 5s "Title" --font-size 24 --color "#FFD700"

# Cut long-form → short
capcut-david cut ./project 1:00 2:00 --out ./teaser.json

# Templates
capcut-david save-template  ./project a1b2c3 "gold-title" --out gold-title.json
capcut-david apply-template ./other gold-title.json 0s 5s "Chapter Three"

# Batch (JSONL on stdin)
echo '{"cmd":"set-text","id":"a1b2c3","text":"Line one"}
{"cmd":"shift-all","offset":"+0.3s","track":"text"}' | capcut-david batch ./project
```

Full command help: `capcut-david --help`.

## Output modes

JSON (default), human-readable (`-H` / `--human`), quiet (`-q` / `--quiet`).

```bash
capcut-david texts ./project | jq '.[].text'
capcut-david info ./project -H
capcut-david set-text ./project a1b2c3 "Fixed" -q && echo done
```

## Time formats

`1.5s`, `500ms`, `+0.5s`, `-1s`, `1:30`, `0:05.5`.

## IDs

Segment and material IDs are UUIDs. The first 6+ chars work as prefix match.

## How it differs from upstream

| Surface | `capcut-cli` (upstream) | `capcut-cli-david` |
|---|---|---|
| Binary | `capcut`, `capcut-cli` | `capcut-david` |
| Module layout | 4 source files (`index.ts`, `factory.ts`, `draft.ts`, `time.ts`) | Modular: `commands/{create,edit,inspect,template,cut,batch}.ts` + `utils/{time,cli,companion}.ts` |
| Lint | none | Biome 2 (`npm run lint`) |
| CI | none | GitHub Actions: Biome + tsc + node:test on Node 18/20/22 × Ubuntu/macOS/Windows |
| Fixtures | upstream's `test/draft_content.json` | 9 anonymized fixtures + cross-reference validator |
| Roadmap | viral-shorts focus | adds creation primitives (keyframes, Ken Burns) + `psycho-build` |

No upstream command was renamed, removed, or behaviorally changed in `0.1.0`. See [`UPSTREAM.md`](../UPSTREAM.md) for the long-term relationship contract.

## Project layout

```
capcut-cli-david/
├── repo/                       # this git repo (npm package)
│   ├── src/
│   │   ├── index.ts            # CLI entry + arg parser
│   │   ├── draft.ts            # Draft types + load/save/find helpers
│   │   ├── utils/{time,cli,companion}.ts
│   │   └── commands/{create,edit,inspect,template,cut,batch}.ts
│   ├── test/                   # node:test (Phase A smoke; Phase B fixture suite)
│   ├── test-fixtures/          # 9 anonymized drafts + _final_integrity.py
│   └── .github/workflows/ci.yml
├── docs/draft-schema/          # in-repo JSON schema reference (Point 5)
├── UPSTREAM.md                 # fork ↔ upstream contract
├── COMPATIBILITY.md            # CapCut / JianYing / OS support matrix
└── RELEASE.md                  # versioning + release runbook
```

## Roadmap

- **`0.2.0`** — fixture-backed `node:test` coverage for every existing command (Phase B)
- **`0.3.0`** — `add-keyframe` (any property) + `ken-burns` (opinionated dual-scale) (Phase C)
- **`0.4.0`** — `psycho-build` YAML manifest pipeline (Phase D)
- **`1.0.0`** — SKILL.md, polished docs, stability promise (Phase E)

Track progress in the [master plan](../../wiki/analyses/2026-05-11-capcut-cli-david-project.md).

## Contributing

Bug fixes and improvements to existing commands are welcome — and we try to land portable fixes upstream too. See [`UPSTREAM.md`](../UPSTREAM.md) §4 for the PR-back policy.

## Acknowledgements

- **[renezander030/capcut-cli](https://github.com/renezander030/capcut-cli)** — Rene Zander's upstream that this fork is built on.
- **cutcli** — closed-source Go binary whose draft output informed the schema reverse-engineering (no code copied).

## License

MIT — see [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
