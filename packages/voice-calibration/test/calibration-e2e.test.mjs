import { test } from "node:test";
import { deepStrictEqual, strictEqual, match } from "node:assert";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createCalibrationApplication } from "../dist/calibration/application.js";
import { startCalibrationUi } from "../dist/calibration/http-server.js";
import { createLocalStore } from "../dist/calibration/ports.js";

function fakeBridge() {
  const state = {
    schema: { type: "object", additionalProperties: false, properties: { postproc: { type: "string", enum: ["cut", "trim"] } } },
    dryRuns: [],
    executions: [],
    failNext: false,
  };
  return {
    state,
    async getSchema() { return state.schema; },
    async dryRun(request) {
      state.dryRuns.push(structuredClone(request));
      return { accepted: true, plan: [{ runId: request.runId }], raw: { status: "dry_run_success", requests_planned: 3 } };
    },
    async execute(request) {
      state.executions.push(structuredClone(request));
      if (state.failNext) { state.failNext = false; throw new Error("execution_unknown"); }
      return { status: "succeeded", metrics: { precision_stats: { median: 148, n: 3 } }, artifacts: [], raw: { status: "ok", precision_stats: { median: 148, n: 3 }, actual_cost_usd: 0.0617 } };
    },
    async reconcile() { return { status: "unknown" }; },
  };
}

function fakeCanonical(options = {}) {
  const calls = [];
  return {
    calls,
    async ensurePublished(input) {
      calls.push(structuredClone(input));
      if (options.error) throw new Error(options.error);
      return { canonicalRef: "Shared/voice-calibration/voice_wpm.json#voice-1.wpm_calibrated" };
    },
  };
}

async function body(response) { return response.json(); }

test("local calibration MVP runs the standard corpus once and keeps WPM canonical", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "calibration-e2e-"));
  const repositories = createLocalStore(root);
  const bridge = fakeBridge();
  const canonical = fakeCanonical();
  let now = new Date("2026-09-02T10:00:00.000Z");
  const application = createCalibrationApplication({ repositories, bridge, canonical, clock: { now: () => now } });
  const ui = await startCalibrationUi({ application, host: "127.0.0.1", port: 0 });
  t.after(async () => ui.close());
  const jsonHeaders = { "content-type": "application/json" };

  const bootstrapResponse = await fetch(`${ui.url}/api/v1/bootstrap`);
  strictEqual(bootstrapResponse.status, 200);
  const bootstrap = await body(bootstrapResponse);
  match(bootstrap.sessionNonce, /^[a-f0-9-]{36}$/);
  const nonceHeaders = { ...jsonHeaders, "x-calibration-nonce": bootstrap.sessionNonce };

  const draftResponse = await fetch(`${ui.url}/api/v1/corpus/draft`);
  const draft = await body(draftResponse);
  const etag = draftResponse.headers.get("etag");
  const texts = [{ id: "one", order: 1, text: "Bonjour." }, { id: "two", order: 0, text: "Le monde." }, { id: "three", order: 2, text: "Ceci est standard." }];
  const saveResponse = await fetch(`${ui.url}/api/v1/corpus/draft`, { method: "PUT", headers: { ...nonceHeaders, "if-match": etag }, body: JSON.stringify({ ...draft, items: texts }) });
  strictEqual(saveResponse.status, 200);
  const saved = await body(saveResponse);
  const versionResponse = await fetch(`${ui.url}/api/v1/corpus/versions`, { method: "POST", headers: nonceHeaders, body: JSON.stringify({ expectedRevision: saved.revision }) });
  strictEqual(versionResponse.status, 201);

  strictEqual((await fetch(`${ui.url}/api/v1/calibration/schema`)).status, 200);
  const dryRunResponse = await fetch(`${ui.url}/api/v1/calibration-runs/dry-run`, {
    method: "POST",
    headers: nonceHeaders,
    body: JSON.stringify({ workspaceId: "local-default", voiceRef: "voice-1", params: {
      model_id: "eleven_v3",
      voice_settings: { stability: 0.5, similarity_boost: 0.85, style: 0, use_speaker_boost: true },
      text_source: { kind: "inline", text: "caller text is replaced by the active corpus" },
      mode: "precision", language: "fr", runs: 3, dry_run: false,
    }, postproc: "cut" }),
  });
  strictEqual(dryRunResponse.status, 201);
  const run = await body(dryRunResponse);
  deepStrictEqual(bridge.state.dryRuns[0].request.params.text_source, { kind: "inline", text: "Le monde.\n\nBonjour.\n\nCeci est standard." });

  const changedDraft = { ...saved, items: [...texts, { id: "later", order: 3, text: "Après le dry-run." }] };
  const changedResponse = await fetch(`${ui.url}/api/v1/corpus/draft`, { method: "PUT", headers: { ...nonceHeaders, "if-match": saveResponse.headers.get("etag") }, body: JSON.stringify(changedDraft) });
  strictEqual(changedResponse.status, 200);
  const storedBeforeApproval = await body(await fetch(`${ui.url}/api/v1/calibration-runs/${run.id}`));
  strictEqual(storedBeforeApproval.report, null);
  deepStrictEqual(storedBeforeApproval.request.params.text_source, bridge.state.dryRuns[0].request.params.text_source);

  const approved = await body(await fetch(`${ui.url}/api/v1/calibration-runs/${run.id}/approve`, { method: "POST", headers: nonceHeaders, body: JSON.stringify({ requestDigest: run.requestDigest }) }));
  strictEqual(approved.status, "approved");
  const executedResponse = await fetch(`${ui.url}/api/v1/calibration-runs/${run.id}/execute`, { method: "POST", headers: nonceHeaders, body: "{}" });
  strictEqual(executedResponse.status, 200);
  const executed = await body(executedResponse);
  strictEqual(executed.status, "succeeded");
  const reportRun = await body(await fetch(`${ui.url}/api/v1/calibration-runs/${run.id}`));
  strictEqual(reportRun.report.metrics.precision_stats.median, 148);
  strictEqual(reportRun.report.providerResult.actual_cost_usd, 0.0617);
  strictEqual(canonical.calls.length, 0);

  const profileResponse = await fetch(`${ui.url}/api/v1/voice-profiles`, { method: "POST", headers: nonceHeaders, body: JSON.stringify({ runId: run.id }) });
  strictEqual(profileResponse.status, 201);
  strictEqual((await body(profileResponse)).canonicalRef, "Shared/voice-calibration/voice_wpm.json#voice-1.wpm_calibrated");
  strictEqual(canonical.calls.length, 1);
  strictEqual((await body(await fetch(`${ui.url}/api/v1/voice-profiles`))).length, 1);

  const secondRun = await body(await fetch(`${ui.url}/api/v1/calibration-runs/dry-run`, { method: "POST", headers: nonceHeaders, body: JSON.stringify({ workspaceId: "local-default", voiceRef: "voice-1", params: { model_id: "eleven_v3", voice_settings: { stability: 0.5, similarity_boost: 0.85 }, mode: "precision", language: "fr", runs: 3 }, postproc: "cut" }) }));
  await body(await fetch(`${ui.url}/api/v1/calibration-runs/${secondRun.id}/approve`, { method: "POST", headers: nonceHeaders, body: JSON.stringify({ requestDigest: secondRun.requestDigest }) }));
  const originalExecutionCount = bridge.state.executions.length;
  const duplicate = await fetch(`${ui.url}/api/v1/calibration-runs/${run.id}/execute`, { method: "POST", headers: nonceHeaders, body: "{}" });
  strictEqual(duplicate.status, 409);
  strictEqual(bridge.state.executions.length, originalExecutionCount);

  now = new Date("2026-09-02T10:16:00.000Z");
  strictEqual((await fetch(`${ui.url}/api/v1/calibration-runs/${secondRun.id}/execute`, { method: "POST", headers: nonceHeaders, body: "{}" })).status, 409);
  now = new Date("2026-09-02T10:00:00.000Z");
  bridge.state.failNext = true;
  const lostResponse = await fetch(`${ui.url}/api/v1/calibration-runs/${secondRun.id}/execute`, { method: "POST", headers: nonceHeaders, body: "{}" });
  strictEqual(lostResponse.status, 200);
  strictEqual((await body(lostResponse)).status, "execution_unknown");
  strictEqual(bridge.state.executions.length, originalExecutionCount + 1);
});

