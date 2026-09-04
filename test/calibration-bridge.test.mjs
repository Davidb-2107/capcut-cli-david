import { deepStrictEqual, rejects, strictEqual } from "node:assert";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import {
  BridgeTransportError,
  createCalibrationBridge,
  createCanonicalProfilePort,
} from "../dist/calibration/bridge.js";
import { createCredentialProvider, createVoiceDirectoryProvider, parseDotEnv } from "../dist/calibration/credentials.js";

const resolvedRequest = {
  contractDigest: "contract-sha",
  coreDigest: "core-sha",
  corpusVersionId: "standard-v1",
  corpusDigest: "corpus-sha",
  voiceRef: "voice-1",
  params: {
    model_id: "eleven_v3",
    voice_settings: { stability: 0.3, similarity_boost: 0.85, style: 0.3, use_speaker_boost: true },
    text_source: { kind: "inline", text: "Bonjour le monde." },
    mode: "precision",
    language: "fr",
    runs: 3,
    corpus_key: "voice-1",
  },
  postproc: "cut",
};

function fakeTransport(options = {}) {
  const schema = { type: "object", additionalProperties: false };
  const transport = {
    schemaValue: schema,
    calls: [],
    async schema(secret) { this.schemaCredentialWasPassed = Boolean(secret); return this.schemaValue; },
    async call(args, secret) {
      this.calls.push({ args, credentialWasPassed: Boolean(secret) });
      if (options.preSendFailure) {
        throw new BridgeTransportError(`pre-send failure ${secret}`, false, `diagnostic ${secret}`);
      }
      if (options.dropExecutionResponse && args.dry_run === false) {
        throw new BridgeTransportError("response lost", true, `diagnostic ${secret}`);
      }
      if (options.remoteError && args.dry_run === false) {
        return { response: undefined, emitted: true, stderr: `stderr ${secret}`, remoteError: { code: -32602, message: `invalid request ${secret}` } };
      }
      if (args.dry_run) return { response: options.dryRun ?? { status: "dry_run_success", requests_planned: 3 }, emitted: true, stderr: `stderr ${secret}` };
      return { response: options.execute ?? { status: "ok", precision_stats: { median: 148 } }, emitted: true, stderr: `stderr ${secret}` };
    },
    async close() {},
  };
  return transport;
}

test("bridge forwards the resolved request and keeps credentials out of arguments", async () => {
  const transport = fakeTransport();
  const bridge = createCalibrationBridge({ transport, credentials: createCredentialProvider({ env: { ELEVENLABS_API_KEY: "secret" } }) });
  deepStrictEqual(await bridge.getSchema(), transport.schemaValue);
  strictEqual(transport.schemaCredentialWasPassed, true);
  const result = await bridge.dryRun({ runId: "r1", request: resolvedRequest });
  strictEqual(result.accepted, true);
  strictEqual(transport.calls.length, 1);
  strictEqual(transport.calls[0].args.voice, "voice-1");
  strictEqual(transport.calls[0].args.dry_run, true);
  strictEqual(transport.calls[0].args.postproc, "cut");
  strictEqual(JSON.stringify(transport.calls).includes("secret"), false);
});

