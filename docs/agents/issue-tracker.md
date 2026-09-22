# Issue tracker: local markdown

Issues and specs for this repo live as markdown files under `.scratch/<feature>/issues/` in this repo (one file per ticket, numbered in dependency order, blockers first). The spec of a workstream lives next to them (e.g. `00-spec-*.md`).

## Conventions

- **One file per ticket**, named `NN-slug.md`, numbered from 01 in dependency order (blockers first); the workstream spec is `00-*.md`.
- **Status line** in each ticket: `ready-for-agent`, `in-progress`, or `done`.
- **Blocked by** is a text line referencing ticket numbers/titles in the same folder.
- Work the frontier: any ticket whose blockers are all done.

## Why local

Solo project; GitHub Issues are disabled on this repository. This file previously described a GitHub Issues setup (via `gh`) that was never used - switched on 2026-09-22 when the ARCH workstream needed a tracker.
