type JsonRecord = Record<string, unknown>;

const CALIBRATION_VOICE_SETTINGS: JsonRecord = {
  stability: 0.5,
  similarity_boost: 0.85,
  style: 0,
  use_speaker_boost: true,
};
const CALIBRATION_PARAMS: JsonRecord = {
  model_id: "eleven_multilingual_v2",
  mode: "precision",
  language: "fr",
  runs: 3,
};
const CALIBRATION_POSTPROC = "cut";

const state: {
  nonce: string | null;
  bootstrap: JsonRecord | null;
  corpus: JsonRecord | null;
  run: JsonRecord | null;
  voiceName: string | null;
  voiceNameStatus: "idle" | "loading" | "loaded" | "unavailable";
} = { nonce: null, bootstrap: null, corpus: null, run: null, voiceName: null, voiceNameStatus: "idle" };

const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

function showStatus(message: string, error = false): void {
  const target = element<HTMLElement>("status");
  target.textContent = message;
  target.className = error ? "danger" : "muted";
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function appendResultDetail(target: HTMLElement, label: string, value: unknown, suffix = ""): void {
  if (value === undefined || value === null || value === "") return;
  const name = document.createElement("dt");
  name.textContent = label;
  const detail = document.createElement("dd");
  detail.textContent = `${String(value)}${suffix}`;
  target.append(name, detail);
}

function voiceRefFromRun(run: JsonRecord | null): string | null {
  const request = run?.request;
  if (!request || typeof request !== "object" || Array.isArray(request)) return null;
  const voiceRef = (request as JsonRecord).voiceRef;
  return typeof voiceRef === "string" && voiceRef.trim() ? voiceRef.trim() : null;
}

function profilePublishedForRun(run: JsonRecord | null): boolean {
  if (!run || !state.bootstrap || !Array.isArray(state.bootstrap.profiles)) return false;
  return state.bootstrap.profiles.some(
    (profile) => profile && typeof profile === "object" && (profile as JsonRecord).sourceRunId === run.id,
  );
}

function renderResult(): void {
  const target = element<HTMLElement>("result-preview");
  target.replaceChildren();
  const run = state.run;
  const status = run ? String(run.status) : "";
  if (!run || !["succeeded", "failed", "execution_unknown"].includes(status)) {
    target.textContent = "Aucun calibrage terminé.";
    return;
  }

  const heading = document.createElement("p");
  heading.className = status === "succeeded" ? "result-status" : "danger";
  const profilePublished = profilePublishedForRun(run);
  heading.textContent =
    status === "succeeded"
      ? profilePublished
        ? "Voix prête à être utilisée dans les projets."
        : "Résultat validé."
      : status === "failed"
        ? "Le calibrage réel a échoué."
        : "Le résultat du calibrage doit être vérifié.";
  target.append(heading);

  if (status === "succeeded") {
    const nextStep = document.createElement("p");
    nextStep.className = "muted";
    nextStep.textContent = profilePublished
      ? "Le profil WPM canonique est publié pour cette voix."
      : "Le résultat est exploitable. Rendez la voix disponible dans les projets pour l’utiliser ensuite.";
    target.append(nextStep);
  }

  const report = run.report && typeof run.report === "object" ? (run.report as JsonRecord) : null;
  const metrics = report?.metrics && typeof report.metrics === "object" ? (report.metrics as JsonRecord) : {};
  const precision =
    metrics.precision_stats && typeof metrics.precision_stats === "object"
      ? (metrics.precision_stats as JsonRecord)
      : {};
  const identity = document.createElement("dl");
  const voiceRef = voiceRefFromRun(run);
  appendResultDetail(identity, "ID de voix", voiceRef);
  if (state.voiceNameStatus === "loading") {
    appendResultDetail(identity, "Nom de la voix", "Recherche en cours…");
  } else if (state.voiceNameStatus === "loaded") {
    appendResultDetail(identity, "Nom de la voix", state.voiceName);
  } else if (state.voiceNameStatus === "unavailable") {
    appendResultDetail(identity, "Nom de la voix", "Indisponible pour cet ID");
  }
  if (identity.children.length > 0) target.append(identity);

  const details = document.createElement("dl");
  appendResultDetail(details, "Audios synthétisés", metrics.runs_synthesized);
  appendResultDetail(details, "Audios en échec", metrics.runs_failed);
  appendResultDetail(details, "WPM médian", precision.median);
  appendResultDetail(details, "WPM minimum", precision.min);
  appendResultDetail(details, "WPM maximum", precision.max);
  appendResultDetail(details, "Dispersion", precision.spread_pct, "%");
  appendResultDetail(details, "Crédits utilisés", metrics.actual_credits_used);
  appendResultDetail(details, "Coût estimé", metrics.estimated_cost_usd, " USD");
  if (details.children.length > 0) {
    const technical = document.createElement("details");
    const technicalSummary = document.createElement("summary");
    technicalSummary.textContent = "Détails techniques";
    technical.append(technicalSummary, details);
    target.append(technical);
  }

  if (!report) {
    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = "Le rapport détaillé n’est pas encore disponible.";
    target.append(note);
  }
}

async function loadVoiceName(): Promise<void> {
  const run = state.run;
  const terminal = Boolean(run && ["succeeded", "failed", "execution_unknown"].includes(String(run.status)));
  const voiceRef = voiceRefFromRun(run);
  if (!terminal || !voiceRef) {
    state.voiceName = null;
    state.voiceNameStatus = "idle";
    renderResult();
    return;
  }

  state.voiceName = null;
  state.voiceNameStatus = "loading";
  renderResult();
  try {
    const result = await api(`/voices/${encodeURIComponent(voiceRef)}`);
    const body = result.body && typeof result.body === "object" ? (result.body as JsonRecord) : {};
    const name = body.name;
    state.voiceName = typeof name === "string" && name.trim() ? name.trim() : null;
    state.voiceNameStatus = state.voiceName ? "loaded" : "unavailable";
  } catch {
    state.voiceName = null;
    state.voiceNameStatus = "unavailable";
  }
  renderResult();
}

async function api(path: string, init: RequestInit = {}): Promise<{ response: Response; body: JsonRecord | unknown }> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (init.method && init.method !== "GET" && state.nonce) headers.set("X-Calibration-Nonce", state.nonce);
  const response = await fetch(`/api/v1${path}`, { ...init, headers });
  let body: JsonRecord | unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("Réponse JSON invalide du serveur local");
  }
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

