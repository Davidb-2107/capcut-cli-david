import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { deepStrictEqual, rejects, strictEqual, match, throws } from "node:assert";

import { createCalibrationApplication } from "../dist/calibration/application.js";
import { startCalibrationUi } from "../dist/calibration/http-server.js";
import { createLocalStore } from "../dist/calibration/ports.js";

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
      async recoverRunning(runId, recoveredAt) {
        const run = runs.get(runId);
        if (!run) return null;
        if (run.status !== "running") return structuredClone(run);
        const recovered = { ...run, status: "execution_unknown", updatedAt: recoveredAt };
        runs.set(runId, structuredClone(recovered));
        return structuredClone(recovered);
      },
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

function coreGateBridge() {
  const state = { calls: [], current: null };
  const schema = { type: "object", additionalProperties: false, properties: {} };
  const makeRecord = (request, status, requestDigest, approval = null, result = null) => ({
    runId: "core-run-1",
    workspaceId: "local-default",
    revision: status === "dry_run_ready" ? 0 : status === "approved" ? 1 : 2,
    status,
    context: {
      corpus_version_id: request.corpusVersionId,
      corpus_digest: request.corpusDigest,
      contract_digest: request.contractDigest,
      core_digest: request.coreDigest,
    },
    request: { ...request.params, voice: request.voiceRef, postproc: request.postproc, dry_run: false },
    requestDigest,
    proposal: { status: "dry_run_success", requests_planned: 3 },
    approval,
    result,
    createdAt: "2026-09-03T10:00:00.000Z",
    updatedAt: "2026-09-03T10:00:00.000Z",
    raw: { status },
    requestSnapshot: structuredClone(request),
  });
  return {
    state,
    async getSchema() { return schema; },
    async propose(inputValue) {
      state.calls.push({ operation: "propose", input: structuredClone(inputValue) });
      state.current = makeRecord(inputValue.request, "dry_run_ready", "v1:sha256:core-request");
      return {
        accepted: true,
        plan: [],
        raw: { status: "dry_run_success", requests_planned: 3 },
        status: state.current.status,
        runId: state.current.runId,
        requestDigest: state.current.requestDigest,
        proposal: state.current.proposal,
        approval: null,
      };
    },
    async approve(inputValue) {
      state.calls.push({ operation: "approve", input: structuredClone(inputValue) });
      state.current = makeRecord(
        state.current.requestSnapshot,
        "approved",
        state.current.requestDigest,
        { approvedAt: "2026-09-03T10:00:00.000Z", expiresAt: "2026-09-03T10:15:00.000Z", consumedAt: null },
      );
      return state.current;
    },
    async getRun() {
      return state.current;
    },
    async execute(inputValue) {
      state.calls.push({ operation: "execute", input: structuredClone(inputValue) });
      state.current = {
        ...state.current,
        status: "succeeded",
        approval: { ...state.current.approval, consumedAt: "2026-09-03T10:00:00.000Z" },
        result: { status: "ok", precision_stats: { median: 168, n: 3 } },
      };
      return {
        status: "succeeded",
        metrics: { precision_stats: { median: 168, n: 3 } },
        artifacts: [],
        raw: state.current.result,
        coreRun: state.current,
      };
    },
    async reconcile() { return state.current; },
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

export function makeApplication({ repositories, bridge, canonical, clock, credentials, voiceDirectory } = {}) {
  return createCalibrationApplication({ repositories, bridge, canonical, clock, credentials, voiceDirectory });
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

test("the application requires a persistent run listing repository", () => {
  const repositories = memoryRepositories();
  delete repositories.runs.list;
  throws(
    () => makeApplication({ repositories, bridge: fakeBridge(), canonical: fakeCanonicalProfilePort() }),
    /runs\.list is required/,
  );
});

test("bootstrap reloads recent runs from persistent storage after an application restart", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "calibration-restart-"));
  try {
    const repositories = createLocalStore(dataDir);
    await publishCorpus(repositories);
    const run = await makeApplication({
      repositories,
      bridge: fakeBridge(),
      canonical: fakeCanonicalProfilePort(),
    }).prepareDryRun(input);

    const restarted = makeApplication({
      repositories: createLocalStore(dataDir),
      bridge: fakeBridge(),
      canonical: fakeCanonicalProfilePort(),
    });
    const bootstrap = await restarted.getBootstrap();
    strictEqual(bootstrap.recentRuns.some((candidate) => candidate.id === run.id), true);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("persists the accepted proposal preview across an application restart", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "calibration-proposal-"));
  try {
    const repositories = createLocalStore(dataDir);
    await publishCorpus(repositories);
    const bridge = fakeBridge({
      dryRun: {
        accepted: true,
        plan: [{ slug: "precision-01", characters: 42 }],
        raw: { status: "dry_run_success", billable_characters: 126, estimated_cost_usd: 0.0126 },
      },
    });
    const run = await makeApplication({
      repositories,
      bridge,
      canonical: fakeCanonicalProfilePort(),
    }).prepareDryRun(input);

    strictEqual(run.status, "dry_run_ready");
    deepStrictEqual(run.proposal, {
      accepted: true,
      plan: [{ slug: "precision-01", characters: 42 }],
      raw: { status: "dry_run_success", billable_characters: 126, estimated_cost_usd: 0.0126 },
    });

    const restarted = makeApplication({
      repositories: createLocalStore(dataDir),
      bridge: fakeBridge(),
      canonical: fakeCanonicalProfilePort(),
    });
    const persisted = await restarted.getRun(run.id);
    deepStrictEqual(persisted?.proposal, run.proposal);
    strictEqual(persisted?.status, "dry_run_ready");
    await rejects(restarted.execute(run.id), /approval required/);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("bootstrap recovers persisted running runs as execution_unknown", async () => {
  const repositories = memoryRepositories();
  await publishCorpus(repositories);
  const app = makeApplication({ repositories, bridge: fakeBridge(), canonical: fakeCanonicalProfilePort() });
  const run = await app.prepareDryRun(input);
  const approved = await app.approve(run.id, { requestDigest: run.requestDigest });
  await repositories.runs.save({
    ...approved,
    status: "running",
    approval: { ...approved.approval, consumedAt: "2026-09-02T10:00:00.000Z" },
  });

  const restarted = makeApplication({ repositories, bridge: fakeBridge(), canonical: fakeCanonicalProfilePort() });
  const bootstrap = await restarted.getBootstrap();
  strictEqual(bootstrap.recentRuns.find((candidate) => candidate.id === run.id)?.status, "execution_unknown");
  strictEqual((await repositories.runs.get(run.id)).status, "execution_unknown");
});

test("persisted error reports redact the exact provider credential", async () => {
  const repositories = memoryRepositories();
  await publishCorpus(repositories);
  const secret = "sk-live-calibration-secret";
  const credentials = {
    async status() { return { configured: true }; },
    async forRun() { return { provider: "elevenlabs", secret }; },
    redact(value) { return typeof value === "string" ? value.split(secret).join("[REDACTED]") : value; },
  };
  const app = makeApplication({
    repositories,
    bridge: fakeBridge({ executeError: `provider failed with ${secret}` }),
    canonical: fakeCanonicalProfilePort(),
    credentials,
  });
  const run = await app.prepareDryRun(input);
  await app.approve(run.id, { requestDigest: run.requestDigest });
  await app.execute(run.id);
  const report = await app.getReport(run.id);
  strictEqual(JSON.stringify(report).includes(secret), false);
  strictEqual(report.error.message.includes("[REDACTED]"), true);
});

test("HTTP responses redact sensitive values inside JSON-shaped strings", async (t) => {
  const repositories = memoryRepositories();
  await publishCorpus(repositories);
  const secret = "quoted-provider-secret";
  const app = makeApplication({
    repositories,
    bridge: fakeBridge({
      execution: {
        status: "succeeded",
        metrics: {},
        artifacts: [],
        raw: { details: `{"api_key":"${secret}"}` },
      },
    }),
    canonical: fakeCanonicalProfilePort(),
  });
  const run = await app.prepareDryRun(input);
  await app.approve(run.id, { requestDigest: run.requestDigest });
  await app.execute(run.id);
  const ui = await startCalibrationUi({ application: app, host: "127.0.0.1", port: 0 });
  t.after(async () => ui.close());

  const response = await fetch(`${ui.url}/api/v1/calibration-runs/${run.id}`);
  const body = await response.json();
  strictEqual(JSON.stringify(body).includes(secret), false);
  strictEqual(JSON.stringify(body).includes("[REDACTED]"), true);
});

test("prepareDryRun refuses calibration without an active published corpus", async () => {
  const bridge = fakeBridge();
  const app = makeApplication({ repositories: memoryRepositories(), bridge, canonical: fakeCanonicalProfilePort() });
  await rejects(app.prepareDryRun(input), /active published corpus/);
  strictEqual(bridge.state.dryRuns.length, 0);
});

test("the application projects the persistent core gate and never runs a second local workflow", async () => {
  const repositories = memoryRepositories();
  await publishCorpus(repositories);
  const bridge = coreGateBridge();
  const app = makeApplication({ repositories, bridge, canonical: fakeCanonicalProfilePort() });

  const run = await app.prepareDryRun(input);
  strictEqual(run.id, "core-run-1");
  strictEqual(run.status, "dry_run_ready");
  strictEqual(run.requestDigest, "v1:sha256:core-request");
  strictEqual(bridge.state.calls[0].operation, "propose");

  const approved = await app.approve(run.id, { requestDigest: run.requestDigest });
  strictEqual(approved.status, "approved");
  strictEqual(bridge.state.calls[1].operation, "approve");

  const executed = await app.execute(run.id);
  strictEqual(executed.status, "succeeded");
  strictEqual(bridge.state.calls[2].operation, "execute");
  strictEqual(bridge.state.calls[2].input.coreRunId, "core-run-1");
  strictEqual(bridge.state.calls[2].input.workspaceId, "local-default");
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

test("core publication commits the canonical corpus before the local profile", async () => {
  const repositories = memoryRepositories();
  await publishCorpus(repositories);
  const bridge = fakeBridge();
  const publicationCalls = [];
  bridge.publish = async (inputValue) => {
    publicationCalls.push(structuredClone(inputValue));
    return { canonicalRef: "python://voice_wpm/voice-1", wpm: 149, runsPublished: 3 };
  };
  const canonical = fakeCanonicalProfilePort();
  const app = makeApplication({ repositories, bridge, canonical });
  const run = await app.prepareDryRun(input);
  await app.approve(run.id, { requestDigest: run.requestDigest });
  await app.execute(run.id);

  const profile = await app.publishProfile(run.id);

  strictEqual(publicationCalls.length, 1);
  strictEqual(publicationCalls[0].workspaceId, "local-default");
  strictEqual(publicationCalls[0].runId, run.id);
  strictEqual(canonical.calls[0].wpm, 149);
  strictEqual(profile.wpmSnapshot, 149);
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
  const corpusResponse = await fetch(`${ui.url}/api/v1/corpus`);
  strictEqual(corpusResponse.status, 200);
  strictEqual(corpusResponse.headers.get("etag"), etag);

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

test("the HTTP API returns only the requested voice reference and name", async (t) => {
  const repositories = memoryRepositories();
  await publishCorpus(repositories);
  const calls = [];
  const app = makeApplication({
    repositories,
    bridge: fakeBridge(),
    canonical: fakeCanonicalProfilePort(),
    voiceDirectory: {
      async getName(voiceRef) {
        calls.push(voiceRef);
        return "Voix française";
      },
    },
  });
  const ui = await startCalibrationUi({ application: app, host: "127.0.0.1", port: 0 });
  t.after(async () => ui.close());

  const response = await fetch(`${ui.url}/api/v1/voices/voice-1`);
  strictEqual(response.status, 200);
  deepStrictEqual(await response.json(), { voiceRef: "voice-1", name: "Voix française" });
  deepStrictEqual(calls, ["voice-1"]);
});