test("bridge proposes through the core gate with the complete snapshot context", async () => {
  const calls = [];
  const transport = {
    schemaValue: { type: "object", additionalProperties: false },
    async schema() { return this.schemaValue; },
    async callTool(name, args, secret) {
      calls.push({ name, args, credentialWasPassed: Boolean(secret) });
      return {
        response: {
          run_id: "core-run-1",
          workspace_id: "local-default",
          revision: 0,
          status: "dry_run_ready",
          context: {
            corpus_version_id: "standard-v1",
            corpus_digest: "corpus-sha",
            contract_digest: "contract-sha",
            core_digest: "core-sha",
          },
          request: { ...resolvedRequest.params, voice: resolvedRequest.voiceRef, postproc: resolvedRequest.postproc, dry_run: false },
          request_digest: "v1:sha256:core-digest",
          proposal: { status: "dry_run_success", requests_planned: 3, diagnostic: secret },
          approval: null,
          result: null,
          created_at: "2026-09-03T10:00:00Z",
          updated_at: "2026-09-03T10:00:00Z",
        },
        emitted: true,
        stderr: `diagnostic ${secret}`,
      };
    },
    async close() {},
  };
  const bridge = createCalibrationBridge({
    transport,
    credentials: createCredentialProvider({ env: { ELEVENLABS_API_KEY: "secret" } }),
  });

  const result = await bridge.propose({ workspaceId: "local-default", request: resolvedRequest });

  strictEqual(result.accepted, true);
  strictEqual(result.runId, "core-run-1");
  strictEqual(result.requestDigest, "v1:sha256:core-digest");
  strictEqual(result.raw.proposal.diagnostic, "[REDACTED]");
  strictEqual(JSON.stringify(result).includes("secret"), false);
  strictEqual(calls[0].name, "propose_calibration");
  strictEqual(calls[0].args.workspace_id, "local-default");
  strictEqual(calls[0].args.corpus_version_id, "standard-v1");
  strictEqual(calls[0].args.corpus_digest, "corpus-sha");
  deepStrictEqual(calls[0].args.text_source, resolvedRequest.params.text_source);
  strictEqual(JSON.stringify(calls).includes("secret"), false);
});

test("bridge routes core approval and execution without resending the provider snapshot", async () => {
  const calls = [];
  const base = {
    run_id: "core-run-1",
    workspace_id: "local-default",
    revision: 1,
    status: "approved",
    context: { corpus_version_id: "standard-v1", corpus_digest: "corpus-sha", contract_digest: "contract-sha", core_digest: "core-sha" },
    request: { ...resolvedRequest.params, voice: resolvedRequest.voiceRef, postproc: resolvedRequest.postproc, dry_run: false },
    request_digest: "v1:sha256:core-digest",
    proposal: { status: "dry_run_success", requests_planned: 3 },
    approval: { approved_at: "2026-09-03T10:00:00Z", expires_at: "2026-09-03T10:15:00Z", consumed_at: null },
    result: null,
    created_at: "2026-09-03T10:00:00Z",
    updated_at: "2026-09-03T10:00:00Z",
  };
  const transport = {
    async schema() { return { type: "object" }; },
    async callTool(name, args, secret) {
      calls.push({ name, args, credentialWasPassed: Boolean(secret) });
      if (name === "approve_calibration") return { response: base, emitted: true, stderr: "" };
      if (name === "get_calibration_run" || name === "reconcile_calibration")
        return { response: base, emitted: true, stderr: "" };
      return {
        response: {
          ...base,
          status: "succeeded",
          revision: 2,
          approval: { ...base.approval, consumed_at: "2026-09-03T10:00:01Z" },
          result: { status: "ok", precision_stats: { median: 168, n: 3 } },
        },
        emitted: true,
        stderr: "",
      };
    },
    async close() {},
  };
  const bridge = createCalibrationBridge({
    transport,
    credentials: createCredentialProvider({ env: { ELEVENLABS_API_KEY: "secret" } }),
  });

  const approved = await bridge.approve({ workspaceId: "local-default", runId: "core-run-1", requestDigest: base.request_digest });
  strictEqual(approved.status, "approved");
  strictEqual(approved.approval.consumedAt, null);
  const executed = await bridge.execute({
    runId: "core-run-1",
    idempotencyKey: "core-run-1",
    snapshot: resolvedRequest,
    workspaceId: "local-default",
    coreRunId: "core-run-1",
  });
  strictEqual(executed.status, "succeeded");
  strictEqual(executed.coreRun.status, "succeeded");
  deepStrictEqual(executed.metrics, { precision_stats: { median: 168, n: 3 } });
  strictEqual(calls[0].name, "approve_calibration");
  strictEqual(calls[1].name, "execute_calibration");
  strictEqual(calls[1].args.run_id, "core-run-1");
  strictEqual(Object.hasOwn(calls[1].args, "text_source"), false);
});

