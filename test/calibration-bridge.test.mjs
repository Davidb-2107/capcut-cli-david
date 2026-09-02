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
import { createCredentialProvider, parseDotEnv } from "../dist/calibration/credentials.js";

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
