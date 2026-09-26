#!/usr/bin/env node
// golden-output.mjs — characterization net for the ARCH workstream (PR 0, ticket 01).
//
// Captures, for every anonymized fixture in test-fixtures/fixtures/:
//   - stdout / stderr / exit code of every read-only command
//     (info, tracks, segments, texts, materials, segment, material, export-srt,
//     validate, validate --fix previews, query, --help, plus the capabilities surface via
//     `ui --print-path` and the dispatch error paths the registry must preserve)
//   - write round-trips on temp copies covering the in-place persistence
//     surface (M1): shift-all/shift/opacity/volume/speed/trim as byte-stable
//     pairs, remove-segment/set-text as two-copy determinism, and the
//     UUID-generating creators (add-text/add-keyframe/ken-burns/add-effect/
//     add-filter/add-transition/cut) as two-copy canonical-hash determinism,
//     plus validate --fix --apply on orphaned and blocked drafts.
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

import { strict as assert } from "node:assert";
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
 *
 * Also normalises BOM + CRLF→LF up front: a pinned clean refusal leaves the
 * fixture bytes untouched, so without this the hash would depend on the
 * checkout's CRLF (win) vs LF (linux) form (minimal-draft add-effect/
 * add-filter, animations-draft set-text diverged win→linux until normalised).
 */
