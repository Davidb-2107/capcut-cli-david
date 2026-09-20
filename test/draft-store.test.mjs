// Non-regression tests for the D2+D3 proof of concept:
//  1. LocalDraftStore preserves byte fidelity (.bak, indent) like the old
//     module-global rawOriginal path.
//  2. Two drafts loaded in parallel no longer clobber each other's raw bytes —
//     the global is dead (this is the multi-tenant safety property).
//  3. edit.ts apply* functions are the named application layer: pure mutation
//     + result payload, persistence via injected DraftStore.

import { test } from "node:test";
import { strictEqual, deepStrictEqual, ok } from "node:assert";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpDraft } from "./helpers/tmp-draft.mjs";
import { FIXTURES } from "./helpers/load-fixture.mjs";

const { LocalDraftStore, persistDraft } = await import("../dist/draft.js");
const { applySetText, applyShiftAll, cmdSetText } = await import("../dist/commands/edit.js");

const noopStore = { load() { throw new Error("not used"); }, save() { /* noop */ } };

function firstSegmentOfType(draft, type) {
  const track = draft.tracks.find((tr) => tr.type === type && tr.segments.length > 0);
  if (!track) throw new Error(`No track of type ${type} with segments in fixture`);
  return track.segments[0];
}

test("LocalDraftStore: save round-trips with original indent and writes .bak from loaded raw", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const originalBytes = readFileSync(filePath, "utf-8");

  const store = new LocalDraftStore();
  const loaded = store.load(filePath);
  applySetText(loaded.draft, firstSegmentOfType(loaded.draft, "text").id, "hello store");
  store.save(loaded);

  // .bak holds the exact original bytes
  strictEqual(readFileSync(`${filePath}.bak`, "utf-8"), originalBytes);
  // file re-serialized with the SAME indent as the original (2 spaces in the fixture)
  const after = readFileSync(filePath, "utf-8");
  ok(after.includes('\n  "'), "expected 2-space indent preserved");
  ok(after.includes("hello store"), "mutation persisted");
});

test("LocalDraftStore: two drafts loaded in parallel keep their own raw bytes (no cross-contamination)", (t) => {
  const a = tmpDraft(FIXTURES.SUBTITLES, t);
  const b = tmpDraft(FIXTURES.SUBTITLES, t);
  // Give B a recognizably different on-disk shape (4-space indent)
  writeFileSync(b.filePath, JSON.stringify(JSON.parse(readFileSync(b.filePath, "utf-8")), null, 4), "utf-8");

  const store = new LocalDraftStore();
  const loadedA = store.load(a.filePath);
  const loadedB = store.load(b.filePath); // with the old global, this would clobber A's rawOriginal

  applySetText(loadedA.draft, firstSegmentOfType(loadedA.draft, "text").id, "A edit");
  store.save(loadedA);
  store.save(loadedB); // B untouched, but saved — must keep its own 4-space indent

  ok(readFileSync(a.filePath, "utf-8").includes('\n  "'), "A keeps 2-space indent");
  ok(readFileSync(b.filePath, "utf-8").includes('\n    "'), "B keeps 4-space indent — raw bytes were NOT clobbered by A");
});

test("edit apply* layer: pure mutation + result payload, no filesystem touch", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const store = new LocalDraftStore();
  const loaded = store.load(filePath);
  const textSeg = firstSegmentOfType(loaded.draft, "text");

  const result = applySetText(loaded.draft, textSeg.id, "pure layer");
  strictEqual(result.ok, true);
  strictEqual(result.id, textSeg.id);
  strictEqual(result.new, "pure layer");
  // No persistence happened: .bak absent until someone calls store.save
  strictEqual(existsSync(`${filePath}.bak`), false);

  persistDraft(store, filePath, loaded.draft, loaded.raw);
  strictEqual(existsSync(`${filePath}.bak`), true);
});

test("cmdSetText accepts an injected DraftStore (seam for tests and future adapters)", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const store = new LocalDraftStore();
  const loaded = store.load(filePath);
  const textSeg = firstSegmentOfType(loaded.draft, "text");

  const calls = [];
  const spy = { ...noopStore, save: (l) => calls.push(l) };
  cmdSetText(loaded.draft, filePath, textSeg.id, "via spy", { human: false, quiet: true }, true, spy);
  strictEqual(calls.length, 1, "injected store received exactly one save");
  strictEqual(calls[0].filePath, filePath);
});

test("applyShiftAll: pure shift returns count and offset, filtered by track type", (t) => {
  const { filePath } = tmpDraft(FIXTURES.SUBTITLES, t);
  const loaded = new LocalDraftStore().load(filePath);
  const total = loaded.draft.tracks.reduce((n, tr) => n + tr.segments.length, 0);
  const textCount = loaded.draft.tracks
    .filter((tr) => tr.type === "text")
    .reduce((n, tr) => n + tr.segments.length, 0);

  const all = applyShiftAll(loaded.draft, "+1s");
  strictEqual(all.shifted, total);
  strictEqual(all.offset_us, 1_000_000);

  const textOnly = applyShiftAll(loaded.draft, "+1s", "text");
  strictEqual(textOnly.shifted, textCount, "track filter restricts to text segments");
  ok(textCount <= total);
});
