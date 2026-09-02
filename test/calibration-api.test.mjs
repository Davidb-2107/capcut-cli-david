import { test } from "node:test";
import { deepStrictEqual, rejects, strictEqual, match } from "node:assert";

import { createCalibrationApplication } from "../dist/calibration/application.js";
import { startCalibrationUi } from "../dist/calibration/http-server.js";

const input = {
  workspaceId: "local-default",
  voiceRef: "voice-1",
  params: {
    model_id: "eleven_v3",
    voice_settings: { stability: 0.5, similarity_boost: 0.85, style: 0, use_speaker_boost: true },
    text_source: { kind: "inline", text: "caller supplied text must not replace the active corpus" },
    mode: "precision",
    language: "fr",
    runs: 3,
    dry_run: false,
  },
  postproc: "cut",
};

export function memoryRepositories() {
  let activeVersion = null;
  const draft = { workspaceId: "local-default", revision: 0, items: [] };
  const versions = [];
  const runs = new Map();
  const profiles = [];
  const artifacts = new Map();
  let versionNumber = 1;

  return {
    corpus: {
      async getDraft() { return structuredClone(draft); },
      async saveDraft(workspaceId, next, expectedRevision) {
        if (expectedRevision !== draft.revision) throw new Error("revision conflict");
        draft.workspaceId = workspaceId;
        draft.revision += 1;
        draft.items = structuredClone(next.items);
        return structuredClone(draft);
      },
      async publishDraft(workspaceId, expectedRevision) {
        if (expectedRevision !== draft.revision) throw new Error("revision conflict");
        const version = {
          id: `version-${versionNumber++}`,
          workspaceId,
          revision: draft.revision,
          items: structuredClone(draft.items),
          contentDigest: `corpus-${draft.revision}`,
          status: "active",
          publishedAt: "2026-09-02T10:00:00.000Z",
        };
        if (activeVersion) activeVersion.status = "superseded";
        activeVersion = version;
        versions.push(version);
        return structuredClone(version);
      },
      async getActiveVersion() { return activeVersion ? structuredClone(activeVersion) : null; },
      async listVersions() { return versions.map((version) => structuredClone(version)); },
    },
    runs: {
      async create(run) { runs.set(run.id, structuredClone(run)); },
      async get(id) { return runs.has(id) ? structuredClone(runs.get(id)) : null; },
      async save(run) { runs.set(run.id, structuredClone(run)); },
      async list() { return [...runs.values()].map((run) => structuredClone(run)); },
    },
    profiles: {
      async list() { return profiles.map((profile) => structuredClone(profile)); },
      async publish(profile) { profiles.push(structuredClone(profile)); },
    },
    artifacts: {
      async put(runId, name, bytes) {
        const ref = `artifact://${runId}/${name}`;
        artifacts.set(ref, new Uint8Array(bytes));
        return ref;
      },
      async get(ref) {
        if (!artifacts.has(ref)) throw new Error("artifact not found");
        return new Uint8Array(artifacts.get(ref));
      },
    },
  };
}

export function fakeBridge(options = {}) {
  const state = {
    schema: options.schema ?? {
      type: "object",
      additionalProperties: false,
      properties: {
        language: { type: "string", default: "fr" },
        postproc: { type: "string", enum: ["cut", "trim"] },
      },
    },
    dryRuns: [],
    executions: [],
  };
  return {
    state,
    async getSchema() { return state.schema; },
    async dryRun(request) {
      state.dryRuns.push(structuredClone(request));
      if (options.dryRunError) throw new Error(options.dryRunError);
      return options.dryRun ?? { accepted: true, plan: [{ runId: request.runId }], raw: { status: "dry_run_success" } };
    },
    async execute(request) {
      state.executions.push(structuredClone(request));
      if (options.executeError) throw new Error(options.executeError);
      return options.execution ?? {
        status: "succeeded",
        metrics: { precision_stats: { median: 148, n: 3 } },
        artifacts: [],
        raw: { status: "ok", precision_stats: { median: 148, n: 3 } },
      };
    },
    async reconcile() { return { status: "unknown" }; },
  };
}

export function fakeCanonicalProfilePort(options = {}) {
  const calls = [];
  return {
    calls,
    async ensurePublished(inputValue) {
      calls.push(structuredClone(inputValue));
      if (options.error) throw new Error(options.error);
      return { canonicalRef: options.canonicalRef ?? "python://voice_wpm/voice-1" };
    },
  };
}

export function makeApplication({ repositories, bridge, canonical, clock, credentials } = {}) {
  return createCalibrationApplication({ repositories, bridge, canonical, clock, credentials });
}

async function publishCorpus(repositories) {
  const draft = await repositories.corpus.getDraft("local-default");
  const saved = await repositories.corpus.saveDraft(
    "local-default",
    { ...draft, items: [{ id: "one", order: 1, text: "Bonjour." }, { id: "two", order: 0, text: "Le monde." }] },
    draft.revision,
  );
  return repositories.corpus.publishDraft("local-default", saved.revision);
}

test("prepareDryRun refuses calibration without an active published corpus", async () => {
  const bridge = fakeBridge();
  const app = makeApplication({ repositories: memoryRepositories(), bridge, canonical: fakeCanonicalProfilePort() });
  await rejects(app.prepareDryRun(input), /active published corpus/);
  strictEqual(bridge.state.dryRuns.length, 0);
});

