import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { deepStrictEqual, strictEqual, ok } from "node:assert";
import vm from "node:vm";

const ROOT = resolve(import.meta.dirname, "..");
const CLIENT = readFileSync(resolve(ROOT, "dist/ui/calibration-client.js"), "utf8");

class FakeHeaders {
  constructor(init = {}) {
    this.values = new Map(Object.entries(init).map(([key, value]) => [key.toLowerCase(), String(value)]));
  }

  has(name) {
    return this.values.has(name.toLowerCase());
  }

  set(name, value) {
    this.values.set(name.toLowerCase(), String(value));
  }

  get(name) {
    return this.values.get(name.toLowerCase()) ?? null;
  }
}

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.dataset = {};
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.className = "";
    this.textContent = "";
    this.value = "";
    this.disabled = false;
    this.checked = false;
    this.elements = { namedItem: () => null };
    this.classList = {
      toggle: (name, active) => {
        if (name === "active") this.className = active ? "active" : "";
      },
    };
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes) {
    this.children = nodes;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  dispatch(type, event = {}) {
    const listeners = this.listeners.get(type) ?? [];
    for (const listener of listeners) {
      listener({ currentTarget: this, preventDefault() {}, ...event });
    }
  }

  querySelectorAll() {
    return [];
  }

  querySelector() {
    return null;
  }
}

function response(body, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new FakeHeaders(headers),
    async json() {
      return structuredClone(body);
    },
  };
}

