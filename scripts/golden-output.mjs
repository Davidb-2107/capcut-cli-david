#!/usr/bin/env node
// golden-output.mjs — characterization net for the ARCH workstream (PR 0, ticket 01).
//
// Captures, for every anonymized fixture in test-fixtures/fixtures/:
//   - stdout / stderr / exit code of every read-only command
//     (info, tracks, segments, texts, materials, segment, material, export-srt,
//     validate without --fix, query, --help, plus the capabilities surface via
//     `ui --print-path` and the dispatch error paths the registry must preserve)
//   - a write round-trip on temp copies: shift-all +500ms/-500ms then
//     +250ms/-250ms must leave byte-identical files (persistence stability).
//
// Captures are canonicalized before comparison — generated UUIDs become <UUID>,
// repo/tmp/fixture paths become <ROOT>/<TMP>/<FIXTURES> tokens (precedent:
// test/batch-media.test.mjs) — then diffed against the committed baseline at
// test-fixtures/golden/baseline.json.
//
// Usage:
//   node scripts/golden-output.mjs --write   regenerate the baseline (runs the
//                                            captures twice and refuses to
//                                            commit a non-deterministic one)
//   node scripts/golden-output.mjs --check   diff against the baseline, exit 1
//                                            on any unexplained divergence (CI)
//
// Requires a prior `npm run build` (the net drives dist/index.js, the real
// process boundary — the highest seam).

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { FIXTURES } from "../test/helpers/load-fixture.mjs";
import { BIN, runCli } from "../test/helpers/spawn-cli.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES_DIR = join(ROOT, "test-fixtures", "fixtures");
const BASELINE_PATH = join(ROOT, "test-fixtures", "golden", "baseline.json");

// Single source of truth: the FIXTURE_MAP keys mirrored in
// test/helpers/load-fixture.mjs (adding a fixture there extends this net
// automatically, and the baseline diff will demand a regenerated baseline).
export const FIXTURE_KEYS = Object.freeze(Object.values(FIXTURES));

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

// --- Pure seam (unit-tested in test/golden-output.test.mjs) -----------------

/**
 * Replace machine/run-specific fragments with stable tokens:
 *   1. configured absolute paths → their token, in JSON-escaped (`\\`),
 *      native (`\`) and forward-slash forms (longest path first so
 *      <FIXTURES> beats <ROOT>);
 *   2. on lines carrying a path token, remaining separators → `/` (Windows
 *      vs POSIX emitters; `\\` first, then lone `\`);
 *   3. every UUID → <UUID> (generated ids must not break the baseline).
 */
export function canonicalize(text, pathTokens = []) {
  let out = text;
  const sorted = [...pathTokens].sort((a, b) => b[1].length - a[1].length);
  for (const [token, p] of sorted) {
    if (!p) continue;
    // JSON.stringify escapes backslashes: a Windows path printed inside a
    // JSON payload appears with doubled separators (validate's "project").
    const esc = p.replaceAll("\\", "\\\\");
    if (esc !== p) out = out.split(esc).join(token);
    out = out.split(p).join(token);
    const fwd = p.replaceAll("\\", "/");
    if (fwd !== p) out = out.split(fwd).join(token);
  }
  if (sorted.length > 0) {
    const tokenRe = new RegExp(sorted.map(([t]) => t.replace(/[<>]/g, "\\$&")).join("|"));
    out = out
      .split("\n")
      .map((line) => (tokenRe.test(line) ? line.replaceAll("\\\\", "/").replaceAll("\\", "/") : line))
      .join("\n");
  }
  return out.replace(UUID_RE, "<UUID>");
}

/** sha256 over the canonicalized content — stable across machines and runs. */
export function canonicalHash(text, pathTokens = []) {
  return createHash("sha256").update(canonicalize(text, pathTokens), "utf8").digest("hex");
}