test("bridge routes explicit publication through the core gate", async () => {
  const calls = [];
  const transport = {
    async schema() { return { type: "object" }; },
    async callTool(name, args, secret) {
      calls.push({ name, args, credentialWasPassed: Boolean(secret) });
      return {
        response: {
          run_id: "core-run-1",
          workspace_id: "local-default",
          revision: 3,
          status: "succeeded",
          context: {},
          request: {},
          request_digest: "v1:sha256:core-digest",
          proposal: {},
          approval: null,
          result: {
            status: "ok",
            publication: {
              status: "published",
              canonical_ref: "Shared/voice-calibration/voice_wpm.json#voice-1.wpm_calibrated",
              wpm: 179,
              runs_published: 3,
            },
          },
          created_at: "2026-09-03T10:00:00Z",
          updated_at: "2026-09-03T10:01:00Z",
        },
        emitted: true,
        stderr: "",
      };
    },
    async close() {},
  };
  const bridge = createCalibrationBridge({
    transport,
    credentials: createCredentialProvider({ env: { ELEVENLABS_API_KEY: "secret" } }),
  });

  deepStrictEqual(
    await bridge.publish({ workspaceId: "local-default", runId: "core-run-1" }),
    {
      canonicalRef: "Shared/voice-calibration/voice_wpm.json#voice-1.wpm_calibrated",
      wpm: 179,
      runsPublished: 3,
    },
  );
  strictEqual(calls.length, 1);
  strictEqual(calls[0].name, "publish_calibration");
  strictEqual(calls[0].args.workspace_id, "local-default");
  strictEqual(calls[0].args.run_id, "core-run-1");
  strictEqual(JSON.stringify(calls).includes("secret"), false);
});

test("lost execution response becomes execution_unknown without replay", async () => {
  const transport = fakeTransport({ dropExecutionResponse: true });
  const bridge = createCalibrationBridge({ transport, credentials: createCredentialProvider({ env: { ELEVENLABS_API_KEY: "secret" } }), timeoutMs: 20 });
  await rejects(
    bridge.execute({ runId: "r1", idempotencyKey: "r1", snapshot: resolvedRequest }),
    /execution_unknown/,
  );
  strictEqual(transport.calls.length, 1);
  deepStrictEqual(await bridge.reconcile({ runId: "r1", idempotencyKey: "r1" }), { status: "unknown" });
  strictEqual(transport.calls.length, 1);
});

test("pre-send failure is not execution_unknown and does not expose diagnostics", async () => {
  const transport = fakeTransport({ preSendFailure: true });
  const bridge = createCalibrationBridge({ transport, credentials: createCredentialProvider({ env: { ELEVENLABS_API_KEY: "secret" } }) });
  await rejects(
    bridge.execute({ runId: "r1", idempotencyKey: "r1", snapshot: resolvedRequest }),
    (error) => error.message.includes("secret") === false && error.message.includes("pre-send failure") === true,
  );
});

test("a received MCP error is failed, not execution_unknown, and is redacted", async () => {
  const transport = fakeTransport({ remoteError: true });
  const bridge = createCalibrationBridge({ transport, credentials: createCredentialProvider({ env: { ELEVENLABS_API_KEY: "secret" } }) });
  const result = await bridge.execute({ runId: "r1", idempotencyKey: "r1", snapshot: resolvedRequest });
  strictEqual(result.status, "failed");
  strictEqual(result.error.code, "-32602");
  strictEqual(result.error.message.includes("secret"), false);
  strictEqual(JSON.stringify(result.raw).includes("secret"), false);
});