function invalidJsonResponse() {
  return {
    ok: true,
    status: 200,
    headers: new FakeHeaders(),
    async json() {
      throw new SyntaxError("invalid JSON");
    },
  };
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function containsText(element, expected) {
  return element.textContent === expected || element.children.some((child) => containsText(child, expected));
}

test("client resynchronizes the run after execute returns an HTTP failure", async () => {
  const ids = [
    "status",
    "config-status",
    "corpus-items",
    "corpus-version",
    "profiles-list",
    "dry-run-state",
    "dry-run-summary",
    "result-preview",
    "refresh",
    "prepare-form",
    "approve",
    "execute",
    "publish-profile",
  ];
  const elements = new Map(ids.map((id) => [id, new FakeElement(id)]));
  const views = ["home", "corpus", "prepare", "dry-run", "result", "profiles"].map(
    (view) => new FakeElement(`view-${view}`),
  );
  const form = elements.get("prepare-form");
  const formFields = {
    voiceRef: Object.assign(new FakeElement("voiceRef"), { value: "voice-1" }),
  };
  form.elements = { namedItem: (name) => formFields[name] ?? null };
  const calls = [];
  let invalidBootstrap = false;
  const run = {
    id: "run-1",
    status: "dry_run_ready",
    requestDigest: "digest-1",
    request: { params: { postproc: "cut" } },
    proposal: {
      accepted: true,
      plan: [{ slug: "precision-01" }],
      raw: { status: "dry_run_success", estimated_cost_usd: 0.0126 },
    },
    approval: null,
  };
  const approved = { ...run, status: "approved", approval: { approvedAt: "now" } };
  const failed = {
    ...approved,
    status: "failed",
    report: { error: { code: "provider_unavailable", message: "Provider unavailable" } },
  };
  const succeeded = {
    ...approved,
    status: "succeeded",
    report: { metrics: { runs_synthesized: 3 } },
  };
  let terminalRecovery = false;
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? "GET", init });
    if (url === "/api/v1/bootstrap") {
      return invalidBootstrap
        ? invalidJsonResponse()
        : response({ sessionNonce: "nonce", config: { configured: true }, profiles: [] });
    }
    if (url === "/api/v1/corpus") {
      return response(
        {
          draft: { revision: 0, items: [{ id: "item-1", order: 0, text: "Brouillon non publié." }] },
          activeVersion: {
            revision: 42,
            contentDigest: "digest-corpus-42",
            items: [{ id: "item-1", order: 0, text: "Bonjour." }],
          },
        },
        200,
        { etag: 'W/"server-draft-42"' },
      );
    }
    if (url === "/api/v1/corpus/draft") return response({ revision: 42, items: [] }, 200, { etag: 'W/"server-draft-43"' });
    if (url === "/api/v1/calibration-runs/dry-run") return response(run, 201);
    if (url === "/api/v1/calibration-runs/run-1/approve") return response(approved);
    if (url === "/api/v1/calibration-runs/run-1/execute") {
      return terminalRecovery
        ? response({ error: { code: "approval_required", message: "approval required; got succeeded" } }, 409)
        : response({ error: { code: "provider_unavailable", message: "Provider unavailable" } }, 503);
    }
    if (url === "/api/v1/calibration-runs/run-1") return response(terminalRecovery ? succeeded : failed);
    throw new Error(`unexpected fetch: ${url}`);
  };
  const document = {
    getElementById(id) {
      return elements.get(id) ?? null;
    },
    querySelectorAll(selector) {
      if (selector === ".view") return views;
      return [];
    },
    createElement() {
      return new FakeElement();
    },
  };
  const context = vm.createContext({
    document,
    fetch,
    Headers: FakeHeaders,
    crypto: { randomUUID: () => "generated-id" },
    console,
    setImmediate,
  });

  vm.runInContext(CLIENT, context);
  await flush();
  const corpusRow = elements.get("corpus-items").children[0];
  strictEqual(corpusRow.children.length, 2, "corpus rows must expose only a label and read-only text");
  strictEqual(corpusRow.children[0].textContent, "Texte 1", "corpus rows must be visibly numbered");
  strictEqual(corpusRow.children[1].textContent, "Bonjour.", "corpus rows must render the published text");
  strictEqual(corpusRow.dataset.order, "0", "corpus order must remain stored internally");
  ok(
    elements.get("corpus-version").textContent.includes("digest-corpus-42"),
    "the published corpus version must be identified",
  );
  ok(
    !calls.some((call) => call.url === "/api/v1/corpus/draft" && call.method === "PUT"),
    "the calibration UI must not write corpus drafts",
  );
  form.dispatch("submit", { currentTarget: form });
  await flush();
  const dryRunCall = calls.find((call) => call.url === "/api/v1/calibration-runs/dry-run");
  const dryRunPayload = JSON.parse(dryRunCall?.init.body);
  deepStrictEqual(dryRunPayload.params, {
    model_id: "eleven_multilingual_v2",
    mode: "precision",
    language: "fr",
    runs: 3,
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.85,
      style: 0,
      use_speaker_boost: true,
    },
  });
  strictEqual(dryRunPayload.postproc, "cut");
  ok(!calls.some((call) => call.url.endsWith("/execute")), "preparing a dry-run must not execute automatically");
  strictEqual(elements.get("approve").disabled, false);
  strictEqual(elements.get("execute").disabled, true);
  ok(
    elements.get("dry-run-summary").textContent.includes("0.0126 USD"),
    "the estimated cost must remain visible before approval",
  );
  ok(
    elements.get("dry-run-summary").textContent.includes("Vérifiez le récapitulatif"),
    "the dry-run must explain that approval is the next step",
  );
  ok(!elements.get("dry-run-summary").textContent.includes("estimated_cost_usd"), "raw proposal JSON must stay hidden");
  elements.get("approve").dispatch("click");
  await flush();
  ok(
    elements.get("dry-run-summary").textContent.includes("calibrage réel n’est pas encore lancé"),
    "the approved state must explain that execution has not started",
  );
  elements.get("execute").dispatch("click");
  await flush();
  await flush();

  ok(calls.some((call) => call.url === "/api/v1/calibration-runs/run-1"), "execute failure must reload the run");
  ok(
    elements.get("result-preview").children.some((child) => child.textContent === "Le calibrage réel a échoué."),
    `failed report must be summarized; calls=${JSON.stringify(calls)}`,
  );
  ok(
    !elements.get("result-preview").children.some((child) => child.textContent.includes("{")),
    "the result view must not expose raw JSON",
  );
  strictEqual(elements.get("execute").disabled, true);
  terminalRecovery = true;
  elements.get("execute").disabled = false;
  elements.get("execute").dispatch("click");
  await flush();
  await flush();
  strictEqual(
    elements.get("status").textContent,
    "Calibrage réel terminé ; le profil WPM reste une publication séparée.",
    "a recovered successful run must not be shown as an execution error",
  );
  ok(
    containsText(elements.get("result-preview"), "3") &&
      containsText(elements.get("result-preview"), "Audios synthétisés"),
  );
  ok(containsText(elements.get("result-preview"), "Résultat validé."));
  invalidBootstrap = true;
  elements.get("refresh").dispatch("click");
  await flush();
  ok(elements.get("status").textContent.includes("Réponse JSON invalide"), "malformed JSON must be reported explicitly");
});

