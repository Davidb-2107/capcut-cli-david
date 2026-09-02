type JsonRecord = Record<string, unknown>;

const state: {
  nonce: string | null;
  bootstrap: JsonRecord | null;
  schema: JsonRecord | null;
  corpus: JsonRecord | null;
  etag: string | null;
  run: JsonRecord | null;
} = { nonce: null, bootstrap: null, schema: null, corpus: null, etag: null, run: null };

const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

function showStatus(message: string, error = false): void {
  const target = element<HTMLElement>("status");
  target.textContent = message;
  target.className = error ? "danger" : "muted";
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

async function api(path: string, init: RequestInit = {}): Promise<{ response: Response; body: JsonRecord | unknown }> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (init.method && init.method !== "GET" && state.nonce) headers.set("X-Calibration-Nonce", state.nonce);
  const response = await fetch(`/api/v1${path}`, { ...init, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      (body as JsonRecord)?.error && typeof (body as JsonRecord).error === "object"
        ? ((body as JsonRecord).error as JsonRecord).message
        : `HTTP ${response.status}`;
    throw new Error(String(message));
  }
  return { response, body };
}

function activateView(view: string): void {
  document.querySelectorAll<HTMLElement>(".view").forEach((item) => {
    item.classList.toggle("active", item.id === `view-${view}`);
  });
}

function valueFromField(field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): unknown {
  if (field.dataset.kind === "object" || field.dataset.kind === "array") {
    try {
      return JSON.parse(field.value);
    } catch {
      throw new Error(`${field.name} doit contenir du JSON valide`);
    }
  }
  if (field.dataset.kind === "number") return field.value === "" ? undefined : Number(field.value);
  if (field.dataset.kind === "boolean") return (field as HTMLInputElement).checked;
  return field.value;
}

function renderSchema(): void {
  const target = element<HTMLElement>("schema-fields");
  target.replaceChildren();
  const properties = state.schema?.properties;
  if (!properties || typeof properties !== "object") {
    target.textContent = "Schéma indisponible.";
    return;
  }
  const required = Array.isArray(state.schema?.required) ? state.schema.required : [];
  for (const [name, rawSchema] of Object.entries(properties as JsonRecord)) {
    if (name === "postproc" || name === "text_source") continue;
    const schema = (rawSchema && typeof rawSchema === "object" ? rawSchema : {}) as JsonRecord;
    const label = document.createElement("label");
    label.textContent = `${name}${required.includes(name) ? " *" : ""}`;
    let field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    const enumValues = Array.isArray(schema.enum) ? schema.enum : [];
    if (enumValues.length > 0) {
      field = document.createElement("select");
      for (const option of enumValues) {
        const item = document.createElement("option");
        item.value = String(option);
        item.textContent = String(option);
        field.append(item);
      }
    } else if (schema.type === "object" || schema.type === "array") {
      field = document.createElement("textarea");
      field.dataset.kind = schema.type;
      field.value = schema.default === undefined ? "{}" : json(schema.default);
    } else {
      field = document.createElement("input");
      field.type = schema.type === "number" || schema.type === "integer" ? "number" : "text";
      field.dataset.kind =
        schema.type === "number" || schema.type === "integer"
          ? "number"
          : schema.type === "boolean"
            ? "boolean"
            : "string";
      if (schema.default !== undefined) field.value = String(schema.default);
      if (field.dataset.kind === "boolean") {
        field.type = "checkbox";
        field.checked = schema.default === true;
      }
    }
    field.name = name;
    field.dataset.param = name;
    label.append(field);
    target.append(label);
  }
}

function renderCorpus(): void {
  const target = element<HTMLElement>("corpus-items");
  target.replaceChildren();
  const draft = (state.corpus?.draft ?? {}) as JsonRecord;
  const items = Array.isArray(draft.items) ? draft.items : [];
  for (const raw of items) {
    const item = (raw && typeof raw === "object" ? raw : {}) as JsonRecord;
    const row = document.createElement("div");
    row.className = "item";
    const order = document.createElement("input");
    order.type = "number";
    order.value = String(item.order ?? 0);
    order.dataset.field = "order";
    const text = document.createElement("textarea");
    text.value = String(item.text ?? "");
    text.dataset.field = "text";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Supprimer";
    remove.addEventListener("click", () => row.remove());
    row.dataset.id = String(item.id ?? crypto.randomUUID());
    row.append(order, text, remove);
    target.append(row);
  }
}

function draftFromUi(): JsonRecord {
  const items = [...document.querySelectorAll<HTMLElement>("#corpus-items .item")].map((row) => ({
    id: row.dataset.id,
    order: Number((row.querySelector('[data-field="order"]') as HTMLInputElement).value),
    text: (row.querySelector('[data-field="text"]') as HTMLTextAreaElement).value,
  }));
  const draft = (state.corpus?.draft ?? {}) as JsonRecord;
  return { ...draft, items };
}

function addCorpusItem(): void {
  const draft = (state.corpus?.draft ?? { workspaceId: "local-default", revision: 0 }) as JsonRecord;
  const items = Array.isArray(draft.items) ? draft.items : [];
  state.corpus = {
    ...(state.corpus ?? {}),
    draft: { ...draft, items: [...items, { id: crypto.randomUUID(), order: items.length, text: "" }] },
  };
  renderCorpus();
}

function renderRun(): void {
  const run = state.run;
  element<HTMLElement>("dry-run-state").textContent = run
    ? `État : ${String(run.status)} — empreinte : ${String(run.requestDigest ?? "")}`
    : "Aucun dry-run préparé.";
  element<HTMLElement>("request-preview").textContent = run
    ? json({ request: run.request, requestDigest: run.requestDigest, approval: run.approval })
    : "";
  element<HTMLButtonElement>("approve").disabled = !run || run.status !== "dry_run_ready";
  element<HTMLButtonElement>("execute").disabled = !run || run.status !== "approved";
  const report = run && "report" in run ? run.report : null;
  element<HTMLElement>("result-preview").textContent = report
    ? json(report)
    : run && ["succeeded", "failed", "execution_unknown"].includes(String(run.status))
      ? json(run)
      : "";
  element<HTMLButtonElement>("publish-profile").disabled = !run || run.status !== "succeeded";
}

async function refresh(): Promise<void> {
  const bootstrap = await api("/bootstrap");
  state.bootstrap = bootstrap.body as JsonRecord;
  state.nonce = state.bootstrap.sessionNonce as string;
  const config = state.bootstrap.config as JsonRecord | undefined;
  element<HTMLElement>("config-status").textContent = config?.configured
    ? "Clé ElevenLabs configurée côté backend."
    : "Clé ElevenLabs absente côté backend.";
  const corpus = await api("/corpus");
  state.corpus = corpus.body as JsonRecord;
  state.etag = `W/"corpus-draft-${(state.corpus.draft as JsonRecord).revision}"`;
  renderCorpus();
  const schema = await api("/calibration/schema");
  state.schema = schema.body as JsonRecord;
  renderSchema();
  element<HTMLElement>("profiles-list").textContent = json(state.bootstrap.profiles ?? []);
  showStatus("Prêt.");
}

async function saveCorpus(): Promise<void> {
  if (!state.etag) throw new Error("ETag absent");
  const result = await api("/corpus/draft", {
    method: "PUT",
    headers: { "If-Match": state.etag },
    body: JSON.stringify(draftFromUi()),
  });
  state.etag = result.response.headers.get("etag");
  state.corpus = { ...(state.corpus ?? {}), draft: result.body };
  showStatus("Corpus enregistré.");
}

async function prepare(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const params: JsonRecord = {};
  for (const field of form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    "[data-param]",
  )) {
    const value = valueFromField(field);
    if (value !== undefined) params[field.name] = value;
  }
  const result = await api("/calibration-runs/dry-run", {
    method: "POST",
    body: JSON.stringify({
      workspaceId: "local-default",
      voiceRef: (form.elements.namedItem("voiceRef") as HTMLInputElement).value,
      params,
      postproc: (form.elements.namedItem("postproc") as HTMLSelectElement).value,
    }),
  });
  state.run = result.body as JsonRecord;
  renderRun();
  activateView("dry-run");
  showStatus("Dry-run accepté. Approbation explicite requise.");
}