test("successful source metrics and result envelope are preserved without recalculation", async () => {
  const transport = fakeTransport({ execute: {
    status: "ok",
    precision_stats: { n: 3, median: 148, min: 146, max: 150 },
    billable_characters: 1234,
    actual_credits_used: 617,
    actual_cost_usd: 0.0617,
  } });
  const bridge = createCalibrationBridge({ transport, credentials: createCredentialProvider({ env: { ELEVENLABS_API_KEY: "secret" } }) });
  const result = await bridge.execute({ runId: "r1", idempotencyKey: "r1", snapshot: resolvedRequest });
  strictEqual(result.status, "succeeded");
  deepStrictEqual(result.metrics, {
    precision_stats: { n: 3, median: 148, min: 146, max: 150 },
    billable_characters: 1234,
    actual_credits_used: 617,
    actual_cost_usd: 0.0617,
  });
  strictEqual(JSON.stringify(result.raw).includes("secret"), false);
});

test("credential status never returns the key and the parser preserves quoted values", async () => {
  const provider = createCredentialProvider({ env: { ELEVENLABS_API_KEY: "secret" } });
  deepStrictEqual(await provider.status(), { configured: true });
  strictEqual(JSON.stringify(await provider.status()).includes("secret"), false);
  deepStrictEqual(parseDotEnv("# comment\nELEVENLABS_API_KEY=\"quoted-value\"\nOTHER=x=y"), { ELEVENLABS_API_KEY: "quoted-value", OTHER: "x=y" });
  deepStrictEqual(await createCredentialProvider({ env: {} }).status(), { configured: false });
});

test("credential provider honors an explicit env file without exposing it", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "calibration-env-"));
  const envFile = join(dataDir, ".env");
  writeFileSync(envFile, "ELEVENLABS_API_KEY='from-file'\n");
  const provider = createCredentialProvider({ cwd: dataDir, envFile: ".env" });
  deepStrictEqual(await provider.status(), { configured: true });
  strictEqual((await provider.forRun()).secret, "from-file");

  const explicitFileWins = createCredentialProvider({ env: { ELEVENLABS_API_KEY: "from-process" }, cwd: dataDir, envFile: ".env" });
  strictEqual((await explicitFileWins.forRun()).secret, "from-file");
});

test("voice directory resolves a voice name with the server-side ElevenLabs credential", async () => {
  const calls = [];
  const credentials = createCredentialProvider({ env: { ELEVENLABS_API_KEY: "secret" } });
  const directory = createVoiceDirectoryProvider({
    credentials,
    fetcher: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        async json() { return { voice_id: "voice-1", name: "Voix française" }; },
      };
    },
  });

  strictEqual(await directory.getName("voice-1"), "Voix française");
  strictEqual(calls[0].url, "https://api.elevenlabs.io/v1/voices/voice-1");
  strictEqual(calls[0].init.headers["xi-api-key"], "secret");
});

test("profile publication verifies the canonical Python WPM source", async () => {
  const canonical = createCanonicalProfilePort({
    verify: async () => ({ canonicalRef: "Shared/voice-calibration/voice_wpm.json#voice-1.wpm_calibrated", wpm: 148 }),
  });
  deepStrictEqual(
    await canonical.ensurePublished({ voiceRef: "voice-1", wpm: 148, runId: "r1", corpusVersionId: "standard-v1" }),
    { canonicalRef: "Shared/voice-calibration/voice_wpm.json#voice-1.wpm_calibrated" },
  );
});

test("profile publication fails closed on a missing or mismatched canonical record", async () => {
  const missing = createCanonicalProfilePort({ verify: async () => { throw new Error("canonical_wpm_unavailable"); } });
  await rejects(missing.ensurePublished({ voiceRef: "voice-1", wpm: 148, runId: "r1", corpusVersionId: "v1" }), /canonical_wpm_unavailable/);
  const mismatch = createCanonicalProfilePort({ verify: async () => ({ canonicalRef: "ref", wpm: 147 }) });
  await rejects(mismatch.ensurePublished({ voiceRef: "voice-1", wpm: 148, runId: "r1", corpusVersionId: "v1" }), /canonical_wpm_mismatch/);
});