export function canonicalize(text, pathTokens = []) {
  let out = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
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
  const expRt = new Map(expected.roundtrips.map((r) => [r.id, r]));
  const actRt = new Map(actual.roundtrips.map((r) => [r.id, r]));
  for (const [id, exp] of expRt) {
    const act = actRt.get(id);
    if (!act) {
      diffs.push(`missing round-trip: ${id}`);
      continue;
    }
    if (exp.matchesOriginal !== act.matchesOriginal)
      diffs.push(
        `${id}: round-trip matchesOriginal ${exp.matchesOriginal} vs ${act.matchesOriginal}` +
          " (did persistence start restoring pristine bytes?)",
      );
    if (exp.stableBytes !== act.stableBytes)
      diffs.push(`${id}: round-trip stableBytes ${exp.stableBytes} → ${act.stableBytes} (persistence not byte-stable)`);
    if ((exp.canonicalStable ?? null) !== (act.canonicalStable ?? null))
      diffs.push(
        `${id}: round-trip canonicalStable ${exp.canonicalStable} → ${act.canonicalStable}` +
          " (UUID-generating write no longer canonically deterministic)",
      );
    for (const field of ["backupEqualsOriginal", "orphansRemoved", "residualClean", "backupAbsent"]) {
      if ((exp[field] ?? null) !== (act[field] ?? null)) diffs.push(`${id}: ${field} ${exp[field]} → ${act[field]}`);
    }
    if (exp.contentSha256 !== act.contentSha256)
      diffs.push(`${id}: round-trip contentSha256 diverged (${exp.contentSha256} → ${act.contentSha256})`);
  }
  for (const id of actRt.keys()) {
    if (!expRt.has(id)) diffs.push(`extra round-trip: ${id}`);
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

// First segment id whose material lives in materials.<kind>s ("video" |
// "audio" | "text") — opacity/ken-burns/add-transition refuse non-video
// segments, set-text needs a text segment, volume targets audio.
function segmentIdByKind(fx, kind) {
  const ids = new Set((fx.materials?.[`${kind}s`] ?? []).map((m) => m.id));
  for (const track of fx.tracks ?? []) {
    for (const seg of track.segments ?? []) {
      if (ids.has(seg.material_id)) return seg.id;
    }
  }
  return null;
}

// M1 write-round-trip table — three deterministic shapes, picked per verb:
//   pair            op + inverse x2 on one copy; absolute-set/invertible edits
//                   converge, so the bytes after each pair must be identical.
//   twice           same one-way deterministic op on two fresh copies; the
//                   resulting bytes must be identical.
//   twice-canonical UUID-generating op on two fresh copies; raw bytes differ
//                   (recorded, not asserted) but canonical hashes must match
//                   (canonicalStable). Validated live: every pair verb below
//                   is byte-stable, fake resource ids are accepted, and the
//                   --write determinism gate re-proves all of it on each regen.
const PROBE_TEXT = "golden probe M1";
const WRITE_ROUNDTRIPS = [
  {
    verb: "shift-all",
    mode: "pair",
    needs: null,
    steps: ({ a }) => [
      { suffix: "shift-all+500ms", argv: ["shift-all", a, "+500ms"] },
      { suffix: "shift-all-500ms", argv: ["shift-all", a, "-500ms"] },
      { suffix: "shift-all+250ms", argv: ["shift-all", a, "+250ms"] },
      { suffix: "shift-all-250ms", argv: ["shift-all", a, "-250ms"] },
    ],
  },
  {
    verb: "shift",
    mode: "pair",
    needs: "any",
    steps: ({ a }, s) => [
      { suffix: "shift+500ms", argv: ["shift", a, s.any, "+500ms"] },
      { suffix: "shift-500ms", argv: ["shift", a, s.any, "-500ms"] },
      { suffix: "shift+250ms", argv: ["shift", a, s.any, "+250ms"] },
      { suffix: "shift-250ms", argv: ["shift", a, s.any, "-250ms"] },
    ],
  },
  {
    verb: "opacity",
    mode: "pair",
    needs: "video",
    steps: ({ a }, s) => [
      { suffix: "opacity-0.5", argv: ["opacity", a, s.video, "0.5"] },
      { suffix: "opacity-1.0", argv: ["opacity", a, s.video, "1.0"] },
      { suffix: "opacity-0.5#2", argv: ["opacity", a, s.video, "0.5"] },
      { suffix: "opacity-1.0#2", argv: ["opacity", a, s.video, "1.0"] },
    ],
  },
  {
    verb: "volume",
    mode: "pair",
    needs: "audio",
    steps: ({ a }, s) => [
      { suffix: "volume-0.5", argv: ["volume", a, s.audio, "0.5"] },
      { suffix: "volume-1.0", argv: ["volume", a, s.audio, "1.0"] },
      { suffix: "volume-0.5#2", argv: ["volume", a, s.audio, "0.5"] },
      { suffix: "volume-1.0#2", argv: ["volume", a, s.audio, "1.0"] },
    ],
  },
  {
    verb: "speed",
    mode: "pair",
    needs: "video",
    steps: ({ a }, s) => [
      { suffix: "speed-2.0", argv: ["speed", a, s.video, "2.0"] },
      { suffix: "speed-1.0", argv: ["speed", a, s.video, "1.0"] },
      { suffix: "speed-2.0#2", argv: ["speed", a, s.video, "2.0"] },
      { suffix: "speed-1.0#2", argv: ["speed", a, s.video, "1.0"] },
    ],
  },
  {
    verb: "trim",
    mode: "pair",
    needs: "any",
    steps: ({ a }, s) => [
      { suffix: "trim-500ms", argv: ["trim", a, s.any, "0", "500ms"] },
      { suffix: "trim-250ms", argv: ["trim", a, s.any, "0", "250ms"] },
      { suffix: "trim-500ms#2", argv: ["trim", a, s.any, "0", "500ms"] },
      { suffix: "trim-250ms#2", argv: ["trim", a, s.any, "0", "250ms"] },
    ],
  },
  {
    verb: "remove-segment",
    mode: "twice",
    needs: "any",
    steps: ({ a, b }, s) => [
      { suffix: "remove-segment#a", argv: ["remove-segment", a, s.any] },
      { suffix: "remove-segment#b", argv: ["remove-segment", b, s.any] },
    ],
  },
  {
    verb: "set-text",
    mode: "twice",
    needs: "text",
    steps: ({ a, b }, s) => [
      { suffix: "set-text#a", argv: ["set-text", a, s.text, PROBE_TEXT] },
      { suffix: "set-text#b", argv: ["set-text", b, s.text, PROBE_TEXT] },
    ],
  },
  {
    verb: "add-text",
    mode: "twice-canonical",
    needs: null,
    steps: ({ a, b }) => [
      { suffix: "add-text#a", argv: ["add-text", a, "0", "1s", PROBE_TEXT] },
      { suffix: "add-text#b", argv: ["add-text", b, "0", "1s", PROBE_TEXT] },
    ],
  },
  {
    verb: "add-keyframe",
    mode: "twice-canonical",
    needs: "any",
    steps: ({ a, b }, s) => [
      { suffix: "add-keyframe#a", argv: ["add-keyframe", a, s.any, "0", "--property", "scale_x", "--value", "1.5"] },
      { suffix: "add-keyframe#b", argv: ["add-keyframe", b, s.any, "0", "--property", "scale_x", "--value", "1.5"] },
    ],
  },
  {
    verb: "ken-burns",
    mode: "twice-canonical",
    needs: "video",
    steps: ({ a, b }, s) => [
      { suffix: "ken-burns#a", argv: ["ken-burns", a, s.video, "--from", "1.0", "--to", "1.08"] },
      { suffix: "ken-burns#b", argv: ["ken-burns", b, s.video, "--from", "1.0", "--to", "1.08"] },
    ],
  },
  {
    verb: "add-effect",
    mode: "twice-canonical",
    needs: null,
    steps: ({ a, b }) => [
      { suffix: "add-effect#a", argv: ["add-effect", a, "golden-probe-rid", "GoldenProbe", "--full"] },
      { suffix: "add-effect#b", argv: ["add-effect", b, "golden-probe-rid", "GoldenProbe", "--full"] },
    ],
  },
  {
    verb: "add-filter",
    mode: "twice-canonical",
    needs: null,
    steps: ({ a, b }) => [
      { suffix: "add-filter#a", argv: ["add-filter", a, "golden-probe-rid", "GoldenProbeF", "--full"] },
      { suffix: "add-filter#b", argv: ["add-filter", b, "golden-probe-rid", "GoldenProbeF", "--full"] },
    ],
  },
  {
    verb: "add-transition",
    mode: "twice-canonical",
    needs: "video",
    steps: ({ a, b }, s) => [
      { suffix: "add-transition#a", argv: ["add-transition", a, s.video, "golden-probe-rid", "GoldenProbeT"] },
      { suffix: "add-transition#b", argv: ["add-transition", b, s.video, "golden-probe-rid", "GoldenProbeT"] },
    ],
  },
  {
    verb: "cut",
    mode: "twice-canonical",
    needs: "any",
    steps: ({ a, b, dir }) => [
      {
        suffix: "cut#a",
        argv: ["cut", a, "0", "500ms", "--out", join(dir, "cut-a.json")],
        reads: join(dir, "cut-a.json"),
      },
      {
        suffix: "cut#b",
        argv: ["cut", b, "0", "500ms", "--out", join(dir, "cut-b.json")],
        reads: join(dir, "cut-b.json"),
      },
    ],
  },
];

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

    const run = (argv, normalize = canon) => {
      // runCli bypasses the "CapCut is open" guard (CAPCUT_DAVID_FORCE=1).
      const r = runCli(argv);
      return { exit: r.status, stdout: normalize(r.stdout ?? ""), stderr: normalize(r.stderr ?? "") };
    };

    const captures = [];
    const cap = (id, argv, normalize = canon) => {
      const capture = { id, argv: argv.map((a) => normalize(a)), ...run(argv, normalize) };
      captures.push(capture);
      return capture;
    };
    const skip = (id, reason) => {
      captures.push({ id, argv: [], exit: null, stdout: "", stderr: "", skipped: reason });
    };

    // -- Global read-only surface ------------------------------------------
    cap("global/help", ["--help"]);
    cap("global/help-no-args", []);
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
    cap("errors/empty-verb", [""]);
    cap("errors/empty-verb-with-project", ["", join(FIXTURES_DIR, "minimal-draft.json")]);
    cap("errors/help-after-quiet", ["-q", "--help"]);
    cap("errors/help-after-human", ["-H", "--help"]);
    cap("errors/short-help-after-human", ["-H", "-h"]);

    // -- Per-fixture read-only commands --------------------------------------
    const READ_ONLY = ["info", "tracks", "segments", "texts", "materials", "export-srt"];
    for (const key of FIXTURE_KEYS) {
      const fp = join(FIXTURES_DIR, `${key}.json`);
      for (const verb of READ_ONLY) cap(`${key}/${verb}`, [verb, fp]);
      cap(`${key}/validate`, ["validate", fp, "--projects-root", emptyRoot]);
      const preview = join(tmpRoot, `dry-${key}.json`);
      copyFileSync(fp, preview);
      const before = readFileSync(preview);
      cap(`${key}/validate-fix`, ["validate", preview, "--fix", "--projects-root", emptyRoot]);
      assert.ok(readFileSync(preview).equals(before), `${key}: validate --fix wrote draft bytes`);
      assert.ok(!existsSync(`${preview}.bak`), `${key}: validate --fix wrote a backup`);
      const fx = JSON.parse(readFileSync(fp, "utf-8"));
      const segId = firstSegmentId(fx);
      if (segId) cap(`${key}/segment`, ["segment", fp, segId]);
      else skip(`${key}/segment`, "no segment in fixture");
      const matId = firstMaterialId(fx);
      if (matId) cap(`${key}/material`, ["material", fp, matId]);
      else skip(`${key}/material`, "no material in fixture");
    }

    // -- Write round-trips on temp copies --------------------------------------
    // shift-all generates no UUIDs, so the persisted bytes are deterministic.
    // +N then -N is an exact inverse (all starts stay >= 0 after the +N leg, so
    // the clamp at 0 never fires on the way back). Two nested round-trips:
    // the file bytes after each must be identical — any persistence drift
    // (ordering, reformatting, hidden state) breaks byte stability.
    // M1 generalises this to the whole in-place writer surface (see
    // WRITE_ROUNDTRIPS). Each verb gets its OWN fresh copies (a/b) — sharing
    // one mutated copy across verbs would make cross-copy comparisons
    // meaningless (a's history would differ from b's).
    const roundtrips = [];
    for (const key of FIXTURE_KEYS) {
      const dir = join(tmpRoot, `rt-${key}`);
      mkdirSync(dir, { recursive: true });
      const src = join(FIXTURES_DIR, `${key}.json`);
      const segs = (() => {
        const fx = JSON.parse(readFileSync(src, "utf-8"));
        return {
          any: firstSegmentId(fx),
          video: segmentIdByKind(fx, "video"),
          audio: segmentIdByKind(fx, "audio"),
          text: segmentIdByKind(fx, "text"),
        };
      })();
      for (const rt of WRITE_ROUNDTRIPS) {
        const id = `roundtrip/${key}/${rt.verb}`;
        if (rt.needs && !segs[rt.needs]) {
          skip(id, `no ${rt.needs} segment in fixture`);
          continue;
        }
        const a = join(dir, `a-${rt.verb}.json`);
        const b = join(dir, `b-${rt.verb}.json`);
        copyFileSync(src, a);
        copyFileSync(src, b);
        const pristine = readFileSync(a);
        const steps = rt.steps({ a, b, dir }, segs);
        if (rt.mode === "pair") {
          cap(`${id}/${steps[0].suffix}`, steps[0].argv);
          cap(`${id}/${steps[1].suffix}`, steps[1].argv);
          const bytes1 = readFileSync(steps[1].reads ?? a);
          cap(`${id}/${steps[2].suffix}`, steps[2].argv);
          cap(`${id}/${steps[3].suffix}`, steps[3].argv);
          const bytes2 = readFileSync(steps[3].reads ?? a);
          roundtrips.push({
            id,
            verb: rt.verb,
            mode: rt.mode,
            stableBytes: bytes1.equals(bytes2),
            // Persistence normalizes serialization (a round-trip does NOT
            // restore the pristine fixture bytes) — pinned, not asserted: any
            // change in this fact is a contract change the baseline surfaces.
            matchesOriginal: bytes1.equals(pristine),
            contentSha256: canonicalHash(bytes1.toString("utf-8"), pathTokens),
          });
        } else {
          // twice / twice-canonical: same op on two fresh copies.
          cap(`${id}/${steps[0].suffix}`, steps[0].argv);
          const bytes1 = readFileSync(steps[0].reads ?? a);
          cap(`${id}/${steps[1].suffix}`, steps[1].argv);
          const bytes2 = readFileSync(steps[1].reads ?? b);
          const h1 = canonicalHash(bytes1.toString("utf-8"), pathTokens);
          const h2 = canonicalHash(bytes2.toString("utf-8"), pathTokens);
          roundtrips.push({
            id,
            verb: rt.verb,
            mode: rt.mode,
            // For twice-canonical verbs raw byte equality is expected to be
            // false (UUID churn) — recorded, but the asserted signal is
            // canonicalStable: identical canonicalized content across copies.
            stableBytes: bytes1.equals(bytes2),
            canonicalStable: h1 === h2,
            matchesOriginal: bytes1.equals(pristine),
            contentSha256: h1,
          });
        }
      }
    }

    // A bare-file input limits --fix to gc, so this pins the destructive path
    // and its re-validation without involving machine-local meta stores.
    const source = JSON.parse(readFileSync(join(FIXTURES_DIR, "minimal-draft.json"), "utf-8"));
    source.materials.texts.push({ id: "golden-orphan-text", type: "text", content: "{}" });
    source.materials.videos.push({ id: "golden-orphan-video", type: "video", path: "golden-orphan.mp4" });
    const applyDir = join(tmpRoot, "validate-fix");
    mkdirSync(applyDir);
    const a = join(applyDir, "orphan-a.json");
    const b = join(applyDir, "orphan-b.json");
    const pristine = Buffer.from(`${JSON.stringify(source, null, 2)}\n`);
    writeFileSync(a, pristine);
    writeFileSync(b, pristine);
    const apply = (path, suffix) => {
      const normalize = (s) => canonicalize(s, [["<DRAFT>", path], ...pathTokens]);
      return cap(
        `validate-fix/orphans/apply#${suffix}`,
        ["validate", path, "--fix", "--apply", "--projects-root", emptyRoot],
        normalize,
      );
    };
    const appliedA = apply(a, "a");
    const appliedB = apply(b, "b");
    assert.deepEqual(
      [appliedA.exit, appliedA.stdout, appliedA.stderr],
      [appliedB.exit, appliedB.stdout, appliedB.stderr],
      "validate --fix --apply output differs between fresh copies",
    );
    assert.equal(appliedA.exit, 0, "validate --fix --apply failed");
    const bytesA = readFileSync(a);
    const bytesB = readFileSync(b);
    assert.ok(bytesA.equals(bytesB), "validate --fix --apply wrote different bytes between fresh copies");
    const post = JSON.parse(bytesA.toString("utf-8"));
    const residual = JSON.parse(appliedA.stdout).fix.residual;
    const orphansRemoved =
      !post.materials.texts.some((m) => m.id === "golden-orphan-text") &&
      !post.materials.videos.some((m) => m.id === "golden-orphan-video");
    const residualClean = residual && !residual.findings.some((f) => f.id.startsWith("materials.orphan_"));
    const backupEqualsOriginal = readFileSync(`${a}.bak`).equals(pristine) && readFileSync(`${b}.bak`).equals(pristine);
    assert.ok(
      orphansRemoved && residualClean && backupEqualsOriginal,
      "validate --fix --apply left orphans or lost backup bytes",
    );
    roundtrips.push({
      id: "roundtrip/validate-fix/orphans",
      mode: "twice",
      stableBytes: bytesA.equals(bytesB),
      matchesOriginal: bytesA.equals(pristine),
      contentSha256: canonicalHash(bytesA.toString("utf-8"), pathTokens),
      backupEqualsOriginal,
      orphansRemoved,
      residualClean: Boolean(residualClean),
    });

    // Duplicate material id blocks the same gc candidate before any write.
    const blocked = join(applyDir, "blocked.json");
    source.materials.texts.push({ id: "golden-orphan-text", type: "text", content: "{}" });
    const blockedBytes = Buffer.from(`${JSON.stringify(source, null, 2)}\n`);
    writeFileSync(blocked, blockedBytes);
    const blockedCapture = cap(
      "validate-fix/blocked/apply",
      ["validate", blocked, "--fix", "--apply", "--projects-root", emptyRoot],
      (s) => canonicalize(s, [["<DRAFT>", blocked], ...pathTokens]),
    );
    assert.equal(blockedCapture.exit, 2, "validate --fix --apply did not refuse duplicate id");
    assert.equal(JSON.parse(blockedCapture.stdout).fix.blocked, true, "validate --fix --apply did not report blocked");
    assert.ok(readFileSync(blocked).equals(blockedBytes), "blocked validate --fix --apply wrote draft bytes");
    assert.ok(!existsSync(`${blocked}.bak`), "blocked validate --fix --apply wrote a backup");
    roundtrips.push({
      id: "roundtrip/validate-fix/blocked",
      mode: "refusal",
      stableBytes: true,
      matchesOriginal: true,
      contentSha256: canonicalHash(blockedBytes.toString("utf-8"), pathTokens),
      backupAbsent: true,
    });

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