function renderCorpus(): void {
  const target = element<HTMLElement>("corpus-items");
  target.replaceChildren();
  const versionTarget = element<HTMLElement>("corpus-version");
  const activeVersion = state.corpus?.activeVersion;
  if (!activeVersion || typeof activeVersion !== "object") {
    versionTarget.textContent = "Aucune version publiée n’est disponible.";
    target.textContent = "Publiez une version du corpus avant de préparer une calibration.";
    return;
  }
  const version = activeVersion as JsonRecord;
  const revision = version.revision === undefined ? "inconnue" : String(version.revision);
  const digest = version.contentDigest ? ` · empreinte ${String(version.contentDigest)}` : "";
  versionTarget.textContent = `Version publiée · révision ${revision}${digest}`;
  const rawItems = Array.isArray(version.items) ? version.items : [];
  const items = rawItems.map((raw) => (raw && typeof raw === "object" ? raw : {}) as JsonRecord);
  items.sort((left, right) => {
    const order = Number(left.order ?? 0) - Number(right.order ?? 0);
    return order || String(left.id ?? "").localeCompare(String(right.id ?? ""));
  });
  if (items.length === 0) {
    target.textContent = "La version publiée ne contient aucun texte.";
    return;
  }
  for (const [index, item] of items.entries()) {
    const row = document.createElement("div");
    row.className = "item";
    const heading = document.createElement("h3");
    heading.textContent = `Texte ${index + 1}`;
    const text = document.createElement("p");
    text.className = "corpus-text";
    text.textContent = String(item.text ?? "");
    row.dataset.id = String(item.id ?? crypto.randomUUID());
    row.dataset.order = String(item.order ?? 0);
    row.append(heading, text);
    target.append(row);
  }
}

function renderRun(): void {
  const run = state.run;
  const status = run ? String(run.status) : "";
  const stateMessage = {
    dry_run_ready: "Simulation prête à être approuvée.",
    approved: "Simulation approuvée. Le calibrage réel n’est pas encore lancé.",
    succeeded: "Calibrage réel terminé.",
    failed: "Le calibrage réel a échoué.",
    execution_unknown: "L’état du calibrage réel doit être vérifié.",
  }[status];
  element<HTMLElement>("dry-run-state").textContent = run
    ? (stateMessage ?? `État : ${status}`)
    : "Aucune simulation préparée. Retournez dans « Préparer » pour commencer.";
  const summary = element<HTMLElement>("dry-run-summary");
  if (!run) {
    summary.textContent = "";
  } else {
    const proposal = (run.proposal && typeof run.proposal === "object" ? run.proposal : {}) as JsonRecord;
    const raw = (proposal.raw && typeof proposal.raw === "object" ? proposal.raw : {}) as JsonRecord;
    const planCount = Array.isArray(proposal.plan) ? proposal.plan.length : undefined;
    const requestsPlanned = raw.requests_planned ?? planCount;
    const details = [
      requestsPlanned === undefined ? "" : `${String(requestsPlanned)} requête(s) planifiée(s)`,
      raw.billable_characters === undefined ? "" : `${String(raw.billable_characters)} caractères facturables`,
      raw.estimated_cost_usd === undefined ? "" : `coût estimé : ${String(raw.estimated_cost_usd)} USD`,
    ].filter(Boolean);
    const nextStep =
      status === "approved"
        ? "Le calibrage réel n’est pas encore lancé."
        : status === "succeeded"
          ? "Le calibrage réel est terminé. Consultez l’onglet Résultat."
          : status === "failed"
            ? "Le calibrage réel a échoué. Consultez l’onglet Résultat."
            : "Vérifiez le récapitulatif puis approuvez la simulation.";
    summary.textContent = `Simulation préparée${details.length ? ` · ${details.join(" · ")}` : ""}. ${nextStep}`;
  }
  element<HTMLButtonElement>("approve").disabled = !run || run.status !== "dry_run_ready";
  element<HTMLButtonElement>("execute").disabled = !run || run.status !== "approved";
  renderResult();
  const publishButton = element<HTMLButtonElement>("publish-profile");
  const profilePublished = profilePublishedForRun(run);
  publishButton.disabled = !run || run.status !== "succeeded" || profilePublished;
  publishButton.textContent = profilePublished
    ? "Voix déjà disponible dans les projets"
    : "Rendre la voix disponible dans les projets";
}

