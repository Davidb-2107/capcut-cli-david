#!/usr/bin/env node
// Golden-output characterisation net (ARCH PR 0 — ticket 01).
//
// Captures a canonicalised signature of the CLI's OBSERVABLE behaviour:
//   - read-only commands: stdout/stderr/exit code (+ the draft file must stay
//     byte-identical, CRLF-normalised — proves "read-only" mechanically);
//   - write commands (round-trip on a temp copy): stdout/stderr/exit code +
//     the on-disk artifact: canonical draft signature, .bak presence and
//     equality with the pre-run bytes, original-indent fidelity.
//
//   node scripts/golden-output.mjs --write   # (re)generate the committed baseline
//   node scripts/golden-output.mjs --check   # compare the built CLI to the baseline
//   node scripts/golden-output.mjs --dump <case-id>   # print the live canonical output
//
// Canonicalisation strips generated UUIDs (ORDERED, uppercase-safe), machine
// tmp paths, CRLF and BOM — precedent: canon() in test/batch-media.test.mjs.
//
// A baseline divergence means: either the PR changed observable behaviour
// (regression → fix it) or it changed it ON PURPOSE (justify it in the PR and
// regenerate the baseline in the SAME diff). The baseline lives with the
// intention; an unedited silent drift must stay red.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "dist", "index.js");
const FIXTURES_DIR = join(ROOT, "test-fixtures", "fixtures");
const BASELINE = join(ROOT, "test-fixtures", "golden", "baseline.json");

const ENV = { ...process.env, CAPCUT_DAVID_FORCE: "1", NO_COLOR: "1" };

// ---------------------------------------------------------------- cases ----

// Read-only sweep: every entry asserts code/out/err AND that the draft file
// bytes (CRLF-normalised) are untouched by the command.
const READ_ONLY_FIXTURES = [
  "minimal-draft",
  "subtitles-draft",
  "ken-burns-draft",
  "effects-draft",
  "full-psycho-draft",
  "animations-draft",
  "stickers-draft",
  "transitions-draft",
  "masks-filters-draft",
];
const READ_ONLY_VERBS = ["info", "tracks", "materials", "segments", "texts", "validate", "export-srt"];

function fixtureDraft(key) {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, `${key}.json`), "utf-8"));
}

function firstSeg(key, type) {
  const draft = fixtureDraft(key);
  for (const t of draft.tracks) {
    if ((!type || t.type === type) && t.segments.length) return t.segments[0].id;
  }
  return null;
}

function firstMaterial(key) {
  const draft = fixtureDraft(key);
  for (const arr of Object.values(draft.materials)) {
    if (Array.isArray(arr) && arr.length && arr[0] && typeof arr[0].id === "string") return arr[0].id;
  }
  return null;
}

const cases = [];

// non-verbal: --help (writeSync; the historical macOS pipe-truncation bug)
cases.push({ id: "help", kind: "read", args: ["--help"], fixture: null });

for (const key of READ_ONLY_FIXTURES) {
  const fp = join(FIXTURES_DIR, `${key}.json`);
  for (const verb of READ_ONLY_VERBS) {
    if (verb === "export-srt" && !firstSeg(key, "text")) continue;
    cases.push({ id: `${key}/${verb}`, kind: "read", args: [verb, fp], fixture: fp });
  }
  const segId = firstSeg(key);
  const matId = firstMaterial(key);
  if (segId) cases.push({ id: `${key}/segment`, kind: "read", args: ["segment", fp, segId], fixture: fp });
  if (matId) cases.push({ id: `${key}/material`, kind: "read", args: ["material", fp, matId], fixture: fp });
}

// discovery / vault (read-only, sandboxed to the fixtures dir)
cases.push({
  id: "query",
  kind: "read",
  args: ["query", "Fade", "--drafts", FIXTURES_DIR],
  fixture: null,
});
// ui --print-path intentionally excluded: it prints the machine-local
// install path of dist/ui/index.html, which differs across checkouts and
// would produce a spurious divergence. The ui page itself is covered by
// test/ui-html.test.mjs + test/ui-verb.test.mjs.

// Write round-trips (temp copies). `prepare(dir)` may stage side files; the
// case then runs ONE mutating command. Artifacts frozen: stdout/stderr/exit +
// canonical draft signature + .bak fidelity + indent fidelity.
const captionsJson = JSON.stringify(
  fixtureDraft("subtitles-draft").tracks.some((t) => t.type === "text")
    ? [
        { text: "GOLDEN ONE", start: 0, end: 900_000 },
        { text: "GOLDEN TWO", start: 900_000, end: 1_800_000 },
      ]
    : [{ text: "GOLDEN", start: 0, end: 900_000 }],
);