test("profile publication fails closed when the canonical Python port fails", async () => {
  const repositories = createLocalStore(mkdtempSync(join(tmpdir(), "calibration-e2e-fail-")));
  const bridge = fakeBridge();
  const canonical = fakeCanonical({ error: "canonical_wpm_unavailable" });
  const application = createCalibrationApplication({ repositories, bridge, canonical });
  const ui = await startCalibrationUi({ application, host: "127.0.0.1", port: 0 });
  try {
    const nonce = (await (await fetch(`${ui.url}/api/v1/bootstrap`)).json()).sessionNonce;
    const headers = { "content-type": "application/json", "x-calibration-nonce": nonce };
    const draftResponse = await fetch(`${ui.url}/api/v1/corpus/draft`);
    const draft = await draftResponse.json();
    const savedResponse = await fetch(`${ui.url}/api/v1/corpus/draft`, { method: "PUT", headers: { ...headers, "if-match": draftResponse.headers.get("etag") }, body: JSON.stringify({ ...draft, items: [{ id: "one", order: 0, text: "Bonjour." }] }) });
    const saved = await savedResponse.json();
    await fetch(`${ui.url}/api/v1/corpus/versions`, { method: "POST", headers, body: JSON.stringify({ expectedRevision: saved.revision }) });
    const runResponse = await fetch(`${ui.url}/api/v1/calibration-runs/dry-run`, { method: "POST", headers, body: JSON.stringify({ workspaceId: "local-default", voiceRef: "voice-1", params: { model_id: "eleven_v3", voice_settings: { stability: 0.5, similarity_boost: 0.85 }, mode: "precision", language: "fr", runs: 3 }, postproc: "cut" }) });
    const run = await runResponse.json();
    await fetch(`${ui.url}/api/v1/calibration-runs/${run.id}/approve`, { method: "POST", headers, body: JSON.stringify({ requestDigest: run.requestDigest }) });
    await fetch(`${ui.url}/api/v1/calibration-runs/${run.id}/execute`, { method: "POST", headers, body: "{}" });
    const profile = await fetch(`${ui.url}/api/v1/voice-profiles`, { method: "POST", headers, body: JSON.stringify({ runId: run.id }) });
    strictEqual(profile.status, 503);
    strictEqual((await (await fetch(`${ui.url}/api/v1/voice-profiles`)).json()).length, 0);
  } finally {
    await ui.close();
  }
});
