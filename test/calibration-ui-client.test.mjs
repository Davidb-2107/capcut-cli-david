import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { strictEqual, ok } from "node:assert";
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

test("client resynchronizes the run after execute returns an HTTP failure", async () => {
  const ids = [
    "status",
    "config-status",
    "schema-fields",
    "postproc",
    "corpus-items",
    "profiles-list",
    "dry-run-state",
    "request-preview",
    "result-preview",
    "refresh",
    "add-item",
    "save-corpus",
    "prepare-form",
    "approve",
    "execute",
    "publish-profile",
    "publish-corpus",
  ];
  const elements = new Map(ids.map((id) => [id, new FakeElement(id)]));
  const views = ["home", "corpus", "prepare", "dry-run", "result", "profiles"].map(
    (view) => new FakeElement(`view-${view}`),
  );
  const form = elements.get("prepare-form");
  const formFields = {
    voiceRef: Object.assign(new FakeElement("voiceRef"), { value: "voice-1" }),
    postproc: Object.assign(new FakeElement("postproc"), { value: "cut" }),
  };
  form.elements = { namedItem: (name) => formFields[name] ?? null };
  const calls = [];
  let invalidBootstrap = false;
  const run = {
    id: "run-1",
    status: "dry_run_ready",
    requestDigest: "digest-1",
    request: { params: { postproc: "cut" } },
    approval: null,
  };
  const approved = { ...run, status: "approved", approval: { approvedAt: "now" } };
  const failed = {
    ...approved,
    status: "failed",
    report: { error: { code: "provider_unavailable", message: "Provider unavailable" } },
  };
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? "GET", init });
    if (url === "/api/v1/bootstrap") {
      return invalidBootstrap
        ? invalidJsonResponse()
        : response({ sessionNonce: "nonce", config: { configured: true }, profiles: [] });
    }
    if (url === "/api/v1/corpus") {
      return response(
        { draft: { revision: 0, items: [{ id: "item-1", order: 0, text: "Bonjour." }] } },
        200,
        { etag: 'W/"server-draft-42"' },
      );
    }
    if (url === "/api/v1/calibration/schema")
      return response({ properties: { postproc: { enum: ["schema-cut", "schema-trim"] } } });
    if (url === "/api/v1/corpus/draft") return response({ revision: 42, items: [] }, 200, { etag: 'W/"server-draft-43"' });
    if (url === "/api/v1/calibration-runs/dry-run") return response(run, 201);
    if (url === "/api/v1/calibration-runs/run-1/approve") return response(approved);
    if (url === "/api/v1/calibration-runs/run-1/execute") {
      return response({ error: { code: "provider_unavailable", message: "Provider unavailable" } }, 503);
    }
    if (url === "/api/v1/calibration-runs/run-1") return response(failed);
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
  strictEqual(corpusRow.children[0].getAttribute("aria-label"), "Ordre", "corpus order input must have an accessible name");
  strictEqual(corpusRow.children[1].getAttribute("aria-label"), "Texte", "corpus text input must have an accessible name");
  strictEqual(
    elements.get("postproc").children.map((option) => option.textContent).join(","),
    "schema-cut,schema-trim",
    "postproc options must come from the calibration schema",
  );
  elements.get("save-corpus").dispatch("click");
  await flush();
  const saveCall = calls.find((call) => call.url === "/api/v1/corpus/draft" && call.method === "PUT");
  strictEqual(saveCall?.init.headers.get("if-match"), 'W/"server-draft-42"');
  form.dispatch("submit", { currentTarget: form });
  await flush();
  elements.get("approve").dispatch("click");
  await flush();
  elements.get("execute").dispatch("click");
  await flush();
  await flush();

  ok(calls.some((call) => call.url === "/api/v1/calibration-runs/run-1"), "execute failure must reload the run");
  ok(
    elements.get("result-preview").textContent.includes("provider_unavailable"),
    `failed report must be rendered; calls=${JSON.stringify(calls)} preview=${elements.get("result-preview").textContent}`,
  );
  strictEqual(elements.get("execute").disabled, true);
  invalidBootstrap = true;
  elements.get("refresh").dispatch("click");
  await flush();
  ok(elements.get("status").textContent.includes("Réponse JSON invalide"), "malformed JSON must be reported explicitly");
});
