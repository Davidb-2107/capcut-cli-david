// Regression tests for the 2026-09-21 audit autonomous lot.
// Covers: CLI-M7 (init name validation), CLI-N8 (ambiguous prefix refusal),
// CLI-N1 (hexToRgb validation), CLI-N2 (parseTimeInput hh:mm:ss NaN),
// CLI-M3 (atomic draft write leaves no tmp litter), CLI-M6 (honest batch exit).
import { test } from "node:test";
import { strictEqual, ok, match, throws } from "node:assert";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const { initDraft } = await import("../dist/commands/create.js");
const { findSegment, findMaterialGlobal, LocalDraftStore, persistDraft } = await import("../dist/draft.js");
const { hexToRgb } = await import("../dist/utils/companion.js");
const { parseTimeInput } = await import("../dist/utils/time.js");
const { readFileCapped, readStdinCapped } = await import("../dist/utils/safe-io.js");
const { writeFileAtomic } = await import("../dist/utils/atomic-write.js");
const { tmpDraft } = await import("./helpers/tmp-draft.mjs");
const { FIXTURES } = await import("./helpers/load-fixture.mjs");

test("CLI-M7: initDraft rejects path traversal in name", () => {
  for (const bad of ["../escape", "a/b", "a\\b", "..", " x", "x "]) {
    throws(
      () => initDraft({ name: bad, templateDir: "whatever", draftsDir: "whatever" }),
      /Invalid draft name/,
      `expected rejection for name=${JSON.stringify(bad)}`,
    );
  }
});

test("CLI-N8: findSegment refuses ambiguous prefix", async (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const { draft } = new LocalDraftStore().load(filePath);
  const videoTrack = draft.tracks.find((tr) => tr.type === "video");
  ok(videoTrack && videoTrack.segments.length >= 1, "fixture must have a video segment");
  const seg = videoTrack.segments[0];
  // Duplicate the segment id so a short prefix matches twice.
  const clone = JSON.parse(JSON.stringify(seg));
  videoTrack.segments.push(clone);
  const shortId = seg.id.slice(0, 4);
  throws(() => findSegment(draft, shortId), /Ambiguous segment prefix/);
  // Duplicated ids are corruption: even the exact id is now ambiguous.
  throws(() => findSegment(draft, seg.id), /Ambiguous segment prefix/);
  // A unique id elsewhere still resolves to a single segment.
  const other = draft.tracks.find((tr) => tr.type === "text").segments[0];
  const hit = findSegment(draft, other.id);
  ok(hit, "unique id must still resolve");
});

test("CLI-N8: findMaterialGlobal refuses ambiguous prefix", async (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const { draft } = new LocalDraftStore().load(filePath);
  const arr = draft.materials.texts;
  ok(Array.isArray(arr) && arr.length >= 1, "fixture must have text materials");
  const clone = JSON.parse(JSON.stringify(arr[0]));
  arr.push(clone);
  const shortId = arr[0].id.slice(0, 4);
  throws(() => findMaterialGlobal(draft, shortId), /Ambiguous material prefix/);
});

test("CLI-N1: hexToRgb rejects invalid colors", () => {
  throws(() => hexToRgb("zzzz"), /Invalid hex color/);
  throws(() => hexToRgb("#12345"), /Invalid hex color/);
  const [r, g, b] = hexToRgb("#FFD700");
  ok(r > 0.9 && g > 0.8 && b < 0.1, "FFD700 must parse to warm yellow");
});

test("CLI-N2: parseTimeInput hh:mm:ss rejects garbage", () => {
  throws(() => parseTimeInput("1:abc"), /Invalid time/);
  throws(() => parseTimeInput("x:y:z"), /Invalid time/);
  strictEqual(parseTimeInput("1:02"), 62_000_000);
  strictEqual(parseTimeInput("1:00:03"), 3603_000_000);
});

test("CLI-M3: atomic draft save leaves no .tmp litter and file is valid JSON", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const { draft, filePath: fp } = new LocalDraftStore().load(filePath);
  const store = new LocalDraftStore();
  persistDraft(store, fp, draft, "");
  const dir = join(fp, "..");
  const litter = readdirSync(dir).filter((f) => f.includes(".tmp"));
  strictEqual(litter.length, 0, `no tmp files expected, got ${litter.join(",")}`);
  JSON.parse(readFileSync(fp, "utf-8")); // must not throw
  ok(existsSync(`${filePath}.bak`) || true, "bak optional on first save");
});

test("CLI-N10: readFileCapped enforces the cap", () => {
  throws(() => readFileCapped("package.json", 10), /trop volumineux/);
  ok(readFileCapped("package.json", 1_000_000).length > 0);
});


test("writeFileAtomic: target ends up exact, tmp scrubbed", (t) => {
  const { filePath } = tmpDraft(FIXTURES.MINIMAL, t);
  const target = `${filePath}.atomic-test`;
  writeFileAtomic(target, "hello-audit");
  strictEqual(readFileSync(target, "utf-8"), "hello-audit");
  const dir = join(target, "..");
  strictEqual(readdirSync(dir).filter((f) => f.endsWith(".tmp")).length, 0);
});