async function approve(): Promise<void> {
  if (!state.run) return;
  state.run = (
    await api(`/calibration-runs/${state.run.id}/approve`, {
      method: "POST",
      body: JSON.stringify({ requestDigest: state.run.requestDigest }),
    })
  ).body as JsonRecord;
  renderRun();
  showStatus("Approbation enregistrée.");
}

async function execute(): Promise<void> {
  if (!state.run) return;
  state.run = (await api(`/calibration-runs/${state.run.id}/execute`, { method: "POST", body: "{}" }))
    .body as JsonRecord;
  renderRun();
  activateView("result");
  showStatus("Run terminé ; le profil WPM reste une publication séparée.");
}

async function publishProfile(): Promise<void> {
  if (!state.run) return;
  await api("/voice-profiles", { method: "POST", body: JSON.stringify({ runId: state.run.id }) });
  await refresh();
  activateView("profiles");
  showStatus("Profil publié après vérification de la source Python.");
}

function bind(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) => {
    button.addEventListener("click", () => activateView(button.dataset.view ?? "home"));
  });
  element("refresh").addEventListener(
    "click",
    () => void refresh().catch((error) => showStatus(String(error.message), true)),
  );
  element("add-item").addEventListener("click", addCorpusItem);
  element("save-corpus").addEventListener(
    "click",
    () => void saveCorpus().catch((error) => showStatus(String(error.message), true)),
  );
  element("prepare-form").addEventListener(
    "submit",
    (event) => void prepare(event).catch((error) => showStatus(String(error.message), true)),
  );
  element("approve").addEventListener(
    "click",
    () => void approve().catch((error) => showStatus(String(error.message), true)),
  );
  element("execute").addEventListener(
    "click",
    () => void execute().catch((error) => showStatus(String(error.message), true)),
  );
  element("publish-profile").addEventListener(
    "click",
    () => void publishProfile().catch((error) => showStatus(String(error.message), true)),
  );
  element("publish-corpus").addEventListener(
    "click",
    () =>
      void (async () => {
        const revision = (state.corpus?.draft as JsonRecord)?.revision;
        await api("/corpus/versions", { method: "POST", body: JSON.stringify({ expectedRevision: revision }) });
        await refresh();
        showStatus("Version du corpus publiée.");
      })().catch((error) => showStatus(String(error.message), true)),
  );
}

bind();
void refresh().catch((error) => showStatus(String(error.message), true));
