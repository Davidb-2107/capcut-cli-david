# UPSTREAM.md — Relationship with `renezander030/capcut-cli`

This document defines how `capcut-cli-david` (fork) maintains its relationship with `renezander030/capcut-cli` (upstream). It is the rulebook every commit, sync, and PR-back must respect.

**Last reviewed:** 2026-08-11
**Next review trigger:** a change to our attribution obligations (§5) — nothing else. Sync and PR-back are terminated, see §7 (2026-08-11).

> **Statut au 2026-08-11 — le sync est ARRÊTÉ, l'attribution CONTINUE.** Les deux
> bases de code n'ont plus de tronc commun (§7) : §2 (branches), §3 (cadence) et §4
> (PR-back) sont conservés comme historique de décision, **plus comme procédure à
> appliquer**. Seul §5 (obligations MIT) reste vivant et contraignant.

---

## 1. Upstream snapshot (frozen 2026-05-11 — PÉRIMÉ, conservé tel quel)

> Ce tableau décrit upstream **au 2026-05-11**, jour de la décision de fork. Il n'a
> pas été rafraîchi depuis et ne le sera plus : il documente le contexte de la
> décision, pas l'état courant d'upstream. Pour l'état courant : `git fetch upstream`.

| Field | Value |
|---|---|
| Repo | `renezander030/capcut-cli` |
| URL | https://github.com/renezander030/capcut-cli |
| Default branch | `master` |
| License | MIT — `Copyright (c) 2026 Rene Zander` |
| Author / sole maintainer | Rene Zander (`renezander030@gmail.com`) — renezander.com |
| Created | 2026-04-13 |
| Last commit | 2026-05-07 (≈4 days ago) |
| Lifetime | 24 days |
| Commits to date | 27 |
| Cadence | ~7.8 commits/week, **bursty** (median gap 0d, max gap 12d) |
| Releases | 0.1.0 → 0.2.2 in 3 weeks (pre-1.0, API still moving) |
| Stars / Forks / Open issues | 7 / 2 / 0 |
| Stack | TypeScript + JS, ESM, zero deps, npm `capcut-cli` |
| Bin names | `capcut`, `capcut-cli` |
| Topics | capcut, capcut-cli, jianying, claude-code-plugin, srt-export |
| Monetization | Sells "Viral Story Shorts Blueprint" via Gumroad — README CTAs link there |
| Same ecosystem? | YES — upstream also ships a Claude Code plugin |

### What this snapshot tells us

- **Active, maintained** — fork is not adopting an abandoned project. Sync cost is real.
- **Pre-1.0** — upstream API surface (CLI commands, JSON output shape) WILL break. Expect schema churn until 1.0.
- **Single maintainer + commercial angle** — upstream optimizes for *his* viral-shorts pipeline. PRs that don't serve that niche may be politely declined. Plan accordingly.
- **Same Claude Code ecosystem** — risk of confusion between `capcut-cli` skill and our `capcut-david` skill. Names and docs must differentiate cleanly.
- **Tiny audience** — fork is unlikely to be perceived as a hostile competitor; communication can stay informal.

---

## 2. Branch strategy

```
upstream-sync   ← pristine mirror of renezander030/capcut-cli@master (fast-forward only)
master          ← our shippable trunk; carries fork-only commits + merged upstream
feat/*          ← portable work (candidates for upstream PR-back)
david/*         ← niche/opinionated work (psycho-build, fork-only forever)
release/*       ← short-lived release prep branches
```

### Rules

| Rule | Reason |
|---|---|
| `upstream-sync` is **never** committed to directly. Only `git fetch upstream master && git push origin upstream-sync --ff-only`. | Keeps a pristine reference for diffs and bisects. |
| Sync flows: `upstream/master → upstream-sync → master` via **merge commit** (not rebase). | Preserves upstream commit hashes in our `git log` — auditable attribution. |
| Feature work happens on `feat/*` or `david/*`, never on `master` directly. | Keeps `master` mergeable; lets us cherry-pick or PR-back individual features cleanly. |
| `feat/*` branches are **rebased** onto upstream before opening a PR back. | Upstream prefers linear history; rebased PRs merge faster. |
| `david/*` branches are tagged with the `david/` prefix to make non-portable work obvious in `git log` and PR lists. | Future contributors instantly know what is fork-only. |

### Initial setup commands

