// golden-output.test.mjs — unit tests for the pure seam of
// scripts/golden-output.mjs (canonicalize / canonicalHash / diffBaselines).
//
// The golden-output net itself (process-boundary captures) lives in the
// dedicated CI job; here we pin the canonicalization rules — the same
// precedent as test/batch-media.test.mjs (UUIDs + tmp paths → stable tokens)
// — and the baseline-diff semantics that decide pass/fail.

import { deepStrictEqual, notStrictEqual, ok, strictEqual } from "node:assert";
import { test } from "node:test";

import { canonicalHash, canonicalize, diffBaselines } from "../scripts/golden-output.mjs";

const TOKENS = [
  ["<FIXTURES>", "C:\\repo\\test-fixtures\\fixtures"],
  ["<TMP>", "C:\\Users\\x\\AppData\\Local\\Temp\\capcut-golden-abc123"],
  ["<ROOT>", "C:\\repo"],
];

// --- canonicalize ----------------------------------------------------------

test("canonicalize: generated UUIDs become <UUID>", () => {
  const out = canonicalize('{"id":"3f8b2c1a-9e4d-4a5b-8c7d-1e2f3a4b5c6d"}', []);
  strictEqual(out, '{"id":"<UUID>"}');
});

test("canonicalize: UUID replacement is case-insensitive and global", () => {
  const out = canonicalize("3F8B2C1A-9E4D-4A5B-8C7D-1E2F3A4B5C6D 3f8b2c1a-9e4d-4a5b-8c7d-1e2f3a4b5c6d", []);
  strictEqual(out, "<UUID> <UUID>");
});

test("canonicalize: configured paths become tokens (native + forward-slash forms)", () => {
  const native = canonicalize("found C:\\repo\\test-fixtures\\fixtures\\minimal-draft.json ok", TOKENS);
  strictEqual(native, "found <FIXTURES>/minimal-draft.json ok");
  const fwd = canonicalize("found C:/repo/test-fixtures/fixtures/minimal-draft.json ok", TOKENS);
  strictEqual(fwd, "found <FIXTURES>/minimal-draft.json ok");
});

test("canonicalize: longest path wins (fixtures dir before repo root)", () => {
  const out = canonicalize("C:\\repo\\test-fixtures\\fixtures\\a.json C:\\repo\\dist\\index.js", TOKENS);
  strictEqual(out, "<FIXTURES>/a.json <ROOT>/dist/index.js");
});

test("canonicalize: backslashes are normalized on lines carrying a path token", () => {
  const out = canonicalize("C:\\repo\\dist\\ui\\index.html\n", TOKENS);
  strictEqual(out, "<ROOT>/dist/ui/index.html\n");
});

test("canonicalize: fixture-data backslashes survive when no token is on the line", () => {
  const line = '{"path":"##_draftpath_##\\Resources\\mat.mp4"}';
  strictEqual(canonicalize(line, TOKENS), line);
});

test("canonicalize: plain text passes through untouched", () => {
  strictEqual(canonicalize("hello world\n", TOKENS), "hello world\n");
});

test("canonicalize: BOM and CRLF are normalised (win/linux checkout parity)", () => {
  strictEqual(canonicalize("\uFEFFhello\r\nworld\r\n", TOKENS), "hello\nworld\n");
  strictEqual(canonicalHash('{"a":1}\r\n', TOKENS), canonicalHash('{"a":1}\n', TOKENS));
});

test('canonicalize: JSON-escaped paths become tokens (validate\'s "project" field)', () => {
  // JSON.stringify doubles backslashes: a Windows path inside a JSON payload
  // appears as `C:\\repo\\...`. It must canonicalize to the same token as the
  // native form, with no doubled separator left behind.
  const line =
    '{"project":"C:\\\\repo\\\\test-fixtures\\\\fixtures","draft_file":"C:\\\\repo\\\\test-fixtures\\\\fixtures\\\\a.json"}';
  strictEqual(canonicalize(line, TOKENS), '{"project":"<FIXTURES>","draft_file":"<FIXTURES>/a.json"}');
});

test("canonicalize: POSIX token paths (CI/ubuntu) become tokens too", () => {
  const posix = [
    ["<FIXTURES>", "/home/runner/work/repo/test-fixtures/fixtures"],
    ["<TMP>", "/tmp/capcut-golden-abc123"],
    ["<ROOT>", "/home/runner/work/repo"],
  ];
  strictEqual(
    canonicalize("found /home/runner/work/repo/test-fixtures/fixtures/minimal-draft.json ok", posix),
    "found <FIXTURES>/minimal-draft.json ok",
  );
  strictEqual(canonicalize("/home/runner/work/repo/dist/index.js", posix), "<ROOT>/dist/index.js");
});

// --- canonicalHash ---------------------------------------------------------