test("the application preserves the resolved snapshot through approval, execution and explicit profile publication", async () => {
  const repositories = memoryRepositories();
  await publishCorpus(repositories);
  let now = new Date("2026-09-02T10:00:00.000Z");
  const bridge = fakeBridge();
  const canonical = fakeCanonicalProfilePort();
  const app = makeApplication({ repositories, bridge, canonical, clock: { now: () => now } });

  const run = await app.prepareDryRun(input);
  strictEqual(run.status, "dry_run_ready");
  strictEqual(run.request.params.corpus_key, "voice-1");
  deepStrictEqual(run.request.params.text_source, { kind: "inline", text: "Le monde.\n\nBonjour." });
  match(run.requestDigest, /^[a-f0-9]{64}$/);
  strictEqual(bridge.state.dryRuns.length, 1);
  await rejects(app.approve(run.id, { requestDigest: "wrong-digest" }), /request digest mismatch/);

  const approved = await app.approve(run.id, { requestDigest: run.requestDigest });
  strictEqual(approved.status, "approved");
  strictEqual(approved.approval.expiresAt, "2026-09-02T10:15:00.000Z");

  const result = await app.execute(run.id);
  strictEqual(result.status, "succeeded");
  strictEqual(result.approval.consumedAt, "2026-09-02T10:00:00.000Z");
  strictEqual(bridge.state.executions.length, 1);
  deepStrictEqual(bridge.state.executions[0].snapshot, run.request);
  strictEqual((await app.listVoiceProfiles()).length, 0);
  const profile = await app.publishProfile(run.id);
  strictEqual(profile.wpmSnapshot, 148);
  strictEqual(profile.canonicalRef, "python://voice_wpm/voice-1");
  strictEqual((await app.listVoiceProfiles("local-default")).length, 1);
  strictEqual(canonical.calls.length, 1);
  now = new Date("2026-09-02T10:01:00.000Z");
});

test("execution consumes approval before a lost response and never retries execution_unknown", async () => {
  const repositories = memoryRepositories();
  await publishCorpus(repositories);
  const bridge = fakeBridge({ executeError: "execution_unknown" });
  const app = makeApplication({ repositories, bridge, canonical: fakeCanonicalProfilePort() });
  const run = await app.prepareDryRun(input);
  await app.approve(run.id, { requestDigest: run.requestDigest });
  const unknown = await app.execute(run.id);
  strictEqual(unknown.status, "execution_unknown");
  strictEqual(unknown.approval.consumedAt !== null, true);
  strictEqual(bridge.state.executions.length, 1);
  await rejects(app.execute(run.id), /execution_unknown.*retry|retry.*execution_unknown/);
  strictEqual(bridge.state.executions.length, 1);
});

test("approval expires according to the injected clock", async () => {
  const repositories = memoryRepositories();
  await publishCorpus(repositories);
  let now = new Date("2026-09-02T10:00:00Z");
  const app = makeApplication({ repositories, bridge: fakeBridge(), canonical: fakeCanonicalProfilePort(), clock: { now: () => now } });
  const run = await app.prepareDryRun(input);
  await app.approve(run.id, { requestDigest: run.requestDigest });
  now = new Date("2026-09-02T10:16:00Z");
  await rejects(app.execute(run.id), /approval expired/);
});

test("the HTTP API enforces nonce, ETag, same-origin and safe static paths", async (t) => {
  const repositories = memoryRepositories();
  await publishCorpus(repositories);
  const app = makeApplication({ repositories, bridge: fakeBridge(), canonical: fakeCanonicalProfilePort() });
  await rejects(
    startCalibrationUi({ application: app, host: "0.0.0.0", port: 0 }),
    /allow-network/,
  );
  const ui = await startCalibrationUi({ application: app, host: "127.0.0.1", port: 0 });
  t.after(async () => ui.close());

  const bootstrapResponse = await fetch(`${ui.url}/api/v1/bootstrap`);
  strictEqual(bootstrapResponse.status, 200);
  const bootstrap = await bootstrapResponse.json();
  match(bootstrap.sessionNonce, /^[a-f0-9-]{36}$/);

  const draftResponse = await fetch(`${ui.url}/api/v1/corpus/draft`);
  strictEqual(draftResponse.status, 200);
  const etag = draftResponse.headers.get("etag");
  strictEqual(typeof etag, "string");

  const missingNonce = await fetch(`${ui.url}/api/v1/corpus/draft`, {
    method: "PUT",
    headers: { "content-type": "application/json", "if-match": etag },
    body: JSON.stringify({ workspaceId: "local-default", revision: 0, items: [] }),
  });
  strictEqual(missingNonce.status, 409);

  const staleEtag = await fetch(`${ui.url}/api/v1/corpus/draft`, {
    method: "PUT",
    headers: { "content-type": "application/json", "if-match": 'W/"corpus-draft-999"', "x-calibration-nonce": bootstrap.sessionNonce },
    body: JSON.stringify({ workspaceId: "local-default", revision: 0, items: [] }),
  });
  strictEqual(staleEtag.status, 412);

  const crossOrigin = await fetch(`${ui.url}/api/v1/bootstrap`, { headers: { origin: "https://evil.example" } });
  strictEqual(crossOrigin.status, 403);
  strictEqual((await fetch(`${ui.url}/unknown.js`)).status, 404);
  strictEqual((await fetch(`${ui.url}/../package.json`)).status, 404);
});