```bash
git remote add upstream https://github.com/renezander030/capcut-cli.git
git fetch upstream
git branch upstream-sync upstream/master
git push -u origin upstream-sync
git checkout -b master upstream/master   # initial trunk
git push -u origin master
```

---

## 3. Sync cadence

**Decision: Monthly merge, with two exception triggers.**

| Trigger | Action | Window |
|---|---|---|
| **Calendar** | First Monday of each month: review upstream `master`, merge if anything substantive landed. | Monthly |
| **Security/critical fix** | Apply within 72 h of upstream commit. | Out-of-band |
| **Upstream cuts a release** (`x.y.z` tag) | Re-evaluate within 7 days; merge if no breaking-change conflict. | Per release |
| **Pre-1.0 freeze risk** | If upstream ships v1.0.0, do a full one-time deep merge & API audit. | Once |

### Why monthly, not weekly

- Cadence is **bursty** (median 0d gap, max 12d). Weekly check-ins would mostly be no-ops or partial-burst snapshots.
- Pre-1.0: many commits are README/keyword/version chores — not worth interrupting fork work for.
- Monthly batch lets us evaluate breaking changes against our test fixtures (Point 2 deliverable) in one pass.
- The cost of a late merge is bounded: small project, small surface area, our test suite catches schema regressions.

### Why merge, not rebase, on `master`

- Fork has its **own version history** (`@davidb-2107/capcut-cli` releases) — rewriting it on every sync would invalidate published tags.
- Merge commits make upstream provenance grep-able: `git log --merges --grep="Merge upstream"`.
- We DO rebase `feat/*` onto upstream before PR-back — that's where linear history matters.

### Sync runbook (executed monthly)

```bash
git fetch upstream
git checkout upstream-sync && git merge --ff-only upstream/master && git push
git checkout master
git merge --no-ff upstream-sync -m "Merge upstream/master @ <short-sha> — <YYYY-MM-DD> sync"
npm test                       # all fixtures from Point 2 must pass
git push
```

If tests fail: open `david/sync-YYYY-MM-DD-fixup` branch, resolve, then merge.

---

## 4. PR-back policy — what goes upstream

The fork exists to add features upstream is unlikely to want (psycho-build, opinionated keyframe presets). But we are courteous and reciprocal: anything that benefits the *general* `capcut-cli` user goes back.

### YES — open a PR back

| Category | Examples | Notes |
|---|---|---|
| Bug fixes in shared command paths | `info`, `segments`, `set-text`, `texts`, `export-srt` | Always. Same week as discovery. |
| Schema validation hardening | Defensive checks against malformed `draft_content.json` | Yes — universal value. |
| Cross-platform path handling fixes | Windows/macOS draft folder discovery | Yes. |
| Test infrastructure (generic) | `node:test` setup, the **anonymizer script** from Point 2, fixture loading utilities | Offer the script + a couple of fixtures (minimal + ken-burns). Stripped of psycho-niche artifacts. |
| Schema documentation | The portable parts of the JSON Bible (`docs/draft-schema/00-overview.md`, `01-tracks-and-segments.md`, `02-materials.md`) | Yes — but propose first via discussion. Upstream may want a different structure. |
| Better error messages, JSON shape consistency | E.g., aligning all commands to return `{ok: true, …}` | Yes if not breaking. |

### NO — fork-only

| Feature | Reason |
|---|---|
| `psycho-build` pipeline | Niche-specific; opinionated YAML manifest. |
| Ken Burns presets, paranoia-niche keyframe recipes | Opinionated; out of scope for a generic CLI. |
| `david/*` branded skill (`skills/capcut-david/`) | Conflicts with upstream's own Claude Code plugin. |
| Modular file split (`commands/edit.ts`, `commands/inspect.ts`, …) | Architectural choice; upstream chose single-file deliberately. Re-evaluate only if upstream signals interest. |
| README CTAs to Gumroad blueprints | Strip on import; don't piggyback on upstream's monetization. |

### MAYBE — propose first, build only if accepted

| Feature | Decision criteria |
|---|---|
| `add-keyframe` / `ken-burns` low-level commands | Open a discussion: "Would you accept a `keyframe` subcommand?" If yes → polish + PR. If no → keep fork-only. |
| Multi-platform fixture suite | If upstream has no tests, our fixtures + harness could become *the* test suite. Offer once. |

### PR-back workflow

