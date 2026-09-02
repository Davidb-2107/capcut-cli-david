import { mkdirSync, mkdtempSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deepStrictEqual, rejects, strictEqual, match } from "node:assert";
import { test } from "node:test";

import { createLocalStore } from "../dist/calibration/local-store.js";

const runFixture = {
  id: "run-1",
  workspaceId: "local-default",
  status: "draft",
  idempotencyKey: "run-1",
  request: {
    contractDigest: "contract",
    coreDigest: "core",
    corpusVersionId: "version",
    corpusDigest: "corpus",
    voiceRef: "voice-1",
    params: { mode: "precision" },
    postproc: "cut",
  },
  requestDigest: "digest",
  approval: null,
  reportId: null,
  createdAt: "2026-09-02T00:00:00.000Z",
  updatedAt: "2026-09-02T00:00:00.000Z",
};

function makeStore() {
  return createLocalStore(mkdtempSync(join(tmpdir(), "calibration-")));
}

test("draft save uses revision and rejects stale writers", async () => {
  const store = makeStore();
  const first = await store.corpus.getDraft("local-default");
  const saved = await store.corpus.saveDraft(
    "local-default",
    { ...first, items: [{ id: "t1", order: 0, text: "Bonjour." }] },
    first.revision,
  );
  strictEqual(saved.revision, first.revision + 1);
  await rejects(
    store.corpus.saveDraft("local-default", { ...saved, items: [] }, first.revision),
    /revision conflict/,
  );
});

test("separate store instances serialize draft writers", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "calibration-"));
  const firstStore = createLocalStore(dataDir);
  const secondStore = createLocalStore(dataDir);
  const first = await firstStore.corpus.getDraft("local-default");
  const results = await Promise.allSettled([
    firstStore.corpus.saveDraft(
      "local-default",
      { ...first, items: [{ id: "t1", order: 0, text: "Un." }] },
      first.revision,
    ),
    secondStore.corpus.saveDraft(
      "local-default",
      { ...first, items: [{ id: "t2", order: 0, text: "Deux." }] },
      first.revision,
    ),
  ]);
  strictEqual(results.filter((result) => result.status === "fulfilled").length, 1);
  strictEqual(results.filter((result) => result.status === "rejected")[0].reason.message, "revision conflict");
});

test("reclaims a stale lock only when its owner process is dead", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "calibration-"));
  const lockFile = join(
    dataDir,
    "workspaces",
    "local-default",
    "corpus",
    "draft.json.lock",
  );
  mkdirSync(join(dataDir, "workspaces", "local-default", "corpus"), { recursive: true });
  writeFileSync(lockFile, JSON.stringify({ pid: 999999999 }));
  const stale = new Date(Date.now() - 60_000);
  utimesSync(lockFile, stale, stale);

  const store = createLocalStore(dataDir);
  const first = await store.corpus.getDraft("local-default");
  const saved = await store.corpus.saveDraft(
    "local-default",
    { ...first, items: [{ id: "t1", order: 0, text: "Après crash." }] },
    first.revision,
  );
  strictEqual(saved.revision, 1);
});

test("publishing creates an immutable active version", async () => {
  const store = makeStore();
  const first = await store.corpus.getDraft("local-default");
  const saved = await store.corpus.saveDraft(
    "local-default",
    { ...first, items: [{ id: "t1", order: 0, text: "Bonjour." }] },
    first.revision,
  );
  const version = await store.corpus.publishDraft("local-default", saved.revision);
  strictEqual(version.status, "active");
  const edited = await store.corpus.saveDraft(
    "local-default",
    { ...saved, items: [{ id: "t1", order: 0, text: "Au revoir." }] },
    saved.revision,
  );
  strictEqual((await store.corpus.getActiveVersion("local-default")).items[0].text, "Bonjour.");
  strictEqual(edited.revision, saved.revision + 1);
  strictEqual((await store.corpus.listVersions("local-default"))[0].status, "active");
});

test("publishing a second snapshot supersedes only the derived status", async () => {
  const store = makeStore();
  const first = await store.corpus.getDraft("local-default");
  const firstSaved = await store.corpus.saveDraft(
    "local-default",
    { ...first, items: [{ id: "t1", order: 0, text: "Un." }] },
    first.revision,
  );
  const firstVersion = await store.corpus.publishDraft("local-default", firstSaved.revision);
  const secondSaved = await store.corpus.saveDraft(
    "local-default",
    { ...firstSaved, items: [{ id: "t1", order: 0, text: "Deux." }] },
    firstSaved.revision,
  );
  await store.corpus.publishDraft("local-default", secondSaved.revision);
  const versions = await store.corpus.listVersions("local-default");
  strictEqual(versions.filter((version) => version.status === "active").length, 1);
  strictEqual(versions.find((version) => version.id === firstVersion.id).status, "superseded");
});

test("writes survive reload and use the expected layout", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "calibration-"));
  const store = createLocalStore(dataDir);
  await store.runs.save(runFixture);
  strictEqual(
    statSync(join(dataDir, "workspaces", "local-default", "runs", "run-1.json")).isFile(),
    true,
  );
  const reloaded = createLocalStore(dataDir);
  deepStrictEqual(await reloaded.runs.get(runFixture.id), runFixture);
});

test("artifacts round-trip and reject traversal", async () => {
  const store = makeStore();
  const ref = await store.artifacts.put("run-1", "audio/sample.mp3", new Uint8Array([1, 2, 3]));
  match(ref, /^workspaces\/local-default\/artifacts\/run-1\/audio\/sample\.mp3$/);
  deepStrictEqual([...await store.artifacts.get(ref)], [1, 2, 3]);
  await rejects(store.artifacts.put("run-1", "../secret", new Uint8Array([1])), /invalid artifact path/);
  await rejects(store.artifacts.get("workspaces/local-default/runs/run-1.json"), /invalid artifact reference/);
});
