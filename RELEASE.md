# RELEASE.md — Versioning, cadence, and changelog policy

This document is the rulebook for cutting `capcut-cli-david` releases on npm and GitHub. Every version bump, tag, and `npm publish` must respect what's below.

**Last reviewed:** 2026-05-11
**Next review trigger:** fork ships `1.0.0` OR after 6 releases (whichever comes first)
**Sibling docs:** [`UPSTREAM.md`](UPSTREAM.md) (sync cadence, branch model) · [`COMPATIBILITY.md`](COMPATIBILITY.md) (what triggers a major)

---

## 0 · TL;DR

| Question | Answer |
|---|---|
| Versioning scheme | **SemVer 2.0.0**, fork-independent (we do **not** track upstream's number) |
| Starting version | `0.1.0` (first published code release, after `0.0.1` placeholder) |
| Pre-1.0 rule | Breaking changes ride **minor** bumps (`0.x.0`). Patches are bug-fix only. |
| Pre-release channel | `-alpha.N` → `-beta.N` → `-rc.N` → stable. dist-tags: `alpha` / `beta` / `rc` / `latest` |
| Changelog | **Manual `CHANGELOG.md`**, [Keep a Changelog 1.1](https://keepachangelog.com) format |
| Automation | None initially. Re-evaluate `changesets` once contributor count ≥ 2 |
| Cadence | **Trigger-based, not calendar-based.** Phase boundary, bug fix, compat expansion, or upstream sync containing user-visible fix |
| Pre-publish gate | 8 mandatory checks (§7); release blocked if any fail |

---

## 1 · SemVer policy

We follow [SemVer 2.0.0](https://semver.org/spec/v2.0.0.html) literally. Versions are fork-independent: our `0.4.0` is **not** related to upstream's `0.4.x`. The relationship to upstream is documented in `CHANGELOG.md` under each release's *Synced from upstream* sub-section (§4.2).

### 1.1 · What counts as a public surface

These are the things SemVer governs. A change to any of them triggers the corresponding bump.

| Surface | Examples | Governed by |
|---|---|---|
| CLI command set | `capcut-david info`, `…-david segments`, `…-david ken-burns` | SemVer |
| CLI flag set per command | `--track`, `--at`, `--duration` | SemVer |
| CLI output shape (JSON mode) | `{ok: true, data: {...}}` envelope, field names | SemVer |
| Exit codes | `0` ok, `1` user error, `2` schema mismatch, `3` IO error | SemVer |
| Exported TypeScript types (`src/draft.ts` barrel) | `Draft`, `Segment`, `Track`, `Keyframe`, `detectVersion()` | SemVer |
| **Written** draft schema invariants | Fields the writer guarantees to emit; ordering of `extra_material_refs` | SemVer (see [`COMPATIBILITY.md`](COMPATIBILITY.md) §6) |
| Minimum Node version | Currently `>= 18` | SemVer (raising this is **major**) |
| Supported CapCut version in "✅ tested" tier | Currently CapCut 8.x | SemVer (dropping any tested version is **major**) |
| `package.json` `bin` names | `capcut-david` | SemVer (renaming the bin is **major**) |

**Not** part of the public surface — change freely without bumps:

- Internal module layout under `src/` (the barrel re-exports are the contract)
- Source file split — `commands/edit.ts` vs `commands/*.ts` is implementation detail
- Test fixtures and their internal IDs
- Wording of human-readable error messages (the *exit code* is the contract, the prose isn't)
- Documentation files (`docs/draft-schema/**`, `UPSTREAM.md`, this file)
- Internal helper functions not re-exported from the barrel

### 1.2 · Major bump triggers (post-1.0 only — see §1.4 for pre-1.0)

Bump `X.0.0` for any of:

1. Removing or renaming a CLI command.
2. Removing or renaming a flag, or changing its semantics.
3. Changing the JSON output shape of any command (renamed field, removed field, changed type).
4. Changing or removing an exit code.
5. Breaking change to any type exported from the public barrel.
6. Raising the minimum Node version.
7. Dropping any CapCut/JianYing version from the **✅ tested** tier of `COMPATIBILITY.md` §1.
8. Renaming the npm package or the `bin` entry.
9. Changing the **writer**'s schema invariants in a way an existing CapCut version would reject. (Read-side liberalism is **not** a breaking change — see §1.3.)

### 1.3 · Minor bump triggers

Bump `x.Y.0` for any of:

1. New CLI command.
2. New flag on an existing command (default must preserve old behavior).
3. New optional field in JSON output (additive only).
4. New track type, material type, or animation supported.
5. Expanded **liberal-read** tolerance (we now parse a draft we previously refused). Liberal-read additions are **never** major — by design we don't gate reads on version.
6. New CapCut version added to **✅ tested** tier.
7. New exported type from the barrel (additive only).
8. Deprecation announcement (warning emitted, behavior unchanged).

### 1.4 · Patch bump triggers

Bump `x.y.Z` for any of:

1. Bug fix in any command, no observable contract change.
2. Schema-mismatch warning improvement (more accurate diagnostic, same exit code).
3. Performance improvement.
4. Internal refactor with no surface change.
5. New fixture added for an already-supported feature.
6. Doc fix shipped alongside a code change. (Doc-only changes don't ship a release — see §3.)
7. Dependency-free internal cleanup (we have zero runtime deps, so this is rare).

### 1.5 · Pre-1.0 rules (current phase)

While `0.x.y`:

- **Breaking changes ride minor bumps.** `0.2.0 → 0.3.0` may break the CLI surface. This matches upstream's pre-1.0 cadence (`0.1.0 → 0.2.2` in 3 weeks).
- **Patches stay bug-fix-only.** `0.2.1 → 0.2.2` must remain drop-in for users.
- **No deprecation window required pre-1.0.** A flag added in `0.4.0` can disappear in `0.5.0` without a deprecation cycle, but the CHANGELOG must call it out under **Removed** (§4.1).
- **1.0.0 is a deliberate decision**, not an accident of version arithmetic. See §1.6.

### 1.6 · 1.0.0 graduation criteria

Cut `1.0.0` only when **all** of the following are true. Each must be checkable; no fuzzy "feels stable."

- [ ] `psycho-build` pipeline ships end-to-end and produces a draft that opens in CapCut without warnings.
- [ ] All commands listed in master-plan Phase B + C have ≥ 1 test that loads a fixture, runs the command, and asserts the resulting draft against `COMPATIBILITY.md` invariants.
- [ ] All 9 fixtures in `test-fixtures/fixtures/` round-trip clean (parse → write → byte-stable for unchanged fields).
- [ ] `docs/draft-schema/**` shipped, no open questions in the schema doc.
- [ ] At least 30 calendar days of dogfooding on real psycho-niche videos with no fork-side regressions reported.
- [ ] At least one external user has run `npm i -g capcut-cli-david` and produced a working draft. (Goal: prove install path works on a machine that's not David's.)
- [ ] `npx capcut-cli-david@latest --help` returns documented output (smoke test §7.7).

Once cut, post-1.0 rules in §1.2–1.4 apply strictly.

### 1.7 · Independence from upstream

The fork's version number is **not** locked to upstream's. Concretely:

| Scenario | Our action |
|---|---|
| Upstream releases `0.3.0` with a new command we like | Sync per `UPSTREAM.md` §3, expose the command on our side, ship as **our** next minor (`x.Y.0`). Note the sync in the CHANGELOG sub-section. |
| Upstream releases `0.3.0` with a breaking change we ship | Same as above — it's our minor (pre-1.0) or major (post-1.0), independent of upstream's `0.3.0` number. |
| Upstream goes silent for 6 months while we ship 5 releases | No coupling at all. Our version moves; upstream's doesn't. |
| Upstream hits `1.0.0` while we're at `0.7.0` | Our `1.0.0` still requires §1.6 criteria. We do not race to match. |

**Why independent.** Coupling our version to upstream's would make our changelog lie about the size of our change ("upstream bumped minor, but for us this is a major"). The `contributors` field and the per-release *Synced from upstream* sub-section carry the provenance.

---

## 2 · Pre-release channels & dist-tags

### 2.1 · Channel progression

```
0.x.y-alpha.N     ┐
                  │  internal / Davidb-2107 only
                  ┘  npm dist-tag: alpha
                       ↓
0.x.y-beta.N      ┐
                  │  public preview, feedback open
                  ┘  npm dist-tag: beta
                       ↓
0.x.y-rc.N        ┐
                  │  feature-frozen, only bug fixes
                  ┘  npm dist-tag: rc
                       ↓
0.x.y             ┐
                  │  stable
                  ┘  npm dist-tag: latest
```

### 2.2 · When to use each

| Channel | Used for | Audience | Stability promise |
|---|---|---|---|
| `-alpha.N` | First implementation of a new command or pipeline. Phase A/B/C/D in-flight work. | David only. | **None.** Breaking changes between alphas are normal. |
| `-beta.N` | Feature complete, may have rough edges. Phase boundary candidates. | Anyone who opts in via `npm i capcut-cli-david@beta`. | API frozen at the **command** level; flag-level tweaks possible. |
| `-rc.N` | Believed shippable, awaiting final smoke test. | Anyone who opts in via `@rc`. | Identical to next stable except for bug-fix patches. |
| `(no suffix)` | Stable. Goes on `latest` dist-tag — what plain `npm i capcut-cli-david` resolves to. | All users. | SemVer guarantees apply (§1). |

### 2.3 · Channel rules

| Rule | Reason |
|---|---|
| `-alpha.N` and `-beta.N` are **never** promoted to `latest`. | Default users never get pre-release unless they ask. |
| Each pre-release number monotonically increases (`-alpha.1` → `-alpha.2`). | npm SemVer ordering requires it. Don't skip numbers. |
| When jumping a channel (alpha → beta), reset the counter (`-beta.1`, not `-beta.4`). | Counter resets are SemVer-legal and make the channel obvious. |
| `-rc.N` releases are **publish-only**, no force-push: if `-rc.1` has a bug, ship `-rc.2`. | RC builds are reference points for downstream testing. |
| `-david.N` is reserved for niche-specific snapshots (e.g., a psycho-only build with experimental keyframe presets). Never on `latest`. | Mirrors `david/*` branch convention from `UPSTREAM.md` §2. |

### 2.4 · Publishing pre-releases

```bash
# Alpha — internal iteration
npm version 0.2.0-alpha.1 --no-git-tag-version
npm publish --tag alpha --access public

# Beta — public preview
npm version 0.2.0-beta.1 --no-git-tag-version
npm publish --tag beta --access public

# RC — frozen candidate
npm version 0.2.0-rc.1 --no-git-tag-version
npm publish --tag rc --access public

# Stable — goes to latest by default
npm version 0.2.0 --no-git-tag-version
npm publish --access public
```

Tags follow the same names: `git tag v0.2.0-alpha.1`. The `v` prefix is mandatory; it differentiates release tags from any internal `0.2.0-*` markers.

---

## 3 · Cadence — when to release

**Trigger-based, not calendar-based.** Releases happen when there's something to ship, not on a schedule.

### 3.1 · Triggers

| Trigger | Bump type | Channel | Window |
|---|---|---|---|
| Phase A/B/C/D/E completion (master plan) | minor (pre-1.0) | `beta` → `rc` → stable | Same week |
| Bug fix in shared command path | patch | stable (latest) | Same week |
| Compatibility expansion (new CapCut version tested + green) | minor | stable | Same release window |
| Upstream sync containing a user-visible fix we expose | patch or minor | stable | Within 7 days of sync (per `UPSTREAM.md` §3) |
| Security fix (transitive or in our code) | patch, fast-track | stable | **Within 24h**, skip beta channel |
| New command in `feat/*` ready for public preview | minor pre-release | `beta` | When the branch lands on `master` |
| Doc-only change | **no release** — docs are not part of public surface (§1.1) | n/a | n/a |
| Upstream sync with no user-visible delta | **no release** — sync committed, no version bump | n/a | n/a |

### 3.2 · What does NOT trigger a release

- Internal refactor with no test changes (commit it, don't ship it)
- README typo fix
- Schema doc update without code change
- CI tweak
- Updating `UPSTREAM.md` decision log
- Bumping a devDep that doesn't affect the build output

Squash these into the next legitimate release.

### 3.3 · Hotfix rule

A regression introduced by `0.x.y` is fixed in `0.x.(y+1)` **on the same day if discovered within 24h of publish**. After 24h, normal cadence applies. Hotfixes:

- Skip the beta channel.
- Branch off the release tag, not `master`: `git checkout -b release/hotfix-0.x.y+1 v0.x.y`.
- Forward-merge into `master` after release: `git checkout master && git merge --no-ff release/hotfix-0.x.y+1`.

### 3.4 · Post-1.0 cadence ceiling

After `1.0.0`: **no more than one stable release per week** absent a security trigger. This protects downstream users from version-churn fatigue. Pre-releases (`-rc.N`) are exempt.

---

## 4 · Changelog format

Single file at repo root: `CHANGELOG.md`. Format: [Keep a Changelog 1.1](https://keepachangelog.com/en/1.1.0/). Manually maintained — see §5 for the rationale and revisit conditions.

### 4.1 · Structure

```markdown
# Changelog

All notable changes to `capcut-cli-david` are documented here.
Format follows [Keep a Changelog 1.1](https://keepachangelog.com/en/1.1.0/);
this project adheres to [SemVer 2.0.0](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- New command stubs in flight

### Changed
- …

### Fixed
- …

## [0.2.0] — 2026-MM-DD

### Added
- `capcut-david ken-burns <video-id>` — applies Ken Burns dual-keyframe pair
  to the named segment. Configurable via `--zoom-in` / `--zoom-out` / `--ease`.
- New exported type `KeyframePair` in the public barrel.

### Changed
- `capcut-david info` JSON output adds `effects_count` field (additive — not a break).

### Fixed
- Windows path-separator normalization in `set-text --file` (Issue #12).

### Synced from upstream
- Merged upstream `0.3.1` (commit `abc1234`, 2026-MM-DD) — cherry-picked
  schema-validation hardening into `src/draft.ts`. No CLI surface delta.

### Removed
- (none)

### Deprecated
- `capcut-david texts --raw` — use `--json` instead. Removed in next minor.

### Compatibility
- Added CapCut 8.7.0 (windows) to the ✅ tested tier.
- See `COMPATIBILITY.md` §2.1 for the updated fixture matrix.

[Unreleased]: https://github.com/Davidb-2107/capcut-cli-david/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Davidb-2107/capcut-cli-david/compare/v0.1.0...v0.2.0
```

### 4.2 · Heading conventions

| Section | Use for |
|---|---|
| `### Added` | New commands, flags, fields, types, fixtures (when user-relevant), supported versions |
| `### Changed` | Behavioral changes to existing surface. **Required for any major bump trigger §1.2.** |
| `### Fixed` | Bug fixes. Include issue / PR reference when one exists. |
| `### Removed` | Deleted commands, flags, types. **Required for any major bump trigger §1.2 #1, #2, #5.** |
| `### Deprecated` | Things still working but slated for removal. Name the version they go away in. |
| `### Security` | Use only for security fixes. Drives the §3.1 fast-track. |
| `### Synced from upstream` | Sub-section under the version. Lists upstream commits merged + whether they triggered a bump on our side. Fork-specific addition to Keep a Changelog. |
| `### Compatibility` | Changes to the `COMPATIBILITY.md` matrix. Fork-specific addition. |

### 4.3 · Editorial rules

| Rule | Reason |
|---|---|
| One bullet per change, written **for users**, not for committers. "Fixed Windows path bug" is for committers — "Windows: `set-text --file` now accepts forward-slash paths" is for users. | Changelog is documentation, not commit log. `git log` is the commit log. |
| Always link issue/PR numbers when one exists. | One-click navigation from changelog to context. |
| **Never** edit a released section. Mistakes get an erratum at the bottom of the version's section: `**Erratum 2026-MM-DD:** the 0.2.0 entry for X was inaccurate — actual behavior is Y.` | Tags are immutable; the changelog should match. |
| `Unreleased` section is curated *as you commit*, not assembled at release time. Every PR touching the public surface adds a bullet. | Avoids release-day archaeology. |
| Compare links at the bottom point at GitHub commit-compare URLs. | Standard Keep a Changelog convention. |
| Dates are ISO `YYYY-MM-DD`. | Unambiguous, sortable. |

### 4.4 · Multi-package note (future)

If we ever split the fork into multiple npm packages (unlikely — single-binary CLI), one `CHANGELOG.md` per package. Don't share a single file across packages — that's where `changesets` earns its keep. See §5.2.

---

## 5 · Tooling decision: why manual, not automated

### 5.1 · What we considered

| Tool | Verdict | Reason |
|---|---|---|
| **Manual `CHANGELOG.md` + `npm version`** | ✅ **chosen** | Lowest friction for single maintainer. Matches the zero-runtime-deps philosophy. Lets us write fork-specific context (e.g., *Synced from upstream*) that automation strips. |
| `changesets` ([atlassian/changesets](https://github.com/changesets/changesets)) | 🟡 hold | Good fit if we add contributors. Overkill for one person. Designed for monorepos. Re-evaluate at trigger §5.2. |
| `release-please` (Google) | ❌ rejected | Requires conventional-commit discipline across all commits — harsh for pre-1.0 exploration. Auto-generated changelogs lose context. |
| `semantic-release` | ❌ rejected | Fully automated bump from commit messages — removes the deliberate gate we want in §7. Hostile to manual hotfix flow §3.3. |
| `auto-changelog` / `conventional-changelog-cli` | ❌ rejected | Generates from git log → produces committer-flavored prose, not user-facing notes (§4.3). |

### 5.2 · Promotion to `changesets`

Switch to `changesets` when **any** of:

- Contributor count ≥ 2 (PRs from people other than David).
- Repository is split into ≥ 2 published npm packages.
- The "write bullets as you commit" rule (§4.3) starts being skipped on > 25 % of PRs.

Promotion is a one-time chore: import `CHANGELOG.md` as the historical record, point `changesets` at `master`, document the new flow in this file's §5.

### 5.3 · What does not justify a switch

| Argument | Why we don't switch |
|---|---|
| "Release notes are tedious to write" | If they're tedious, the PR didn't have a user-visible change worth shipping (§3.2). |
| "I forget the version bump rules" | They live in §1 — keep this file open during release prep. |
| "GitHub Release notes are nicer with automation" | The GitHub Release body **is** the changelog section for that version (§7.10). Copy-paste, don't re-generate. |

---

## 6 · Versioning the schema separately

The CLI version and the **CapCut draft schema** version are different things. We need to stay clear-headed about both.

| Thing | Version source |
|---|---|
| Our CLI (`capcut-cli-david`) | This file — SemVer, fork-independent |
| CapCut's `draft_content.json` schema integer | `COMPATIBILITY.md` §2.2 — set by CapCut, not us |
| Our **understanding** of the schema | `docs/draft-schema/**` — doc-only, no version of its own |

A new CapCut release that changes `version: 360000 → 370000` does **not** bump our CLI version automatically. The sequence is:

1. CapCut ships, schema int changes.
2. We capture a fixture, run our tests, observe what broke.
3. If our writer needs to change to keep producing valid drafts → **major bump** (§1.2 #9) once the fix lands.
4. If only the read path needs new tolerance → **minor bump** (§1.3 #5).
5. If nothing on our side changes → **no bump**. `COMPATIBILITY.md` gets an entry, that's it.

The CLI's job is to bridge versions, not to mirror them.

---

## 7 · Pre-publish gate (the 8 checks)

Every release must pass **all 8** before `npm publish`. Skip any check → block. No exceptions for `-alpha.N` either (alphas can have bugs; they cannot be unbuildable).

### 7.1 · CI green on `master`

```bash
gh run list --branch master --limit 1
```

Last run on the commit being released must be `success`. If CI is red, fix CI before bumping.

### 7.2 · `npm test` passes locally

```bash
npm test
```

All `node:test` suites green. Includes fixture round-trip tests (all 9 fixtures) and command-level integration tests.

### 7.3 · Typecheck clean

```bash
npm run typecheck       # tsc --noEmit
```

No `tsc` errors. Pre-1.0 we tolerate `tsc` warnings; post-1.0 zero-warning policy.

### 7.4 · Lint clean

```bash
npm run lint
```

Lint tool TBD in Point 7 (likely `biome` or `tsc --noEmit + prettier --check`). Whatever it is, must be zero-violation on release commits.

### 7.5 · Build produces a working bin

```bash
npm run build
node dist/index.js --help
```

The compiled output must execute and print help. This catches packaging mistakes (missing `bin` field, wrong shebang, ESM/CJS mismatch).

### 7.6 · Fixture sanity

Every fixture in `test-fixtures/fixtures/` parses without error and round-trips clean. Run as part of §7.2 but verified explicitly:

```bash
for f in test-fixtures/fixtures/*.json; do
  node dist/index.js info --input "$f" > /dev/null || { echo "FAIL: $f"; exit 1; }
done
```

### 7.7 · Help smoke test on a fresh install

In a scratch directory, **after** publishing:

```bash
npm i capcut-cli-david@<just-published>
npx capcut-cli-david --help
```

If `--help` errors or returns garbled output, the publish is broken — `npm deprecate` immediately and ship a patch (§9.2).

### 7.8 · CHANGELOG and version coherence

| File | Check |
|---|---|
| `CHANGELOG.md` | `[Unreleased]` section emptied into a new `[X.Y.Z] — YYYY-MM-DD` section, compare-link added |
| `package.json` | `version` field matches the new tag |
| Git tag | `vX.Y.Z` created, signed if user GPG-signing is set up |

A single committed file out of sync = block. They all change in one commit (§8.3).

---

## 8 · Release runbook

Execute in order. Each step assumes the previous succeeded.

### 8.1 · Pre-flight

```bash
# 1. On master, clean, up to date
git checkout master
git status                 # must be empty
git pull --ff-only

# 2. Sync from upstream-sync if it's the monthly window (UPSTREAM.md §3.4)
#    Otherwise skip — don't introduce upstream commits into a release ad-hoc.
```

### 8.2 · Verify the gate (8 checks from §7)

```bash
npm ci                     # clean install
npm run lint               # §7.4
npm run typecheck          # §7.3
npm test                   # §7.2 + §7.6
npm run build              # §7.5
node dist/index.js --help  # §7.5 confirmation
gh run list --branch master --limit 1   # §7.1
```

If any fail → stop. Fix on a `release/fix-<thing>` branch, merge back, restart.

### 8.3 · Bump and commit

```bash
# Stable release
npm version <major|minor|patch> --no-git-tag-version

# Pre-release
npm version <0.x.y>-<alpha|beta|rc>.<N> --no-git-tag-version
```

Then:

```bash
# Manually update CHANGELOG.md per §4.1
$EDITOR CHANGELOG.md

# Single commit with both changes
git add package.json CHANGELOG.md
git commit -m "chore(release): vX.Y.Z"

# Tag — the v prefix is mandatory
git tag -a vX.Y.Z -m "Release vX.Y.Z"
```

### 8.4 · Publish

```bash
# Stable — defaults to dist-tag 'latest'
npm publish --access public

# Pre-release — must specify the channel tag
npm publish --tag <alpha|beta|rc> --access public
```

OTP note: npm 2FA was enabled when reserving the name (Point 4). The OTP prompt fires once and burns the code immediately — split `npm login` and `npm publish` into separate shell invocations so a refused OTP doesn't waste the next code (lesson from Point 4 publish session).

### 8.5 · Push and release

```bash
git push origin master
git push origin vX.Y.Z

# GitHub Release — body is the CHANGELOG section for this version, copy-pasted
gh release create vX.Y.Z \
  --title "vX.Y.Z" \
  --notes-file <(awk "/^## \[X.Y.Z\]/,/^## \[/" CHANGELOG.md | sed '$d')

# For pre-release:
gh release create vX.Y.Z-rc.1 --prerelease --title "..." --notes-file ...
```

### 8.6 · Post-publish smoke test (§7.7)

```bash
cd /tmp/release-smoke-$(date +%s)
npm init -y
npm i capcut-cli-david@<just-published>
npx capcut-cli-david --help
```

If this fails: see §9.2.

### 8.7 · Update the master plan

If this release closes a master-plan phase (A/B/C/D/E), update [`wiki/analyses/2026-05-11-capcut-cli-david-project.md`](../../wiki/analyses/2026-05-11-capcut-cli-david-project.md):

- Mark the phase done in the **Implementation phases** table.
- Append a one-line `log.md` entry: `## [YYYY-MM-DD] release | vX.Y.Z — <one-line summary>`.

---

## 9 · Yank / deprecate / unpublish policy

### 9.1 · Never `npm unpublish` after 72h

npm allows unpublish only within 72h of publish, and even within that window it's destructive — anyone who installed during the gap gets a broken `npm ci` later. Default to `npm deprecate` instead.

### 9.2 · Deprecating a release

```bash
# Tell users a release is bad and what to use instead
npm deprecate capcut-cli-david@X.Y.Z "Regression in <command>. Use X.Y.(Z+1) instead."
```

This:

- Adds a yellow warning on install.
- Does NOT remove the version (downstream `package-lock.json` still resolves).
- Is reversible: `npm deprecate capcut-cli-david@X.Y.Z ""`.

### 9.3 · Hotfix workflow (within 24h of bad publish)

1. Deprecate the bad version with a message pointing at the incoming fix.
2. Branch off the bad tag: `git checkout -b release/hotfix-X.Y.(Z+1) vX.Y.Z`.
3. Fix, test, run the full §7 gate.
4. `npm version patch` → `vX.Y.(Z+1)`.
5. Publish stable (skip beta, see §3.3).
6. Update CHANGELOG with a **Fixed** entry for the new version, plus an erratum block on the bad version per §4.3.
7. Forward-merge: `git checkout master && git merge --no-ff release/hotfix-X.Y.(Z+1)`.
8. Delete the hotfix branch.

### 9.4 · Yanking a flag or command (deprecation cycle)

| Phase | Pre-1.0 | Post-1.0 |
|---|---|---|
| Announce | CHANGELOG `### Deprecated` in the release that adds the warning | Same |
| Warning duration | 1 minor (`0.x.0` → `0.(x+1).0`) | 1 major (`X.0.0` → `(X+1).0.0`) |
| Remove | Next minor | Next major |
| Stderr warning | `[deprecated] --raw is removed in 0.3.0; use --json` | Same, version pinned to the major |

The stderr warning text is stable across the deprecation window — don't rewrite it, downstream scripts grep for it.

---

## 10 · First few releases — the planned ladder

This is the *expected* trajectory. Actual releases follow §3 triggers and may diverge.

| Version | Channel | Trigger | Approx phase |
|---|---|---|---|
| `0.0.1` | `latest` | npm name reservation (Point 4) — ✅ shipped 2026-05-11 | Placeholder |
| `0.1.0` | `latest` | Phase A complete — fork restructured, all existing capcut-cli commands pass tests | Phase A |
| `0.2.0-beta.1` | `beta` | Phase B in flight — fixtures wired up, node:test harness green | Phase B |
| `0.2.0` | `latest` | Phase B complete — all existing commands have fixture-backed tests | Phase B |
| `0.3.0-alpha.N` | `alpha` | Phase C work — `add-keyframe` and `ken-burns` iterating | Phase C |
| `0.3.0` | `latest` | Phase C complete — creation primitives stable | Phase C |
| `0.4.0-alpha.N` | `alpha` | Phase D work — `psycho-build` YAML manifest pipeline | Phase D |
| `0.4.0-rc.1` | `rc` | Phase D feature complete | Phase D |
| `0.4.0` | `latest` | Phase D complete — `psycho-build` stable | Phase D |
| `0.5.0` | `latest` | Phase E complete — SKILL.md + docs + README polished for public consumption | Phase E |
| `1.0.0-rc.N` | `rc` | All §1.6 graduation criteria met except 30-day dogfooding | Post-Phase E |
| `1.0.0` | `latest` | §1.6 satisfied | Graduation |

This ladder is **not** a schedule. Each rung waits for its trigger. The point is to set the shape of the first year, not to commit to dates.

---

## 11 · Rules summary

1. SemVer 2.0.0, fork-independent. Our version is not coupled to upstream's.
2. Pre-1.0: breaking changes ride minor bumps. Patches are bug-fix only.
3. Pre-release channels: `alpha` → `beta` → `rc` → stable. Default install always gets stable.
4. Trigger-based cadence — no calendar releases. Hotfix within 24h of regression.
5. Manual `CHANGELOG.md`, Keep a Changelog 1.1. Promote to `changesets` only at the §5.2 trigger.
6. Schema version and CLI version are decoupled (§6).
7. The 8 pre-publish checks (§7) are mandatory — no release skips them.
8. Bump + CHANGELOG + tag in a single commit (§8.3).
9. Never `npm unpublish` past 72h — `npm deprecate` instead (§9.1).
10. Deprecation cycle: 1 minor pre-1.0, 1 major post-1.0 (§9.4).
11. 1.0.0 requires all §1.6 criteria — deliberate gate, not arithmetic.

---

## 12 · Maintenance notes

This file changes when:

- The lint tool from Point 7 is chosen → update §7.4 with the concrete command.
- CI from Point 7 lands → update §7.1 with the workflow name being checked.
- Contributor count ≥ 2 → promote to `changesets` per §5.2; rewrite §4, §8.3 accordingly.
- We ship `1.0.0` → strike §1.5 (pre-1.0 rules), make §1.2–1.4 the only path; review the entire doc.
- An incident shows §7 was insufficient → add the missing check, log the reason in `UPSTREAM.md` §7 decision log.

Don't change the file for one-off concerns. Tweak the runbook only when the same friction shows up twice.

---

## Sources

- [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html) — the spec we follow
- [Keep a Changelog 1.1](https://keepachangelog.com/en/1.1.0/) — changelog format
- [npm semver guide](https://docs.npmjs.com/about-semantic-versioning) — pre-release tag mechanics
- [npm dist-tag docs](https://docs.npmjs.com/cli/v10/commands/npm-dist-tag) — channel routing
- [npm deprecate docs](https://docs.npmjs.com/cli/v10/commands/npm-deprecate) — yank mechanics
- [changesets](https://github.com/changesets/changesets) — promotion candidate (§5.2)
- [`UPSTREAM.md`](UPSTREAM.md) — sync cadence, branch model
- [`COMPATIBILITY.md`](COMPATIBILITY.md) — compatibility tiers that drive major bumps
- [[wiki/analyses/2026-05-11-capcut-cli-david-project|capcut-cli-david — Project Master Plan]]