1. Open a **GitHub Discussion** on upstream first: short pitch, ~3 sentences. Wait for a reaction (≤2 weeks).
2. If accepted in principle: rebase `feat/*` onto current `upstream/master`, run tests, open PR.
3. PR description must include: motivation, before/after, test coverage, link back to discussion.
4. **No squash on the upstream PR unless asked** — keep authorship trail intact.
5. After merge: pull the change back via the next monthly sync (do not double-apply).
6. If declined: convert the branch to `david/<feature>` and document the decision in `UPSTREAM.md` § 7 (Decision log).

---

## 5. Attribution — license obligations & courtesy

### MIT license requirements (legal minimum)

The MIT License requires **one** thing on redistribution: the original copyright notice + license text must be included.

**Concrete:**

1. **Keep `LICENSE` at repo root** with the upstream notice intact:
   ```
   MIT License

   Copyright (c) 2026 Rene Zander
   Copyright (c) 2026 David Beles            ← appended (our additions)
   ```
   Both copyrights coexist. We do NOT remove or rewrite Rene's line.

2. **Ship `LICENSE` in the npm tarball** (already true if `files: ["LICENSE", ...]` or no `files` field). The license travels with the package.

### NOTICE file (recommended, not required for MIT)

Create `NOTICE` at repo root:

```text
capcut-cli-david
================

This project is a fork of capcut-cli by Rene Zander, extended for the
TikTok psycho/paranoia niche and unified with creation primitives
inspired by cutcli.

Upstream:
  capcut-cli — https://github.com/renezander030/capcut-cli
  Copyright (c) 2026 Rene Zander
  MIT License — see LICENSE

Schema reverse-engineering inspiration:
  cutcli (closed-source Go binary) — https://github.com/guol1nag/cutcli-cookbook
  No code copied; schema documented from observed draft outputs.

Fork-specific additions and the psycho-build pipeline:
  Copyright (c) 2026 David Beles
  MIT License — see LICENSE
```

### README banner (top of file, before the badges)

```markdown
> **Fork of [renezander030/capcut-cli](https://github.com/renezander030/capcut-cli)** —
> the upstream CLI by Rene Zander, extended with creation primitives
> (keyframes, Ken Burns, animations) and an opinionated `psycho-build`
> pipeline for the TikTok paranoia/psycho niche.
> If you want the lean, general-purpose CLI: use upstream.
> If you want creation + niche pipelines: you're in the right place.
```

### What we do NOT carry over

- Upstream README's CTAs to the **Viral Story Shorts Blueprint** Gumroad link.
- Upstream's `utm_*` tracking on author/contact links.
- Upstream's marketplace.json plugin metadata (we ship our own).

These are not license-bound; removing them is courtesy — we don't redirect Rene's marketing funnel through our distribution.

### npm package metadata

```json
{
  "author": "David Beles <davidb-2107@users.noreply.github.com>",
  "contributors": [
    "Rene Zander <renezander030@gmail.com> (https://renezander.com) — original capcut-cli author"
  ],
  "license": "MIT",
  "repository": "github:Davidb-2107/capcut-cli-david"
}
```

The `contributors` field is the npm-native attribution surface — `npm view capcut-cli-david contributors` will surface Rene's credit.

---

## 6. Communication etiquette with upstream

### One-time: introduction

Within **7 days of public fork** (i.e., once the repo on GitHub is non-empty), open a single GitHub Discussion on `renezander030/capcut-cli`:

> **Heads-up: I'm maintaining a fork (`capcut-cli-david`) for niche use cases**
>
> Hi Rene — first, thanks for `capcut-cli`. I'm building a fork that adds creation primitives (keyframes, Ken Burns, in/out animations) and an opinionated `psycho-build` pipeline for the TikTok paranoia niche. None of that is general-purpose enough to belong in your CLI, so it lives in the fork.
>
> What I plan to send back: bug fixes in shared commands, schema docs, anonymized test fixtures, and any defensive-coding hardening that benefits all users.
>
> What I'll ask first: anything that touches the public CLI surface or output shape — I'll open a discussion before sending a PR.
>
> Repo: <fork URL> · License: MIT (yours preserved + appended). Happy to coordinate.

Then **stay quiet** until there's something concrete. No notifications, no follow-ups.

### Before diverging on a public surface

If we're about to change the shape of an existing CLI command (`info`, `segments`, `set-text`, `texts`, `export-srt`) — **open an upstream issue first**, even if we plan to keep the change fork-only:

> **Question: are you planning to change `<command>` output?**
>
> Asking because I'm about to add `<change>` in my fork and want to know whether a future upstream change will cause us to diverge on the same field. If you have plans, I'll align; if not, I'll document the divergence on my side.

This avoids painful re-merges later and signals respect for upstream's roadmap.

### Frequency limits

- **At most one discussion thread per month** unrelated to a concrete PR.
- **No PR carpet-bombing** — open one PR, get a reaction, then queue the next.
- If upstream goes silent for 30+ days mid-conversation: assume "not interested," convert the work to `david/*`, log it in § 7.

### What we never do

- Open issues to *complain* about upstream design decisions. Fork the behavior we want.
- Soft-deprecation pressure — we don't ask Rene to adopt our architecture.
- Duplicate-publish under a confusable name. Our npm name (Point 4) must not be `capcut-cli-fork` or anything that reads as "the real one."

---

## 7. Decision log (append-only)

Use this section to record divergences as they happen. One bullet per decision. Quote the upstream commit/discussion that triggered it.

| Date | Decision | Upstream context | Outcome |
|---|---|---|---|
| 2026-05-11 | Initial UPSTREAM.md — sync cadence monthly, branch model `master` + `upstream-sync` + `feat/*` + `david/*` | Snapshot frozen at upstream `c92233855` (v0.2.2, 2026-05-07) | This file. |
| 2026-08-11 | **Sync upstream ARRÊTÉ. Obligations d'attribution (§5) MAINTENUES.** La cadence mensuelle de §3 et le PR-back de §4 ne s'appliquent plus. `upstream-sync` reste gelée sur `c922338` comme référence historique ; ne plus la fast-forwarder. | Divergence MESURÉE ce jour, upstream à `1ee49dd` (v0.18.0), **201 commits** non intégrés depuis le fork : `git diff master upstream/master -- src/` = **70 fichiers, 55 531 insertions / 8 626 suppressions** ; sur 36 fichiers dans notre `src/` et 37 dans le leur, **2 noms en commun** (`draft.ts`, `index.ts`) — et tous deux réécrits. Upstream est parti sur une autre surface (`wikimedia.ts`, `version.ts`). | Un merge n'a plus de cible : il n'existe plus de code où appliquer leurs commits. Un correctif upstream qui nous concernerait (ex. `fix(time)` sur les durées négatives sub-demi-frame) se traite désormais comme un bug CHEZ NOUS — on écrit le test, on ne reprend pas le commit. Rien ne change côté légal : `LICENSE` (double copyright), `NOTICE`, la bannière README et `package.json.contributors` sont vérifiés en règle ce jour et le restent. |

---

## 8. Periodic review checklist (run quarterly)

Réduite au 2026-08-11 aux seuls points d'attribution — les 4 points de veille sync
(re-snapshot de §1, diff `master` vs `upstream-sync`, revue des branches `david/*`,
justification des releases non mergées) sont **retirés** : ils supposaient un sync
vivant. Voir §7.

- [ ] Update LICENSE copyright years if a new calendar year passed.
- [ ] Verify `NOTICE` URLs still resolve.
- [ ] Confirm npm `contributors` field still credits upstream.

---

## 9. Termination conditions

The fork ends — and is archived — if any of these become true:

| Condition | Outcome |
|---|---|
| Upstream merges all of our portable features (keyframes, ken-burns, fixtures) | Re-evaluate fork's reason to exist. Likely contract scope to *just* `psycho-build`. |
| Upstream is abandoned (≥180 days no commits) and we have inherited the user base | Open discussion: would Rene transfer the repo? If no, fork becomes the de-facto canonical, rebrand if needed. |
| We lose interest in maintaining the fork | Archive the GitHub repo, mark npm package deprecated with a pointer back to upstream. Do NOT silently abandon. |

---

## Sources

- [renezander030/capcut-cli](https://github.com/renezander030/capcut-cli) — upstream README, LICENSE, commit log (snapshot 2026-05-11)
- GitHub Community Discussion #48935 — "Sync fork with upstream via rebase, not merge"
- Joaquim Rocha — "How to fork: Best practices and guide" (2024)
- Pi-hole documentation — "How to fork and rebase" runbook
- [[wiki/analyses/2026-05-11-capcut-cli-david-project|capcut-cli-david — Project Master Plan]]