test("canonicalHash: ignores UUID and path churn, sensitive to real content", () => {
  const a = canonicalHash('{"id":"3f8b2c1a-9e4d-4a5b-8c7d-1e2f3a4b5c6d","start":500}', TOKENS);
  const b = canonicalHash('{"id":"00000000-0000-4000-8000-000000000000","start":500}', TOKENS);
  strictEqual(a, b);
  const c = canonicalHash('{"id":"3f8b2c1a-9e4d-4a5b-8c7d-1e2f3a4b5c6d","start":501}', TOKENS);
  notStrictEqual(a, c);
});

// --- diffBaselines ---------------------------------------------------------

function baseline(captures, roundtrips = []) {
  return { version: 1, captures, roundtrips };
}

function cap(id, over = {}) {
  return { id, argv: [id], exit: 0, stdout: `${id} out\n`, stderr: "", ...over };
}

test("diffBaselines: identical baselines produce zero diffs", () => {
  const a = baseline(
    [cap("x/info"), cap("x/tracks")],
    [{ id: "x/shift-all", stableBytes: true, contentSha256: "abc" }],
  );
  deepStrictEqual(diffBaselines(a, a), []);
});

test("diffBaselines: exit-code divergence is reported", () => {
  const exp = baseline([cap("x/validate", { exit: 2 })]);
  const act = baseline([cap("x/validate", { exit: 0 })]);
  const diffs = diffBaselines(exp, act);
  strictEqual(diffs.length, 1);
  ok(diffs[0].includes("x/validate") && diffs[0].includes("exit"), diffs[0]);
});

test("diffBaselines: stdout/stderr divergence names the field and first differing line", () => {
  const exp = baseline([cap("x/info", { stdout: "line1\nBASE\nline3\n" })]);
  const act = baseline([cap("x/info", { stdout: "line1\nCURRENT\nline3\n" })]);
  const diffs = diffBaselines(exp, act);
  strictEqual(diffs.length, 1);
  ok(diffs[0].includes("stdout"), diffs[0]);
  ok(diffs[0].includes("BASE") && diffs[0].includes("CURRENT"), diffs[0]);
});

test("diffBaselines: missing and extra capture ids are reported", () => {
  const exp = baseline([cap("x/info"), cap("x/tracks")]);
  const act = baseline([cap("x/info"), cap("x/segments")]);
  const diffs = diffBaselines(exp, act);
  strictEqual(diffs.length, 2);
  ok(
    diffs.some((d) => d.includes("missing capture") && d.includes("x/tracks")),
    diffs.join("\n"),
  );
  ok(
    diffs.some((d) => d.includes("extra capture") && d.includes("x/segments")),
    diffs.join("\n"),
  );
});

test("diffBaselines: round-trip instability and hash divergence are reported", () => {
  const rt = (over = {}) => ({ id: "x/shift-all", stableBytes: true, contentSha256: "aaa", ...over });
  const exp = baseline([], [rt()]);
  const unstable = diffBaselines(exp, baseline([], [rt({ stableBytes: false })]));
  strictEqual(unstable.length, 1);
  ok(unstable[0].includes("stableBytes") || unstable[0].includes("round-trip"), unstable[0]);
  const hashDiff = diffBaselines(exp, baseline([], [rt({ contentSha256: "bbb" })]));
  strictEqual(hashDiff.length, 1);
  ok(hashDiff[0].includes("contentSha256") || hashDiff[0].includes("sha256"), hashDiff[0]);
  const missing = diffBaselines(exp, baseline([], []));
  strictEqual(missing.length, 1);
});

test("diffBaselines: round-trip canonicalStable divergence is reported (M1 UUID-generating verbs)", () => {
  const rt = (over = {}) => ({
    id: "x/add-text",
    mode: "twice-canonical",
    stableBytes: false,
    canonicalStable: true,
    contentSha256: "aaa",
    ...over,
  });
  const exp = baseline([], [rt()]);
  // canonicalStable flipping means a UUID-generating write stopped being
  // deterministic modulo UUIDs — the persistence migration must be caught.
  const diffs = diffBaselines(exp, baseline([], [rt({ canonicalStable: false })]));
  strictEqual(diffs.length, 1);
  ok(diffs[0].includes("canonicalStable"), diffs[0]);
  // Pair-mode round-trips carry no canonicalStable field — absent vs absent is equal.
  deepStrictEqual(diffBaselines(exp, baseline([], [rt()])), []);
});

test("diffBaselines: skipped captures compare equal", () => {
  const skipped = cap("x/segment", { argv: [], exit: null, stdout: "", stderr: "", skipped: "no segment in fixture" });
  deepStrictEqual(diffBaselines(baseline([skipped]), baseline([{ ...skipped }])), []);
});