function firstDiffLine(expected, actual) {
  const a = expected.split("\n");
  const b = actual.split("\n");
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      const fmt = (s) => (s === undefined ? "<absent>" : JSON.stringify(s.length > 200 ? `${s.slice(0, 200)}…` : s));
      return `line ${i + 1}: baseline ${fmt(a[i])} vs current ${fmt(b[i])} (lengths ${expected.length}/${actual.length})`;
    }
  }
  return `identical lines but different bytes (lengths ${expected.length}/${actual.length})`;
}

/**
 * Structural diff of two baselines. Returns an array of human-readable
 * divergence lines; empty array = the PR preserves the output contracts.
 */
export function diffBaselines(expected, actual) {
  const diffs = [];
  if (expected.version !== actual.version) diffs.push(`baseline version ${expected.version} vs ${actual.version}`);
  const expCaps = new Map(expected.captures.map((c) => [c.id, c]));
  const actCaps = new Map(actual.captures.map((c) => [c.id, c]));
  for (const [id, exp] of expCaps) {
    const act = actCaps.get(id);
    if (!act) {
      diffs.push(`missing capture: ${id}`);
      continue;
    }
    if (JSON.stringify(exp.argv) !== JSON.stringify(act.argv))
      diffs.push(`${id}: argv ${JSON.stringify(exp.argv)} vs ${JSON.stringify(act.argv)}`);
    if ((exp.skipped ?? null) !== (act.skipped ?? null))
      diffs.push(`${id}: skipped reason "${exp.skipped}" vs "${act.skipped}"`);
    if (exp.exit !== act.exit) diffs.push(`${id}: exit code ${exp.exit} → ${act.exit}`);
    for (const field of ["stdout", "stderr"]) {
      if (exp[field] !== act[field]) diffs.push(`${id}: ${field} diverged — ${firstDiffLine(exp[field], act[field])}`);
    }
  }
  for (const id of actCaps.keys()) {
    if (!expCaps.has(id)) diffs.push(`extra capture: ${id}`);
  }
  const expRt = new Map(expected.roundtrips.map((r) => [r.fixture, r]));
  const actRt = new Map(actual.roundtrips.map((r) => [r.fixture, r]));
  for (const [fixture, exp] of expRt) {
    const act = actRt.get(fixture);
    if (!act) {
      diffs.push(`missing round-trip: ${fixture}`);
      continue;
    }
    if (exp.matchesOriginal !== act.matchesOriginal)
      diffs.push(
        `${fixture}: round-trip matchesOriginal ${exp.matchesOriginal} vs ${act.matchesOriginal}` +
          " (did persistence start restoring pristine bytes?)",
      );
    if (exp.stableBytes !== act.stableBytes)
      diffs.push(
        `${fixture}: round-trip stableBytes ${exp.stableBytes} → ${act.stableBytes} (persistence not byte-stable)`,
      );
    if (exp.contentSha256 !== act.contentSha256)
      diffs.push(`${fixture}: round-trip contentSha256 diverged (${exp.contentSha256} → ${act.contentSha256})`);
  }
  for (const fixture of actRt.keys()) {
    if (!expRt.has(fixture)) diffs.push(`extra round-trip: ${fixture}`);
  }
  return diffs;
}

// --- Capture machinery (process boundary) ------------------------------------

function firstSegmentId(fx) {
  for (const track of fx.tracks ?? []) {
    if (track.segments?.length > 0) return track.segments[0].id;
  }
  return null;
}

function firstMaterialId(fx) {
  for (const slot of Object.values(fx.materials ?? {})) {
    if (Array.isArray(slot)) {
      for (const item of slot) {
        if (item && typeof item === "object" && item.id) return item.id;
      }
    }
  }
  return null;
}

