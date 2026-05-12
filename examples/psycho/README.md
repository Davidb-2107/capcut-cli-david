# examples/psycho — Quickstart

Smallest possible end-to-end run of the **`psycho-build`** pipeline.

```sh
capcut-david psycho-build examples/psycho/manifest.example.yaml --seed 42
```

This composes:

- `init` + 3× `add-video` + 3× `ken-burns` (alternating push-in / pull-out)
- `add-audio` for narration (voice track, 100% volume)
- `add-audio` for ambient music (music track, 25% — statically ducked)
- `add-text` for every SRT entry, styled gold

The placeholder asset files in `assets/` are byte stubs — replace them with
real image / audio / caption files to get a draft that opens in CapCut.

The `--seed` flag makes the build deterministic: same manifest + same seed →
byte-identical draft.
