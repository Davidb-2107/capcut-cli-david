import { mkdirSync, statSync, mkdtempSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

test("lock timeout is configurable and fails closed for a held corpus lock", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "calibration-"));
  const draftPath = join(dataDir, "workspaces", "local-default", "corpus", "draft.json");
  const lockPath = `${draftPath}.lock`;
  mkdirSync(dirname(lockPath), { recursive: true });
  writeFileSync(lockPath, JSON.stringify({ pid: 99999, acquiredAt: "2026-09-02T00:00:00.000Z" }));

  const store = createLocalStore(dataDir, { lockTimeoutMs: 20 });
  await rejects(
    store.corpus.saveDraft("local-default", { workspaceId: "local-default", revision: 0, items: [] }, 0),
    /lock timeout/,
  );
});

test("run create and save are protected by the same on-disk lock", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "calibration-"));
  const runPath = join(dataDir, "workspaces", "local-default", "runs", "run-1.json");
  const lockPath = `${runPath}.lock`;
  mkdirSync(dirname(lockPath), { recursive: true });
  writeFileSync(lockPath, JSON.stringify({ pid: 99999, acquiredAt: "2026-09-02T00:00:00.000Z" }));

  const store = createLocalStore(dataDir, { lockTimeoutMs: 20 });
  await rejects(store.runs.create(runFixture), /lock timeout/);
  rmSync(lockPath, { force: true });
  await store.runs.create(runFixture);
  writeFileSync(lockPath, JSON.stringify({ pid: 99999, acquiredAt: "2026-09-02T00:00:00.000Z" }));
  await rejects(store.runs.save({ ...runFixture, updatedAt: "2026-09-02T00:01:00.000Z" }), /lock timeout/);
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

test("artifact symlink checks stop at the artifact root and still reject links inside it", async () => {
  const linkType = process.platform === "win32" ? "junction" : "dir";
  const realParent = mkdtempSync(join(tmpdir(), "calibration-real-"));
  const linkParent = mkdtempSync(join(tmpdir(), "calibration-parent-"));
  const parentLink = join(linkParent, "data-link");
  symlinkSync(realParent, parentLink, linkType);

  const dataDir = join(parentLink, "calibration");
  const store = createLocalStore(dataDir);
  const ref = await store.artifacts.put("run-1", "audio.mp3", new Uint8Array([7]));
  deepStrictEqual([...await store.artifacts.get(ref)], [7]);

  const internalLink = join(dataDir, "workspaces", "local-default", "artifacts", "run-2");
  mkdirSync(dirname(internalLink), { recursive: true });
  symlinkSync(realParent, internalLink, linkType);
  await rejects(store.artifacts.put("run-2", "audio.mp3", new Uint8Array([8])), /symbolic links/);
});