const WRITE_CASES = [
  {
    id: "subtitles/set-text",
    fixture: "subtitles-draft",
    args: (dir, fp, ids) => ["set-text", fp, ids.textSeg, "GOLDEN TEXT"],
  },
  {
    id: "subtitles/shift",
    fixture: "subtitles-draft",
    args: (dir, fp, ids) => ["shift", fp, ids.textSeg, "+0.5s"],
  },
  {
    id: "subtitles/import-captions",
    fixture: "subtitles-draft",
    prepare: (dir) => {
      writeFileSync(join(dir, "captions.json"), captionsJson, "utf-8");
      return null;
    },
    args: (dir, fp) => ["import-captions", fp, join(dir, "captions.json")],
  },
  {
    id: "minimal/add-text",
    fixture: "minimal-draft",
    args: (dir, fp) => ["add-text", fp, "0", "2s", "GOLDEN"],
  },
  {
    id: "minimal/add-audio",
    fixture: "minimal-draft",
    prepare: (dir) => {
      writeFileSync(join(dir, "tone.mp3"), "fake-bytes", "utf-8");
      return null;
    },
    args: (dir, fp) => ["add-audio", fp, join(dir, "tone.mp3"), "0", "2s"],
  },
  {
    id: "minimal/batch",
    fixture: "minimal-draft",
    args: (dir, fp, ids) => ["batch", fp],
    stdin: (dir, fp, ids) => `${JSON.stringify({ cmd: "add-text", start: "0", duration: "1s", text: "BATCH" })}\n`,
  },
  {
    id: "minimal/gc-noop",
    fixture: "minimal-draft",
    args: (dir, fp) => ["gc", fp],
  },
  {
    id: "ken-burns/add-keyframe",
    fixture: "ken-burns-draft",
    args: (dir, fp, ids) => ["add-keyframe", fp, ids.firstSeg, "0.1", "--property", "scale_x", "--value", "1.2"],
  },
  {
    id: "ken-burns/ken-burns",
    fixture: "ken-burns-draft",
    args: (dir, fp, ids) => ["ken-burns", fp, ids.firstSeg, "--from", "1.0", "--to", "1.5"],
  },
  {
    id: "ken-burns/speed",
    fixture: "ken-burns-draft",
    args: (dir, fp, ids) => ["speed", fp, ids.firstSeg, "1.5"],
  },
  {
    id: "effects/remove-segment",
    fixture: "effects-draft",
    args: (dir, fp, ids) => ["remove-segment", fp, ids.firstSeg],
  },
  {
    id: "subtitles/restyle",
    fixture: "subtitles-draft",
    prepare: (dir) => {
      writeFileSync(
        join(dir, "preset.json"),
        JSON.stringify({
          text_material: { font_size: 42 },
          content_template: { styles: [{ font_size: 42 }] },
          segment: {},
        }),
        "utf-8",
      );
      return null;
    },
    args: (dir, fp) => ["restyle", fp, "--preset", join(dir, "preset.json")],
  },
  {
    id: "subtitles/apply-template",
    fixture: "subtitles-draft",
    prepare: (dir, fp, ids) => {
      // stage a template via the read-only-ish save-template verb, then use it
      const r = run(["save-template", fp, ids.textSeg, "goldentpl", "--out", join(dir, "tpl.json")]);
      if (r.code !== 0) throw new Error(`save-template failed: ${r.stderr}`);
      return null;
    },
    args: (dir, fp) => ["apply-template", fp, join(dir, "tpl.json"), "0", "1s", "TPL"],
  },
];
for (const wc of WRITE_CASES) cases.push({ kind: "write", ...wc });

// ------------------------------------------------------------- plumbing ----

const UUID = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

