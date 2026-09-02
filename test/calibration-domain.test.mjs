import { test } from "node:test";
import { deepStrictEqual, match, strictEqual, throws } from "node:assert";

import { fingerprintRequest, canonicalizeRequest } from "../dist/calibration/fingerprint.js";
import { transitionRun } from "../dist/calibration/domain.js";

const request = {
  contractDigest: "contract-sha",
  coreDigest: "core-sha",
  corpusVersionId: "standard-v1",
  corpusDigest: "corpus-sha",
  voiceRef: "voice-1",
  params: {
    model_id: "eleven_v3",
    voice_settings: { stability: 0.5, similarity_boost: 0.85, style: 0, use_speaker_boost: true },
    text_source: { kind: "inline", text: "Bonjour le monde." },
    mode: "precision",
    language: "fr",
    runs: 3,
    dry_run: false,
    corpus_key: "voice-1",
  },
  postproc: "cut",
};

test("canonicalization is stable regardless of object key order", () => {
  strictEqual(
    canonicalizeRequest({
      ...request,
      params: {
        corpus_key: "voice-1",
        mode: "precision",
        text_source: { kind: "inline", text: "Bonjour le monde." },
        voice_settings: { use_speaker_boost: true, style: 0, similarity_boost: 0.85, stability: 0.5 },
        model_id: "eleven_v3",
        language: "fr",
        runs: 3,
        dry_run: false,
      },
    }),
    canonicalizeRequest(request),
  );
  strictEqual(canonicalizeRequest({ b: null, a: false, nested: [3, 1] }), '{"a":false,"b":null,"nested":[3,1]}');
  match(fingerprintRequest(request), /^[a-f0-9]{64}$/);
});

test("canonicalization rejects undefined values", () => {
  throws(() => canonicalizeRequest({ allowed: null, forbidden: undefined }), /undefined/);
  throws(() => canonicalizeRequest({ nested: [true, undefined] }), /undefined/);
});

test("changing corpus, parameter or postproc changes the fingerprint", () => {
  strictEqual(fingerprintRequest(request), fingerprintRequest({ ...request }));
  strictEqual(fingerprintRequest({ ...request, corpusDigest: "other" }) === fingerprintRequest(request), false);
  strictEqual(
    fingerprintRequest({ ...request, params: { ...request.params, runs: 4 } }) === fingerprintRequest(request),
    false,
  );
  strictEqual(fingerprintRequest({ ...request, postproc: "trim" }) === fingerprintRequest(request), false);
});

test("illegal state transitions are rejected", () => {
  const draft = { status: "draft" };
  strictEqual(transitionRun(draft, { type: "dry_run_succeeded" }).status, "dry_run_ready");
  throws(() => transitionRun(draft, { type: "execute" }), /invalid transition/);
  throws(() => transitionRun({ status: "dry_run_ready" }, { type: "execute" }), /invalid transition/);
  throws(() => transitionRun({ status: "failed" }, { type: "execute" }), /invalid transition/);
  throws(() => transitionRun({ status: "execution_unknown" }, { type: "execute" }), /invalid transition/);
});

test("documented run transitions produce the expected statuses", () => {
  const ready = transitionRun({ status: "draft" }, { type: "dry_run_succeeded" });
  const approved = transitionRun(ready, { type: "approve", expiresAt: "2026-09-03T00:00:00Z" });
  const running = transitionRun(approved, { type: "execute" });

  strictEqual(approved.status, "approved");
  strictEqual(approved.approval.expiresAt, "2026-09-03T00:00:00Z");
  strictEqual(running.status, "running");
  strictEqual(transitionRun(running, { type: "succeeded" }).status, "succeeded");
  strictEqual(transitionRun(running, { type: "failed" }).status, "failed");
  strictEqual(transitionRun(running, { type: "execution_unknown" }).status, "execution_unknown");
});
