# Golden-output baseline — why it exists and when it may change

`test-fixtures/golden/baseline.json` is the committed characterisation net for
the CLI's **observable** behaviour: canonical stdout/stderr/exit for the
read-only commands, plus, for write commands, the resulting artifact
(canonical draft signature, `.bak` presence/equality, indent fidelity).

Run it with `node scripts/golden-output.mjs --check` after `npm run build`
(CI job `golden-output`). Regenerate with `--write`.
`node scripts/golden-output.mjs --selftest` proves the canonicaliser is
OS-agnostic (Windows and Linux forms collapse to the same token).

## Invariant

The baseline only changes when behaviour changes **on purpose**. The change
must land in the same PR as the code that causes it, with the justification
visible here. A behaviour change without a matching baseline update makes
`golden-output` red, which (since `b5f5e4d`) fails the required `ci-pass` gate.

## Baseline history

| Commit | What changed in the baseline | Why |
|---|---|---|
| `c2efb07` | initial baseline, 90 cases, captured **before** the DraftStore migration | PR 0: the net must exist before the first refactor |
| `8d652ac` | dropped `ui-print-path` (machine-local install path); refreshed the 3 edit-verb fidelity fields | **Justified divergence.** `set-text`, `shift`, `speed` moved from `bak_equals_original:false / indent_preserved:false / single_line:true` to `true / true / false`: the ticket restored the pre-`6ffc030` facade contract (a real `.bak` and the original indent). stdout/stderr/exit and the canonical draft content are unchanged — same mutation, faithful serialisation. Behaviour change justified in `d259bd3` ("Fidelity fix"). Audit F5 asked for this pointer: it is now here, not only in the commit message. |
| `aee94e2` | normalised the temp-path token so the baseline is machine-portable | the previous normaliser only rewrote the `mkdtemp` leaf, leaving an absolute prefix (12 entries) |
| audit round (2026-09-23) | the temp token is now separator-agnostic; the lossy blanket un-escape was removed | Audit F1: the old normaliser produced `<TMP>/\<TMP>` on Windows and `<TMP>/<TMP>` on Linux, so the committed baseline could only ever match win32. Fixed + an executable `--selftest` (also a CI step) proves both forms canonicalise identically. 28 entries changed in the **canonical text only**; the raw CLI outputs are byte-identical (verified: each changed entry differs from the previous form by the token squeeze and/or the removed `\\`→`\` un-escape, nothing else). |
| ticket 09 (2026-09-25) | added 9 `validate --fix` previews, 2 `--fix --apply` captures on fresh copies with text and media orphans, 1 blocked apply capture, and 2 write-state signatures | Characterises a previously uncovered mode for future refactors. The apply captures include the re-validation residual and pin identical canonical output, identical written bytes, and the original-byte `.bak`; the blocked case pins exit 2 and zero writes. This new baseline is not retroactive evidence for ticket 07. No production behavior changed. |

## What the net does NOT cover (known, deliberate)

- `psycho-build` (pipeline), `cascade-words`,
  `sync-timelines` (non-dry-run): need synthetic drafts / font calibration /
  mirrors. They are covered by their unit suites.
- Standalone `gc` runs only as a no-op here (the fixtures have no removable
  orphans); `validate --fix --apply` now exercises destructive gc on a synthetic copy.
- The write verbs absent from the golden matrix are swept by
  `npm run test:fidelity` (`scripts/fidelity-sweep.mjs`, 21 verbs), a CI step
  of the same `golden-output` job.

## A note on intermediate commits

Within `d259bd3..aee94e2` the `golden-output` job key was once indented outside
`jobs:` (invalid YAML). The final state is correct and `ci-pass` reads
`needs.golden-output.result`. Do not cherry-pick the intermediate CI commits;
take the range head.