function captureAll() {
  const tmpRoot = mkdtempSync(join(tmpdir(), "capcut-golden-"));
  try {
    // A deterministic drafts root for `query --all`: one folder per fixture,
    // named by fixture key so `from_drafts` is stable across machines.
    const queryRoot = join(tmpRoot, "query-root");
    // An empty projects root for `validate --projects-root`: the meta.* checks
    // degrade to "skipped" identically on every machine (never reads the host's
    // real root_meta_info.json).
    const emptyRoot = join(tmpRoot, "empty-projects-root");
    for (const key of FIXTURE_KEYS) {
      const dir = join(queryRoot, key);
      mkdirSync(dir, { recursive: true });
      copyFileSync(join(FIXTURES_DIR, `${key}.json`), join(dir, "draft_content.json"));
    }
    mkdirSync(emptyRoot, { recursive: true });

    const pathTokens = [
      ["<FIXTURES>", FIXTURES_DIR],
      ["<TMP>", tmpRoot],
      ["<ROOT>", ROOT],
    ];
    const canon = (s) => canonicalize(s ?? "", pathTokens);

    const run = (argv) => {
      // runCli bypasses the "CapCut is open" guard (CAPCUT_DAVID_FORCE=1).
      const r = runCli(argv);
      return { exit: r.status, stdout: canon(r.stdout), stderr: canon(r.stderr) };
    };

    const captures = [];
    const cap = (id, argv) => {
      captures.push({ id, argv: argv.map((a) => canon(a)), ...run(argv) });
    };
    const skip = (id, reason) => {
      captures.push({ id, argv: [], exit: null, stdout: "", stderr: "", skipped: reason });
    };

    // -- Global read-only surface ------------------------------------------
    cap("global/help", ["--help"]);
    // No version path exists yet (00-spec line 28 requires the registry to
    // cover "aide, version, erreurs de parsing") — this pins the CURRENT
    // behaviour so ticket 03's registry can't silently change it.
    cap("global/version-flag", ["--version"]);
    // Capabilities surface: the `ui` verb is the read-only discovery entry
    // point; --print-path emits the embedded page path without opening a
    // browser (there is no `capabilities` verb in the dispatcher).
    cap("global/capabilities-ui-path", ["ui", "--print-path"]);
    cap("global/query-all", ["query", "--all", "--drafts", queryRoot]);
    // Dispatch error paths — the registry refactor must preserve these.
    cap("errors/unknown-verb", ["definitely-not-a-verb", join(FIXTURES_DIR, "minimal-draft.json")]);
    cap("errors/missing-project-path", ["info"]);

    // -- Per-fixture read-only commands --------------------------------------
    const READ_ONLY = ["info", "tracks", "segments", "texts", "materials", "export-srt"];
    for (const key of FIXTURE_KEYS) {
      const fp = join(FIXTURES_DIR, `${key}.json`);
      for (const verb of READ_ONLY) cap(`${key}/${verb}`, [verb, fp]);
      cap(`${key}/validate`, ["validate", fp, "--projects-root", emptyRoot]);
      const fx = JSON.parse(readFileSync(fp, "utf-8"));
      const segId = firstSegmentId(fx);
      if (segId) cap(`${key}/segment`, ["segment", fp, segId]);
      else skip(`${key}/segment`, "no segment in fixture");
      const matId = firstMaterialId(fx);
      if (matId) cap(`${key}/material`, ["material", fp, matId]);
      else skip(`${key}/material`, "no material in fixture");
    }

    // -- Write round-trip on temp copies --------------------------------------
    // shift-all generates no UUIDs, so the persisted bytes are deterministic.
    // +N then -N is an exact inverse (all starts stay ≥ 0 after the +N leg, so
    // the clamp at 0 never fires on the way back). Two nested round-trips:
    // the file bytes after each must be identical — any persistence drift
    // (ordering, reformatting, hidden state) breaks byte stability.
    const roundtrips = [];
    for (const key of FIXTURE_KEYS) {
      const dir = join(tmpRoot, `rt-${key}`);
      mkdirSync(dir, { recursive: true });
      const fp = join(dir, "draft_content.json");
      copyFileSync(join(FIXTURES_DIR, `${key}.json`), fp);
      const pristine = readFileSync(fp);
      cap(`roundtrip/${key}/shift-all+500ms`, ["shift-all", fp, "+500ms"]);
      cap(`roundtrip/${key}/shift-all-500ms`, ["shift-all", fp, "-500ms"]);
      const bytes1 = readFileSync(fp);
      cap(`roundtrip/${key}/shift-all+250ms`, ["shift-all", fp, "+250ms"]);
      cap(`roundtrip/${key}/shift-all-250ms`, ["shift-all", fp, "-250ms"]);
      const bytes2 = readFileSync(fp);
      roundtrips.push({
        fixture: key,
        stableBytes: bytes1.equals(bytes2),
        // Persistence normalizes serialization (a +N/−N round-trip does NOT
        // restore the pristine fixture bytes) — pinned, not asserted: any
        // change in this fact is a contract change the baseline must surface.
        matchesOriginal: bytes1.equals(pristine),
        contentSha256: canonicalHash(bytes1.toString("utf-8"), pathTokens),
      });
    }

    return { version: 1, captures, roundtrips };
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}

// Any leftover host-specific absolute path in the canonicalized captures would
// make the baseline un-reproducible on another machine — fail loudly instead.
function assertNoHostResidue(baseline) {
  const hosts = [homedir(), tmpdir()].filter(Boolean);
  for (const c of baseline.captures) {
    for (const field of ["stdout", "stderr"]) {
      for (const h of hosts) {
        const forms = [h, h.replaceAll("\\", "/"), h.replaceAll("\\", "\\\\")];
        if (forms.some((f) => c[field].includes(f))) {
          throw new Error(`capture ${c.id} still contains host path ${h} after canonicalization — extend pathTokens`);
        }
      }
    }
  }
}

function main() {
  const mode = process.argv[2];
  if (mode !== "--write" && mode !== "--check") {
    console.error("Usage: node scripts/golden-output.mjs --write|--check");
    process.exit(2);
  }
  if (!existsSync(BIN)) {
    console.error("dist/index.js is missing — run `npm run build` first.");
    process.exit(2);
  }

  if (mode === "--write") {
    // Determinism gate: a baseline we cannot reproduce is worse than none.
    const a = captureAll();
    const b = captureAll();
    const selfDiff = diffBaselines(a, b);
    if (selfDiff.length > 0) {
      console.error("Refusing to write a non-deterministic baseline:");
      for (const d of selfDiff) console.error(`  ${d}`);
      process.exit(1);
    }
    assertNoHostResidue(a);
    mkdirSync(dirname(BASELINE_PATH), { recursive: true });
    writeFileSync(BASELINE_PATH, `${JSON.stringify(a, null, 2)}\n`);
    console.log(
      `golden-output: baseline written — ${a.captures.length} captures, ${a.roundtrips.length} round-trips → ${BASELINE_PATH}`,
    );
    return;
  }

  // --check
  if (!existsSync(BASELINE_PATH)) {
    console.error(`Golden baseline missing: ${BASELINE_PATH} — run \`node scripts/golden-output.mjs --write\`.`);
    process.exit(2);
  }
  let expected;
  try {
    expected = JSON.parse(readFileSync(BASELINE_PATH, "utf-8"));
  } catch (err) {
    console.error(
      `Golden baseline is not valid JSON: ${BASELINE_PATH} (${err.message}) — regenerate with \`node scripts/golden-output.mjs --write\`.`,
    );
    process.exit(2);
  }
  const actual = captureAll();
  assertNoHostResidue(actual);
  const diffs = diffBaselines(expected, actual);
  if (diffs.length > 0) {
    console.error(`golden-output: ${diffs.length} divergence(s) vs ${BASELINE_PATH}:`);
    for (const d of diffs) console.error(`  ${d}`);
    console.error(
      "If this divergence is intended, regenerate: node scripts/golden-output.mjs --write (and justify it in the PR).",
    );
    process.exit(1);
  }
  console.log(
    `golden-output: OK — ${actual.captures.length} captures + ${actual.roundtrips.length} round-trips match the baseline.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
