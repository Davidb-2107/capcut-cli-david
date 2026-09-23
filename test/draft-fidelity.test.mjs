// Ticket 02 (DraftStore migration) — write-fidelity regression net.
//
// The deleted saveDraft/loadDraft facade had one load-bearing behaviour:
// .bak keeps the ORIGINAL pre-write bytes and re-serialization preserves the
// original indent (detectIndent on the loaded raw). commit 6ffc030 regressed
// that for the edit verbs (persistDraft without raw → empty .bak + indent 0).
// persistDraft now recovers the on-disk bytes when raw is omitted, so the
// CLI-level write path keeps facade fidelity for EVERY write verb.
//
// These tests run the built CLI (behavioral seam, spawn-cli helper) and lock:
//   1. .bak exists and equals the original fixture bytes;
//   2. the persisted draft keeps the fixture's 2-space indent;
//   3. an omitted raw is recovered from disk (facade-equivalent);
//   4. an EXPLICIT "" raw keeps the in-memory contract (empty .bak).

import { test } from "node:test";
import { strictEqual, ok } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync, rmSync, copyFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { runCli } from "./helpers/spawn-cli.mjs";
import { FIXTURES, fixturePath } from "./helpers/load-fixture.mjs";

const { LocalDraftStore, persistDraft } = await import("../dist/draft.js");

function stagedCopy(fixtureKey, t) {
  const dir = mkdtempSync(join(tmpdir(), "fidelity-"));
  const fp = join(dir, "draft_content.json");
  copyFileSync(fixturePath(fixtureKey), fp);
  t.after(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  });
  return { dir, fp, original: readFileSync(fp, "utf-8") };
}

function firstSegmentId(fp, type) {
  const draft = JSON.parse(readFileSync(fp, "utf-8"));
  for (const tr of draft.tracks) {
    if ((!type || tr.type === type) && tr.segments.length) return tr.segments[0].id;
  }
  throw new Error(`no segment of type ${type ?? "any"} in ${fp}`);
}

test("fidelity: set-text (edit verb) keeps original .bak bytes and 2-space indent", (t) => {
  const { fp, original } = stagedCopy(FIXTURES.SUBTITLES, t);
  const segId = firstSegmentId(fp, "text");
  const r = runCli(["set-text", fp, segId, "FIDELITY"]);
  strictEqual(r.status, 0, r.stderr);

  const bak = `${fp}.bak`;
  ok(existsSync(bak), ".bak must exist after a write");
  strictEqual(readFileSync(bak, "utf-8"), original, ".bak must hold the pre-write bytes");
  const after = readFileSync(fp, "utf-8");
  ok(after.includes('\n  "'), "original 2-space indent must be preserved (no compact rewrite)");
  ok(after !== original, "mutation must be persisted");
});

test("fidelity: shift (edit verb) keeps original .bak bytes and indent", (t) => {
  const { fp, original } = stagedCopy(FIXTURES.KEN_BURNS, t);
  const segId = firstSegmentId(fp);
  const r = runCli(["shift", fp, segId, "+0.25s"]);
  strictEqual(r.status, 0, r.stderr);
  strictEqual(readFileSync(`${fp}.bak`, "utf-8"), original);
  ok(readFileSync(fp, "utf-8").includes('\n  "'));
});

test("fidelity: add-text (migrated create verb) keeps original .bak bytes and indent", (t) => {
  const { fp, original } = stagedCopy(FIXTURES.MINIMAL, t);
  const r = runCli(["add-text", fp, "0", "2s", "FIDELITY"]);
  strictEqual(r.status, 0, r.stderr);
  strictEqual(readFileSync(`${fp}.bak`, "utf-8"), original);
  ok(readFileSync(fp, "utf-8").includes('\n  "'));
});

test("fidelity: remove-segment (migrated verb) keeps original .bak bytes and indent", (t) => {
  const { fp, original } = stagedCopy(FIXTURES.EFFECTS, t);
  const segId = firstSegmentId(fp);
  const r = runCli(["remove-segment", fp, segId]);
  strictEqual(r.status, 0, r.stderr);
  strictEqual(readFileSync(`${fp}.bak`, "utf-8"), original);
  ok(readFileSync(fp, "utf-8").includes('\n  "'));
});

test("fidelity: gc no-op writes nothing (no .bak, no rewrite)", (t) => {
  const { fp, original } = stagedCopy(FIXTURES.MINIMAL, t);
  const before = readFileSync(fp, "utf-8");
  const r = runCli(["gc", fp]);
  strictEqual(r.status, 0, r.stderr);
  ok(!existsSync(`${fp}.bak`), "no-op gc must not create a .bak");
  strictEqual(readFileSync(fp, "utf-8"), before, "no-op gc must not rewrite the draft");
});

test("fidelity: a UTF-8 BOM is tolerated on load and never leaks into .bak", (t) => {
  const { fp } = stagedCopy(FIXTURES.SUBTITLES, t);
  // Simulate a PowerShell Set-Content draft: BOM + the original bytes.
  const withBom = `\uFEFF${readFileSync(fp, "utf-8")}`;
  writeFileSync(fp, withBom, "utf-8");

  const store = new LocalDraftStore();
  const { draft } = store.load(fp); // must parse (BOM stripped)
  const segId = draft.tracks.find((tr) => tr.type === "text").segments[0].id;
  const r = runCli(["set-text", fp, segId, "BOM-PROBE"]);
  strictEqual(r.status, 0, r.stderr);

  const bak = readFileSync(`${fp}.bak`, "utf-8");
  ok(bak.length > 0, ".bak must not be empty");
  strictEqual(bak.charCodeAt(0), "{".charCodeAt(0), ".bak must hold the BOM-stripped original bytes");
  ok(!bak.startsWith("\uFEFF"), "the facade never wrote a BOM into .bak - neither may we");
  ok(bak.includes("LOREM LOREM"), ".bak must be the pre-write content");
});

test("persistDraft without raw recovers on-disk bytes (facade-equivalent)", (t) => {
  const { fp, original } = stagedCopy(FIXTURES.SUBTITLES, t);
  const store = new LocalDraftStore();
  const { draft } = store.load(fp);
  const seg = draft.tracks.find((tr) => tr.type === "text").segments[0];
  const content = JSON.parse(seg.materials ?? "null");
  // mutate something trivially through the draft object
  draft.name = "FIDELITY-PROBE";
  persistDraft(store, fp, draft);
  strictEqual(readFileSync(`${fp}.bak`, "utf-8"), original, "omitted raw must recover the pre-write bytes");
  ok(readFileSync(fp, "utf-8").includes('\n  "'), "omitted raw must preserve the original indent");
});

test("persistDraft with EXPLICIT empty raw keeps the in-memory contract (empty .bak, no indent)", (t) => {
  const { fp } = stagedCopy(FIXTURES.MINIMAL, t);
  const store = new LocalDraftStore();
  const { draft } = store.load(fp);
  draft.name = "IN-MEMORY-PROBE";
  persistDraft(store, fp, draft, "");
  ok(existsSync(`${fp}.bak`), ".bak is still written because the file exists");
  strictEqual(readFileSync(`${fp}.bak`, "utf-8").length, 0, "explicit empty raw = empty .bak (in-memory draft)");
  ok(!readFileSync(fp, "utf-8").includes('\n  "'), "explicit empty raw = indent 0");
});