function sha(s) {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

/** Ordered-UUID canonicaliser: UUID#1, UUID#2 ... stable for identical runs. */
function makeCanon() {
  const map = new Map();
  return (s) =>
    s.replace(UUID, (m) => {
      const up = m.toUpperCase();
      if (!map.has(up)) map.set(up, `<UUID#${map.size + 1}>`);
      return map.get(up);
    });
}

function normalizeText(s, dir) {
  let out = s.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (dir) {
    // Machine-portable temp collapsing: the mkdtemp leaf AND its absolute
    // prefix (user- and OS-specific) must both disappear, otherwise a baseline
    // captured on Windows embeds C:\Users\...\Temp\<TMP> and diverges on
    // ubuntu-latest (/tmp/<TMP>). Collapse in both separators orders.
    out = out.replace(/golden-[a-z]+-[A-Za-z0-9_]+/g, "<TMP>"); // leaf first
    // Collapse the temp prefix in EVERY encoding it can appear in: raw
    // backslashes (Windows stdout), JSON-escaped backslashes (strings that go
    // through JSON), and forward slashes. Order matters: longest first.
    const forms = [];
    const tmpRoot = tmpdir();
    for (const root of [dir, tmpRoot]) {
      if (!root) continue;
      const fwd = root.replace(/\\/g, "/");
      const esc = root.replace(/\\/g, "\\\\");
      forms.push(esc, fwd, root);
    }
    for (const f of forms) {
      out = out.split(f + "\\").join("<TMP>/");
      out = out.split(f + "/").join("<TMP>/");
      out = out.split(f).join("<TMP>");
    }
    out = out.split("\\\\").join("\\");
  }
  return out;
}

function run(args, opts = {}) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      encoding: "utf-8",
      env: ENV,
      input: opts.input ?? undefined,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

function sigText(text) {
  return { sha: sha(text), len: text.length, text: text.length <= 4000 ? text : undefined };
}

function idsFor(fixtureKey, fp) {
  const draft = JSON.parse(readFileSync(fp, "utf-8"));
  const firstSeg = (() => {
    for (const t of draft.tracks) if (t.segments.length) return t.segments[0].id;
    return null;
  })();
  const textSeg = (() => {
    for (const t of draft.tracks) if (t.type === "text" && t.segments.length) return t.segments[0].id;
    return null;
  })();
  return { firstSeg, textSeg };
}

function capture() {
  const manifest = { schema: "capcut-david/golden@1", generatedBy: "scripts/golden-output.mjs", entries: {} };

  for (const c of cases) {
    const entry = {};
    if (c.kind === "read") {
      const dir = mkdtempSync(join(tmpdir(), "golden-ro-"));
      const canon = makeCanon();
      try {
        let args = c.args;
        let fp = null;
        if (c.fixture) {
          fp = join(dir, "draft_content.json");
          cpSync(c.fixture, fp);
          args = c.args.map((a) => (a === c.fixture ? fp : a));
        }
        const r = run(args);
        const out = normalizeText(r.stdout, dir);
        const err = normalizeText(r.stderr, dir);
        entry.code = r.code;
        entry.out = sigText(canon(out));
        entry.err = sigText(canon(err));
        if (fp) {
          const before = readFileSync(c.fixture, "utf-8").replace(/\r\n/g, "\n");
          const after = readFileSync(fp, "utf-8").replace(/\r\n/g, "\n");
          entry.readonly_untouched = before === after;
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    } else {
      const dir = mkdtempSync(join(tmpdir(), `golden-w-`));
      const canon = makeCanon();
      try {
        const fp = join(dir, "draft_content.json");
        cpSync(join(FIXTURES_DIR, `${c.fixture}.json`), fp);
        const originalBytes = readFileSync(fp, "utf-8");
        const ids = idsFor(c.fixture, fp);
        if (c.prepare) c.prepare(dir, fp, ids);
        const args = c.args(dir, fp, ids);
        const r = run(args, { input: c.stdin ? c.stdin(dir, fp, ids) : undefined });
        const out = normalizeText(r.stdout, dir);
        const err = normalizeText(r.stderr, dir);
        entry.code = r.code;
        entry.out = sigText(canon(out));
        entry.err = sigText(canon(err));
        const afterRaw = existsSync(fp) ? readFileSync(fp, "utf-8") : "";
        const bakPath = `${fp}.bak`;
        entry.artifact = {
          draft_canon_sha: afterRaw ? sha(canon(normalizeText(JSON.stringify(JSON.parse(afterRaw)), dir))) : null,
          bak_exists: existsSync(bakPath),
          bak_equals_original: existsSync(bakPath) ? readFileSync(bakPath, "utf-8") === originalBytes : null,
          indent_preserved: afterRaw ? afterRaw.includes('\n  "') : null,
          single_line: afterRaw ? afterRaw.split("\n").length <= 2 : null,
        };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    manifest.entries[c.id] = entry;
  }
  return manifest;
}

function main() {
  const argv = process.argv.slice(2);
  if (!existsSync(CLI)) {
    console.error(`golden: missing ${CLI} — run \`npm run build\` first.`);
    process.exit(2);
  }
  if (argv[0] === "--dump") {
    const want = argv[1];
    const hit = cases.find((c) => c.id === want);
    if (!hit) {
      console.error(`golden: unknown case ${want}`);
      process.exit(2);
    }
    const manifest = capture();
    console.log(JSON.stringify(manifest.entries[want], null, 2));
    return;
  }
  const mode = argv.includes("--check") ? "check" : "write";
  const manifest = capture();
  mkdirSync(dirname(BASELINE), { recursive: true });
  if (mode === "write") {
    writeFileSync(BASELINE, `${JSON.stringify(manifest, null, 1)}\n`, "utf-8");
    console.log(`golden: baseline written → ${BASELINE} (${Object.keys(manifest.entries).length} cases)`);
    return;
  }
  const baseline = JSON.parse(readFileSync(BASELINE, "utf-8"));
  const keys = new Set([...Object.keys(baseline.entries), ...Object.keys(manifest.entries)]);
  const diffs = [];
  for (const k of [...keys].sort()) {
    const a = JSON.stringify(baseline.entries[k] ?? null);
    const b = JSON.stringify(manifest.entries[k] ?? null);
    if (a !== b) diffs.push(k);
  }
  if (diffs.length === 0) {
    console.log(`golden: OK — ${keys.size} cases identical to baseline.`);
    return;
  }
  console.error(`golden: ${diffs.length} divergence(s) out of ${keys.size}:`);
  for (const k of diffs) {
    const a = baseline.entries[k] ?? null;
    const b = manifest.entries[k] ?? null;
    console.error(`--- ${k}`);
    console.error(`    baseline: ${JSON.stringify(a)}`);
    console.error(`    current : ${JSON.stringify(b)}`);
  }
  process.exit(1);
}

main();