test("client restores the latest run and report after a page reload", async () => {
  const ids = [
    "status",
    "config-status",
    "corpus-items",
    "corpus-version",
    "profiles-list",
    "dry-run-state",
    "dry-run-summary",
    "result-preview",
    "refresh",
    "prepare-form",
    "approve",
    "execute",
    "publish-profile",
  ];
  const elements = new Map(ids.map((id) => [id, new FakeElement(id)]));
  const views = ["home", "corpus", "prepare", "dry-run", "result", "profiles"].map(
    (view) => new FakeElement(`view-${view}`),
  );
  const latest = {
    id: "run-restore",
    status: "succeeded",
    request: { voiceRef: "voice-restore" },
    proposal: { plan: [], raw: { requests_planned: 3 } },
  };
  const detail = {
    ...latest,
    report: { metrics: { runs_synthesized: 3 } },
  };
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? "GET", init });
    if (url === "/api/v1/bootstrap")
      return response({ sessionNonce: "nonce", config: { configured: true }, profiles: [], recentRuns: [latest] });
    if (url === "/api/v1/corpus")
      return response({ draft: { revision: 0, items: [] }, activeVersion: { revision: 42, items: [] } });
    if (url === "/api/v1/calibration-runs/run-restore") return response(detail);
    if (url === "/api/v1/voices/voice-restore") return response({ voiceRef: "voice-restore", name: "Voix restaurée" });
    throw new Error(`unexpected fetch: ${url}`);
  };
  const document = {
    getElementById(id) {
      return elements.get(id) ?? null;
    },
    querySelectorAll(selector) {
      if (selector === ".view") return views;
      return [];
    },
    createElement() {
      return new FakeElement();
    },
  };
  const context = vm.createContext({
    document,
    fetch,
    Headers: FakeHeaders,
    crypto: { randomUUID: () => "generated-id" },
    console,
    setImmediate,
  });

  vm.runInContext(CLIENT, context);
  await flush();
  await flush();

  strictEqual(views.find((view) => view.id === "view-result")?.className, "active");
  ok(
    containsText(elements.get("result-preview"), "3") &&
      containsText(elements.get("result-preview"), "Audios synthétisés"),
  );
  ok(
    containsText(elements.get("result-preview"), "Voix restaurée") &&
      containsText(elements.get("result-preview"), "Nom de la voix"),
  );
  ok(containsText(elements.get("result-preview"), "Résultat validé."));
  strictEqual(elements.get("publish-profile").disabled, false);
  strictEqual(elements.get("publish-profile").textContent, "Rendre la voix disponible dans les projets");
  strictEqual(elements.get("execute").disabled, true);
  ok(calls.some((call) => call.url === "/api/v1/calibration-runs/run-restore"));
  ok(calls.some((call) => call.url === "/api/v1/voices/voice-restore"));
});