async function refresh(): Promise<void> {
  const hadRun = state.run !== null;
  const bootstrap = await api("/bootstrap");
  state.bootstrap = bootstrap.body as JsonRecord;
  state.nonce = state.bootstrap.sessionNonce as string;
  const recentRuns = Array.isArray(state.bootstrap.recentRuns) ? state.bootstrap.recentRuns : [];
  const latestRun =
    recentRuns.find(
      (candidate): candidate is JsonRecord =>
        Boolean(candidate) && typeof candidate === "object" && typeof (candidate as JsonRecord).id === "string",
    ) ?? null;
  state.run = latestRun;
  state.voiceName = null;
  state.voiceNameStatus = "idle";
  if (latestRun && ["succeeded", "failed", "execution_unknown"].includes(String(latestRun.status))) {
    try {
      state.run = (await api(`/calibration-runs/${latestRun.id}`)).body as JsonRecord;
    } catch {
      // Keep the summary from bootstrap when the detailed report is temporarily unavailable.
    }
  }
  const config = state.bootstrap.config as JsonRecord | undefined;
  element<HTMLElement>("config-status").textContent = config?.configured
    ? "Clé ElevenLabs configurée côté backend."
    : "Clé ElevenLabs absente côté backend.";
  const corpus = await api("/corpus");
  state.corpus = corpus.body as JsonRecord;
  renderCorpus();
  element<HTMLElement>("profiles-list").textContent = json(state.bootstrap.profiles ?? []);
  renderRun();
  if (!hadRun && state.run) {
    activateView(
      ["succeeded", "failed", "execution_unknown"].includes(String(state.run.status)) ? "result" : "dry-run",
    );
    showStatus(state.run.status === "succeeded" ? "Dernier calibrage chargé." : "Dernière simulation chargée.");
  } else {
    showStatus("Prêt.");
  }
  await loadVoiceName();
}

async function prepare(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const params: JsonRecord = {
    ...CALIBRATION_PARAMS,
    voice_settings: { ...CALIBRATION_VOICE_SETTINGS },
  };
  const result = await api("/calibration-runs/dry-run", {
    method: "POST",
    body: JSON.stringify({
      workspaceId: "local-default",
      voiceRef: (form.elements.namedItem("voiceRef") as HTMLInputElement).value,
      params,
      postproc: CALIBRATION_POSTPROC,
    }),
  });
  state.run = result.body as JsonRecord;
  state.voiceName = null;
  state.voiceNameStatus = "idle";
  renderRun();
  activateView("dry-run");
  showStatus("Simulation préparée. Aucun audio n’a été généré ; approbation explicite requise.");
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
  showStatus("Simulation approuvée. Le calibrage réel n’est pas encore lancé.");
}

async function execute(): Promise<void> {
  if (!state.run) return;
  const runId = String(state.run.id);
  try {
    state.run = (await api(`/calibration-runs/${runId}/execute`, { method: "POST", body: "{}" })).body as JsonRecord;
    if (["succeeded", "failed", "execution_unknown"].includes(String(state.run.status))) {
      try {
        state.run = (await api(`/calibration-runs/${runId}`)).body as JsonRecord;
      } catch {
        // Keep the execution response when the detailed report is temporarily unavailable.
      }
    }
    renderRun();
    activateView("result");
    await loadVoiceName();
    showStatus("Run terminé ; le profil WPM reste une publication séparée.");
  } catch (error) {
    try {
      state.run = (await api(`/calibration-runs/${runId}`)).body as JsonRecord;
      renderRun();
      activateView("result");
      await loadVoiceName();
      if (state.run.status === "succeeded") {
        showStatus("Calibrage réel terminé ; le profil WPM reste une publication séparée.");
        return;
      }
    } catch {
      // Keep the original execute error visible when the recovery read also fails.
    }
    throw error;
  }
}

async function publishProfile(): Promise<void> {
  if (!state.run) return;
  await api("/voice-profiles", { method: "POST", body: JSON.stringify({ runId: state.run.id }) });
  await refresh();
  activateView("result");
  showStatus("Voix prête à être utilisée dans les projets.");
}

function bind(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) => {
    button.addEventListener("click", () => activateView(button.dataset.view ?? "home"));
  });
  element("refresh").addEventListener(
    "click",
    () => void refresh().catch((error) => showStatus(String(error.message), true)),
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
}

bind();
void refresh().catch((error) => showStatus(String(error.message), true));
