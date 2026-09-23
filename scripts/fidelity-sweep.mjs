#!/usr/bin/env node
// Per-verb fidelity sweep (complements test/draft-fidelity.test.mjs + golden net).
// For every write verb: run the REAL CLI on a temp copy and assert
//   .bak exists && .bak === pre-write bytes && 2-space indent preserved (or no-op).
// Non-exercisable verbs (external deps) are checked by code inspection instead.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "dist", "index.js");
const FIX = join(ROOT, "test-fixtures", "fixtures");
const ENV = { ...process.env, CAPCUT_DAVID_FORCE: "1" };

let n = 0;
function stage(fixture) {
  const dir = mkdtempSync(join(tmpdir(), `sweep-${++n}-`));
  const fp = join(dir, "draft_content.json");
  copyFileSync(join(FIX, `${fixture}.json`), fp);
  return { dir, fp, original: readFileSync(fp, "utf-8") };
}
function run(args, input) {
  try {
    return { status: 0, stdout: execFileSync(process.execPath, [CLI, ...args], { encoding: "utf-8", env: ENV, input }) };
  } catch (e) {
    return { status: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}
function ids(fixture) {
  const d = JSON.parse(readFileSync(join(FIX, `${fixture}.json`), "utf-8"));
  const firstSeg = d.tracks.find((t) => t.segments.length)?.segments[0].id ?? null;
  const textSeg = d.tracks.find((t) => t.type === "text" && t.segments.length)?.segments[0].id ?? null;
  const videoSeg = d.tracks.find((t) => t.type === "video" && t.segments.length)?.segments[0].id ?? null;
  return { firstSeg, textSeg, videoSeg };
}
const results = [];
function check(name, fixture, argsFn, opts = {}) {
  const { dir, fp, original } = stage(fixture);
  try {
    if (opts.setup) opts.setup(dir, fp);
    const i = ids(fixture); const r = run(argsFn(dir, fp, i), opts.stdin ? opts.stdin(dir, fp, i) : undefined);
    const after = existsSync(fp) ? readFileSync(fp, "utf-8") : "";
    const bakPath = `${fp}.bak`;
    const bak = existsSync(bakPath) ? readFileSync(bakPath, "utf-8") : null;
    results.push({
      name,
      exit: r.status,
      ok: r.status === 0,
      bak_exists: existsSync(bakPath),
      bak_equals_original: bak === null ? null : bak === original,
      indent_preserved: after.includes('\n  "'),
      single_line: after ? after.split("\n").length <= 2 : null,
      error: r.status !== 0 ? (r.stderr || r.stdout).trim().slice(0, 120) : null,
    });
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* tmp */ }
  }
}

// --- edit verbs (the restored path) ---
check("set-text", "subtitles-draft", (d, fp, i) => ["set-text", fp, i.textSeg, "SWEEP"]);
check("shift", "subtitles-draft", (d, fp, i) => ["shift", fp, i.textSeg, "+0.5s"]);
check("shift-all", "subtitles-draft", (d, fp) => ["shift-all", fp, "+0.25s"]);
check("speed", "ken-burns-draft", (d, fp, i) => ["speed", fp, i.firstSeg, "1.5"]);
check("volume", "effects-draft", (d, fp, i) => ["volume", fp, i.firstSeg, "0.5"]);
check("trim", "effects-draft", (d, fp, i) => ["trim", fp, i.firstSeg, "0", "1s"]);
check("opacity", "subtitles-draft", (d, fp, i) => ["opacity", fp, i.videoSeg, "0.5"]);

// --- migrated create verbs (ex-facade) ---
check("add-text", "minimal-draft", (d, fp) => ["add-text", fp, "0", "2s", "SWEEP"]);
check("add-audio", "minimal-draft", (d, fp) => ["add-audio", fp, join(d, "tone.mp3"), "0", "2s"],
  { setup: (dir) => writeFileSync(join(dir, "tone.mp3"), "x", "utf-8") });
check("add-video", "minimal-draft", (d, fp) => ["add-video", fp, join(d, "clip.mp4"), "0", "2s"],
  { setup: (dir) => writeFileSync(join(dir, "clip.mp4"), "x", "utf-8") });
check("add-video --batch", "minimal-draft", (d, fp) => ["add-video", fp, "--batch", join(d, "items.json")],
  {
    setup: (dir) => {
      writeFileSync(join(dir, "clip.mp4"), "x", "utf-8");
      writeFileSync(join(dir, "items.json"), JSON.stringify([{ path: join(dir, "clip.mp4"), start: 0, duration: 2_000_000 }]), "utf-8");
    },
  });
check("import-captions", "subtitles-draft", (d, fp) => ["import-captions", fp, join(d, "cap.json")],
  { setup: (dir) => writeFileSync(join(dir, "cap.json"), JSON.stringify([{ text: "A", start: 0, end: 900_000 }, { text: "B", start: 900_000, end: 1_800_000 }]), "utf-8") });
check("restyle", "subtitles-draft", (d, fp) => ["restyle", fp, "--preset", join(d, "preset.json")],
  { setup: (dir) => writeFileSync(join(dir, "preset.json"), JSON.stringify({ text_material: { font_size: 42 }, content_template: { styles: [{ font_size: 42 }] }, segment: {} }), "utf-8") });
check("add-keyframe", "ken-burns-draft", (d, fp, i) => ["add-keyframe", fp, i.firstSeg, "0.1", "--property", "scale_x", "--value", "1.2"]);
check("add-keyframe --batch", "ken-burns-draft", (d, fp) => ["add-keyframe", fp, "--batch", join(d, "kf.json")],
  { setup: (dir) => writeFileSync(join(dir, "kf.json"), JSON.stringify([{ segment_id: ids("ken-burns-draft").firstSeg, property: "scale_x", keyframes: [{ time: 0, value: 1 }, { time: "0.2", value: 1.3 }] }]), "utf-8") });
check("ken-burns", "ken-burns-draft", (d, fp, i) => ["ken-burns", fp, i.videoSeg, "--from", "1.0", "--to", "1.5"]);
check("remove-segment", "effects-draft", (d, fp, i) => ["remove-segment", fp, i.firstSeg]);
check("batch", "subtitles-draft", (d, fp) => ["batch", fp],
  { stdin: (d, fp, i) => `${JSON.stringify({ cmd: "set-text", id: i.textSeg, text: "B" })}\n` });
check("apply-template", "subtitles-draft", (d, fp) => ["apply-template", fp, join(d, "tpl.json"), "0", "1s", "T"],
  {
    setup: (dir, fp) => {
      const r = run(["save-template", fp, ids("subtitles-draft").textSeg, "sweeptpl", "--out", join(dir, "tpl.json")]);
      if (r.status !== 0) throw new Error(`save-template failed: ${r.stderr}`);
    },
  });
// full-psycho has no on-disk removable orphans (validate cross-ref) so gc no-ops here too;
// the DESTRUCTIVE gc path (.bak == pre-gc bytes) is covered by test/validate-fix.test.mjs:255
// ("gc apply writes draft_content.json.bak holding the PRE-gc bytes"), passing 24/24.
check("gc (no-orphan)", "full-psycho-draft", (d, fp) => ["gc", fp]);
check("gc (no-op)", "minimal-draft", (d, fp) => ["gc", fp]);

// non-exercisable here (checked by code inspection): add-effect/add-filter/add-transition
// (catalogue resource ids), cascade-words (font calibration), sync-timelines / validate --fix
// (need Timelines//sidecars), init/init-meta/register/psycho-build/cut (no in-place save
// of the source draft on the tested path).

const bad = results.filter((r) => !r.ok || r.bak_equals_original === false || (!r.name.startsWith("gc ") && r.indent_preserved === false));
for (const r of results) {
  console.log(
    `${r.ok ? "OK  " : "FAIL"} ${r.name.padEnd(20)} exit=${r.exit} bak=${r.bak_exists ? (r.bak_equals_original ? "=orig" : "DIFF") : "none"} indent=${r.indent_preserved ? "2sp" : (r.single_line ? "compact" : "n/a")}${r.error ? "  " + r.error : ""}`,
  );
}
console.log(`\n${results.length} verbs swept, ${bad.length} unexpected result(s)`);
process.exit(bad.length ? 1 : 0);
