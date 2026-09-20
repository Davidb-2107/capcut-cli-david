# Extract `voice-calibration` into its own repository

The ElevenLabs calibration subsystem (the `voice-calibration` package: local
calibration UI, MCP/Python bridge, WPM publication) no longer lives in this
repository. It was extracted from the `packages/voice-calibration` npm
workspace into a standalone repository at `C:\Users\dbele\src\voice-calibration`
(`Davidb-2107/voice-calibration`), and this CLI now consumes it as an external
package instead of a workspace member.

## Why

The calibration tool has its own identity, its own bin (`voice-calibration`),
its own release cadence, and its own docs. It is a *consumer-facing product*
(the calibration UI) that happens to be driven by this engine, not an internal
building block of the CLI. Keeping it in the monorepo blurred that boundary:
every CLI change rebuilt the package, and the package's autonomy guarantees
(its own tests, secrets handling, `bin`) were enforced only by convention.

Extracting it makes the boundary explicit: the package is autonomous
(self-contained tests, own repository, own `package.json` with its own
devDependencies), and the CLI is one adapter among others.

## How the CLI consumes it

`src/commands/calibration-ui.ts` imports `startVoiceCalibrationUi` /
`openInBrowser` from the published `voice-calibration` package. In
`package.json` the dependency is `file:../voice-calibration`, and for active
development we `npm link ../voice-calibration` so edits in the package are
picked up without reinstall. The CLI **no longer builds the package**: the
`npm run build -w voice-calibration` step was removed from `build` and
`typecheck`, so the CLI consumes the package's already-built `dist/`.

## Considered options

- **Keep it as an npm workspace** (status quo): rejected — the package is a
  product, not a library internal to the CLI, and the workspace coupling hid
  its autonomy.
- **Publish to npm / GitHub Packages and version it**: not now — the package
  is still local-only and the vault-coupled workflow (it reads
  `Shared/voice-calibration/voice_wpm.json`) isn't ready for public
  distribution. `file:` + `npm link` is the stepping stone.
- **`git filter-repo` to carry the full commit history**: rejected — only 3
  commits touched the package, so the provenance is recorded in the import
  commit message instead of a costly history rewrite.

## Consequences

- To run `capcut-david calibration-ui`, the sibling `voice-calibration` repo
  must be present at `C:\Users\dbele\src\voice-calibration` and built
  (`npm install && npm run build` there).
- Changes to the package are committed in its own repository, not here.
- The package's docs moved with it; root docs now link to the standalone
  repository rather than to `packages/voice-calibration/`.
