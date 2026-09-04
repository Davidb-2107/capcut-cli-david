import { randomUUID } from "node:crypto";

import type {
  CalibrationBridge,
  CanonicalProfilePort,
  CoreRunRecord,
  CredentialProvider,
  DryRunResult,
  ExecutionResult,
} from "./bridge.js";
import type {
  CalibrationReport,
  CalibrationRun,
  CorpusDraft,
  CorpusItem,
  CorpusVersion,
  ResolvedCalibrationRequest,
  VoiceProfile,
} from "./domain.js";
import { transitionRun } from "./domain.js";
import { fingerprintRequest } from "./fingerprint.js";
import type { LocalStore } from "./ports.js";
import { ConflictError } from "./ports.js";
import { redactSensitive } from "./redaction.js";

export interface Clock {
  now(): Date;
}

export interface CalibrationInput {
  workspaceId: string;
  voiceRef: string;
  params: Record<string, unknown>;
  postproc: unknown;
}

export interface BootstrapView {
  sessionNonce: string;
  config: { configured: boolean };
  activeCorpus: CorpusVersion | null;
  profiles: VoiceProfile[];
  recentRuns: CalibrationRun[];
}

export interface CorpusView {
  draft: CorpusDraft;
  activeVersion: CorpusVersion | null;
  versions: CorpusVersion[];
}

export interface CalibrationApplicationOptions {
  repositories: LocalStore;
  bridge: CalibrationBridge;
  canonical: CanonicalProfilePort;
  credentials?: CredentialProvider;
  clock?: Clock;
  contractDigest?: string;
  coreDigest?: string;
}

export class ContractValidationError extends Error {
  readonly code = "contract_validation";
  constructor(message: string) {
    super(message);
    this.name = "ContractValidationError";
  }
}

export class UnavailableError extends Error {
  readonly code = "unavailable";
  constructor(message: string) {
    super(message);
    this.name = "UnavailableError";
  }
}

export class NotFoundError extends Error {
  readonly code = "not_found";
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export const systemClock: Clock = {
  now: () => new Date(),
};

const DEFAULT_WORKSPACE = "local-default";
const APPROVAL_TTL_MS = 15 * 60 * 1000;
const REPORT_NAME = "report.json";
const INVENTORY_SOURCE_REVISION = "2eedac32fd3f4275e58ca8510d0d49be0b589f96";
const sessionNonces = new WeakMap<object, string>();
const runLocks = new WeakMap<object, Map<string, Promise<unknown>>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function nowIso(clock: Clock): string {
  return clock.now().toISOString();
}

function isUnavailableMessage(message: string): boolean {
  return /not configured|credential|canonical_wpm_unavailable|mcp process|provider unavailable|core unavailable/i.test(
    message,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type ErrorRedactor = (value: unknown) => unknown;

function safeError(
  error: unknown,
  redact: ErrorRedactor = (value) => redactSensitive(value),
): { code: string; message: string } {
  const candidate = isRecord(error) ? error : {};
  const message = String(redact(candidate.message ?? errorMessage(error)));
  const code =
    typeof candidate.code === "string"
      ? candidate.code
      : error instanceof Error && "code" in error && typeof error.code === "string"
        ? error.code
        : "calibration_failed";
  return { code, message };
}

function applySchemaDefaults(value: Record<string, unknown>, schema: unknown): Record<string, unknown> {
  const result: Record<string, unknown> = { ...value };
  if (!isRecord(schema)) return result;
  const properties = schema.properties;
  if (!isRecord(properties)) return result;
  for (const [key, propertySchema] of Object.entries(properties)) {
    if (result[key] === undefined && isRecord(propertySchema) && propertySchema.default !== undefined) {
      result[key] = clone(propertySchema.default);
    }
    if (isRecord(result[key]) && isRecord(propertySchema)) {
      result[key] = applySchemaDefaults(result[key] as Record<string, unknown>, propertySchema);
    }
  }
  return result;
}

function schemaDigest(schema: unknown): string {
  try {
    return fingerprintRequest({
      contractDigest: "schema",
      coreDigest: "schema",
      corpusVersionId: "schema",
      corpusDigest: "schema",
      voiceRef: "schema",
      params: { schema },
      postproc: "schema",
    });
  } catch {
    return "schema-unavailable";
  }
}

function explicitDigest(schema: unknown, key: "contractDigest" | "coreDigest"): string | undefined {
  if (!isRecord(schema)) return undefined;
  const value = schema[key] ?? schema[`x-${key}`];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function corpusText(items: readonly CorpusItem[]): string {
  return [...items]
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .map((item) => item.text)
    .join("\n\n");
}

function recentRunSort(left: CalibrationRun, right: CalibrationRun): number {
  return right.updatedAt.localeCompare(left.updatedAt) || right.createdAt.localeCompare(left.createdAt);
}

function wpmFromReport(report: CalibrationReport): number | null {
  const provider = isRecord(report.providerResult) ? report.providerResult : {};
  const metric = isRecord(report.metrics) ? report.metrics : {};
  const precisionStats = [metric.precision_stats, provider.precision_stats].find((value) => isRecord(value));
  const candidates: unknown[] = [
    isRecord(precisionStats) ? precisionStats.median : undefined,
    metric.wpm,
    metric.wpm_calibrated,
    provider.wpm,
    provider.wpm_calibrated,
  ];
  const wpm = candidates.find(
    (value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0,
  );
  return wpm ?? null;
}

function isExecutionUnknown(error: unknown): boolean {
  return /execution_unknown/i.test(errorMessage(error));
}

function executionEvent(result: ExecutionResult): "succeeded" | "failed" | "execution_unknown" {
  if (result.status === "unknown") return "execution_unknown";
  return result.status === "succeeded" ? "succeeded" : "failed";
}

function isCoreBackedRun(run: CalibrationRun): boolean {
  return /^v\d+:sha256:/u.test(run.requestDigest);
}

function isCoreRunRecord(value: unknown): value is CoreRunRecord {
  return isRecord(value) && typeof value.runId === "string" && typeof value.requestDigest === "string";
}

function coreRequestToResolved(core: CoreRunRecord, fallback?: ResolvedCalibrationRequest): ResolvedCalibrationRequest {
  const providerRequest = core.request;
  const params = {
    ...(fallback?.params ?? {}),
    ...Object.fromEntries(
      Object.entries(providerRequest).filter(([key]) => !["voice", "postproc", "dry_run"].includes(key)),
    ),
  };
  const context = core.context;
  const contextString = (key: string, fallbackValue: string): string =>
    typeof context[key] === "string" ? (context[key] as string) : fallbackValue;
  return {
    contractDigest: contextString("contract_digest", fallback?.contractDigest ?? "contract-unavailable"),
    coreDigest: contextString("core_digest", fallback?.coreDigest ?? "core-unavailable"),
    corpusVersionId: contextString("corpus_version_id", fallback?.corpusVersionId ?? "corpus-unavailable"),
    corpusDigest: contextString("corpus_digest", fallback?.corpusDigest ?? "corpus-unavailable"),
    voiceRef: typeof providerRequest.voice === "string" ? providerRequest.voice : (fallback?.voiceRef ?? ""),
    params,
    postproc: providerRequest.postproc ?? fallback?.postproc,
  };
}

function projectCoreRun(core: CoreRunRecord, previous?: CalibrationRun): CalibrationRun {
  const proposalObject = isRecord(core.proposal) ? core.proposal : {};
  const proposal = {
    accepted: true as const,
    plan: Array.isArray(proposalObject.plan) ? clone(proposalObject.plan) : [],
    raw: clone(core.proposal),
  };
  return {
    id: core.runId,
    workspaceId: core.workspaceId,
    status: core.status as CalibrationRun["status"],
    idempotencyKey: core.runId,
    request: coreRequestToResolved(core, previous?.request),
    requestDigest: core.requestDigest,
    proposal,
    approval: core.approval ? clone(core.approval) : null,
    reportId: previous?.reportId ?? null,
    createdAt: core.createdAt,
    updatedAt: core.updatedAt,
  };
}

function normalizeCoreWorkflowError(error: unknown): Error {
  const message = errorMessage(error);
  if (/not found/i.test(message)) return new NotFoundError(message);
  if (/revision|approval|required|expired|digest|state|execution_unknown|reconcile|consumed/i.test(message))
    return new ConflictError(message);
  return error instanceof Error ? error : new Error(message);
}

export class CalibrationApplication {
  private readonly repositories: LocalStore;
  private readonly bridge: CalibrationBridge;
  private readonly canonical: CanonicalProfilePort;
  private readonly credentials?: CredentialProvider;
  private readonly clock: Clock;
  private readonly contractDigestOverride?: string;
  private readonly coreDigestOverride?: string;
  private readonly recoveryPromises = new Map<string, Promise<void>>();
  private readonly sessionNonce: string;

  constructor(options: CalibrationApplicationOptions) {
    this.repositories = options.repositories;
    this.bridge = options.bridge;
    this.canonical = options.canonical;
    this.credentials = options.credentials;
    this.clock = options.clock ?? systemClock;
    this.contractDigestOverride = options.contractDigest;
    this.coreDigestOverride = options.coreDigest;
    if (typeof options.repositories.runs.list !== "function") {
      throw new TypeError("runs.list is required for persistent calibration state");
    }
    if (typeof options.repositories.runs.recoverRunning !== "function") {
      throw new TypeError("runs.recoverRunning is required for persistent calibration state");
    }
    const key = this.repositories as unknown as object;
    const existingNonce = sessionNonces.get(key);
    this.sessionNonce = existingNonce ?? randomUUID();
    sessionNonces.set(key, this.sessionNonce);
  }

  private async withRunLock<T>(runId: string, work: () => Promise<T>): Promise<T> {
    const key = this.repositories as unknown as object;
    let locks = runLocks.get(key);
    if (!locks) {
      locks = new Map();
      runLocks.set(key, locks);
    }
    const previous = locks.get(runId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(work);
    locks.set(runId, next);
    try {
      return await next;
    } finally {
      if (locks.get(runId) === next) locks.delete(runId);
    }
  }

  private async assertConfigured(): Promise<void> {
    if (!this.credentials) return;
    const status = await this.credentials.status();
    if (!status.configured) throw new UnavailableError("ElevenLabs API key is not configured");
  }

  private async ensureRecovered(workspaceId: string): Promise<void> {
    const existing = this.recoveryPromises.get(workspaceId);
    if (existing) return existing;
    const recovery = this.recoverOrphanedRuns(workspaceId);
    this.recoveryPromises.set(workspaceId, recovery);
    return recovery;
  }

  private async recoverOrphanedRuns(workspaceId: string): Promise<void> {
    const runs = await this.repositories.runs.list(workspaceId);
    const recoveredAt = nowIso(this.clock);
    await Promise.all(
      runs
        .filter((run) => run.status === "running")
        .map((run) => this.repositories.runs.recoverRunning(run.id, recoveredAt)),
    );
  }

  private redactError(error: unknown): { code: string; message: string } {
    const redact = this.credentials?.redact;
    return safeError(error, redact ? (value) => redact(value) : undefined);
  }

  private async currentDigests(schema?: unknown): Promise<{ contractDigest: string; coreDigest: string }> {
    const currentSchema = schema ?? (await this.bridge.getSchema());
    const digest = schemaDigest(currentSchema);
    return {
      contractDigest: this.contractDigestOverride ?? explicitDigest(currentSchema, "contractDigest") ?? digest,
      coreDigest:
        this.coreDigestOverride ??
        explicitDigest(currentSchema, "coreDigest") ??
        process.env.VOICE_CALIBRATION_CORE_DIGEST ??
        `voice-calibration-core:${INVENTORY_SOURCE_REVISION}`,
    };
  }

  private async getRunOrThrow(runId: string): Promise<CalibrationRun> {
    const run = await this.getRun(runId);
    if (!run) throw new NotFoundError(`calibration run not found: ${runId}`);
    return run;
  }

  private async persistReport(
    run: CalibrationRun,
    result: Partial<ExecutionResult> & { error?: { code: string; message: string } },
  ): Promise<string> {
    const report: CalibrationReport = {
      id: `report-${run.id}`,
      runId: run.id,
      request: clone(run.request),
      requestDigest: run.requestDigest,
      metrics: isRecord(result.metrics) ? clone(result.metrics) : {},
      artifacts: Array.isArray(result.artifacts) ? [...result.artifacts] : [],
      providerResult: result.raw === undefined ? null : clone(result.raw),
      error: result.error ? this.redactError(result.error) : null,
      createdAt: nowIso(this.clock),
    };
    const bytes = Buffer.from(`${JSON.stringify(report)}\n`, "utf8");
    return this.repositories.artifacts.put(run.id, REPORT_NAME, bytes);
  }

  private async loadReport(run: CalibrationRun): Promise<CalibrationReport> {
    if (!run.reportId) throw new ConflictError("calibration report is not available");
    const bytes = await this.repositories.artifacts.get(run.reportId);
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as CalibrationReport;
  }

  getSessionNonce(): string {
    return this.sessionNonce;
  }

  async getBootstrap(workspaceId = DEFAULT_WORKSPACE): Promise<BootstrapView> {
    await this.ensureRecovered(workspaceId);
    const [config, activeCorpus, profiles, recentRuns] = await Promise.all([
      this.credentials ? this.credentials.status() : Promise.resolve({ configured: true }),
      this.repositories.corpus.getActiveVersion(workspaceId),
      this.repositories.profiles.list(workspaceId),
      this.repositories.runs.list(workspaceId),
    ]);
    return {
      sessionNonce: this.sessionNonce,
      config: { configured: config.configured },
      activeCorpus,
      profiles,
      recentRuns: recentRuns.sort(recentRunSort).slice(0, 20),
    };
  }

  async getCorpus(workspaceId = DEFAULT_WORKSPACE): Promise<CorpusView> {
    const [draft, activeVersion, versions] = await Promise.all([
      this.repositories.corpus.getDraft(workspaceId),
      this.repositories.corpus.getActiveVersion(workspaceId),
      this.repositories.corpus.listVersions(workspaceId),
    ]);
    return { draft, activeVersion, versions };
  }

  async getDraft(workspaceId = DEFAULT_WORKSPACE): Promise<{ draft: CorpusDraft; etag: string }> {
    const draft = await this.repositories.corpus.getDraft(workspaceId);
    return { draft, etag: `W/"corpus-draft-${draft.revision}"` };
  }

  async saveDraft(workspaceId: string, draft: CorpusDraft, expectedRevision: number): Promise<CorpusDraft> {
    if (draft.workspaceId !== workspaceId) throw new ContractValidationError("draft workspace mismatch");
    return this.repositories.corpus.saveDraft(workspaceId, clone(draft), expectedRevision);
  }

  async publishCorpusVersion(workspaceId: string, expectedRevision: number): Promise<CorpusVersion> {
    return this.repositories.corpus.publishDraft(workspaceId, expectedRevision);
  }

  async getCalibrationSchema(): Promise<unknown> {
    return this.bridge.getSchema();
  }

  async prepareDryRun(input: CalibrationInput): Promise<CalibrationRun> {
    await this.ensureRecovered(input.workspaceId);
    await this.assertConfigured();
    const activeCorpus = await this.repositories.corpus.getActiveVersion(input.workspaceId);
    if (!activeCorpus) throw new ConflictError("active published corpus is required");
    const schema = await this.bridge.getSchema();
    const defaults = isRecord(schema) && isRecord(schema.properties) ? schema : undefined;
    const params = applySchemaDefaults(input.params, defaults);
    params.text_source = { kind: "inline", text: corpusText(activeCorpus.items) };
    params.corpus_key = params.corpus_key ?? input.voiceRef;
    params.dry_run = false;
    if (input.postproc === undefined || input.postproc === null)
      throw new ContractValidationError("postproc is required");
    const postproc = input.postproc;
    if (params.postproc !== undefined) delete params.postproc;
    const digests = await this.currentDigests(schema);
    const request: ResolvedCalibrationRequest = {
      ...digests,
      corpusVersionId: activeCorpus.id,
      corpusDigest: activeCorpus.contentDigest,
      voiceRef: input.voiceRef,
      params,
      postproc,
    };
    let requestDigest = fingerprintRequest(request);
    let id: string = randomUUID();
    let dryRun: DryRunResult;
    try {
      dryRun = this.bridge.propose
        ? await this.bridge.propose({ workspaceId: input.workspaceId, request: clone(request) })
        : await this.bridge.dryRun({ runId: id, request: clone(request) });
      if (!dryRun.accepted) throw new ContractValidationError("calibration dry-run was not accepted");
      if (dryRun.runId) id = dryRun.runId;
      if (dryRun.requestDigest) requestDigest = dryRun.requestDigest;
    } catch (error) {
      if (error instanceof ContractValidationError || error instanceof UnavailableError) throw error;
      const message = errorMessage(error);
      if (isUnavailableMessage(message)) throw new UnavailableError(message);
      throw new ContractValidationError(message);
    }
    const timestamp = nowIso(this.clock);
    const run: CalibrationRun = {
      id,
      workspaceId: input.workspaceId,
      status: "draft",
      idempotencyKey: id,
      request,
      requestDigest,
      proposal: {
        accepted: true,
        plan: clone(dryRun.plan),
        raw: clone(dryRun.proposal ?? dryRun.raw),
      },
      approval: null,
      reportId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const ready = transitionRun(run, { type: "dry_run_succeeded" });
    ready.updatedAt = timestamp;
    await this.repositories.runs.create(ready);
    return ready;
  }

  async approve(runId: string, input: { requestDigest: string }): Promise<CalibrationRun> {
    return this.withRunLock(runId, async () => {
      const run = await this.getRunOrThrow(runId);
      if (isCoreBackedRun(run) && this.bridge.approve) {
        let core: CoreRunRecord;
        try {
          core = await this.bridge.approve({
            workspaceId: run.workspaceId,
            runId: run.id,
            requestDigest: input.requestDigest,
          });
        } catch (error) {
          throw normalizeCoreWorkflowError(error);
        }
        const approved = projectCoreRun(core, run);
        await this.repositories.runs.save(approved);
        return approved;
      }
      if (run.status !== "dry_run_ready")
        throw new ConflictError(`approval requires dry_run_ready state, got ${run.status}`);
      if (input.requestDigest !== run.requestDigest) throw new ConflictError("request digest mismatch");
      const expiresAt = new Date(this.clock.now().getTime() + APPROVAL_TTL_MS).toISOString();
      const approved = transitionRun(run, { type: "approve", expiresAt });
      if (approved.approval) approved.approval.approvedAt = nowIso(this.clock);
      approved.updatedAt = nowIso(this.clock);
      await this.repositories.runs.save(approved);
      return approved;
    });
  }

  async execute(runId: string): Promise<CalibrationRun> {
    return this.withRunLock(runId, async () => {
      const run = await this.getRunOrThrow(runId);
      if (isCoreBackedRun(run) && this.bridge.execute) {
        let result: ExecutionResult;
        try {
          result = await this.bridge.execute({
            runId: run.id,
            idempotencyKey: run.idempotencyKey,
            snapshot: clone(run.request),
            workspaceId: run.workspaceId,
            coreRunId: run.id,
          });
        } catch (error) {
          if (!isExecutionUnknown(error)) throw normalizeCoreWorkflowError(error);
          let recovered: CoreRunRecord | null = null;
          if (this.bridge.getRun) {
            try {
              recovered = await this.bridge.getRun({ workspaceId: run.workspaceId, runId: run.id });
            } catch {
              recovered = null;
            }
          }
          result = {
            status: "unknown",
            metrics: {},
            artifacts: [],
            raw: null,
            coreRun: recovered ?? undefined,
            error: { code: "execution_unknown", message: "execution outcome is unknown" },
          };
        }
        const authoritative = result.coreRun;
        const projected = authoritative
          ? projectCoreRun(authoritative, run)
          : {
              ...run,
              status: executionEvent(result),
              approval: run.approval
                ? { ...run.approval, consumedAt: run.approval.consumedAt ?? nowIso(this.clock) }
                : run.approval,
              updatedAt: nowIso(this.clock),
            };
        const reportId = await this.persistReport(projected, result);
        projected.reportId = reportId;
        projected.updatedAt = nowIso(this.clock);
        await this.repositories.runs.save(projected);
        return projected;
      }
      if (run.status === "execution_unknown")
        throw new ConflictError("execution_unknown cannot be retried; retry is forbidden; reconcile required");
      if (run.status !== "approved") throw new ConflictError(`approval required; got ${run.status}`);
      if (!run.approval || run.approval.consumedAt) throw new ConflictError("approval already consumed");
      if (this.clock.now().getTime() >= Date.parse(run.approval.expiresAt)) throw new ConflictError("approval expired");
      const digests = await this.currentDigests();
      if (run.request.contractDigest !== digests.contractDigest || run.request.coreDigest !== digests.coreDigest) {
        throw new ConflictError("approval invalidated by contract or core change");
      }
      if (fingerprintRequest(run.request) !== run.requestDigest)
        throw new ConflictError("approved snapshot digest mismatch");

      const consumedAt = nowIso(this.clock);
      const running = this.repositories.runs.consumeApproval
        ? await this.repositories.runs.consumeApproval(run.id, consumedAt)
        : (() => {
            const fallback = transitionRun(run, { type: "execute" });
            if (fallback.approval) fallback.approval.consumedAt = consumedAt;
            fallback.updatedAt = consumedAt;
            return fallback;
          })();
      if (!this.repositories.runs.consumeApproval) await this.repositories.runs.save(running);

      let result: ExecutionResult;
      try {
        result = await this.bridge.execute({
          runId: running.id,
          idempotencyKey: running.idempotencyKey,
          snapshot: clone(running.request),
        });
      } catch (error) {
        const failure = this.redactError(error);
        result = isExecutionUnknown(error)
          ? {
              status: "unknown",
              metrics: {},
              artifacts: [],
              raw: null,
              error: { code: "execution_unknown", message: failure.message },
            }
          : { status: "failed", metrics: {}, artifacts: [], raw: null, error: failure };
      }
      const reportId = await this.persistReport(running, result);
      const terminal = transitionRun(running, { type: executionEvent(result) });
      terminal.reportId = reportId;
      terminal.updatedAt = nowIso(this.clock);
      await this.repositories.runs.save(terminal);
      return terminal;
    });
  }

  async reconcile(runId: string): Promise<CalibrationRun> {
    return this.withRunLock(runId, async () => {
      const run = await this.getRunOrThrow(runId);
      if (isCoreBackedRun(run) && this.bridge.reconcile) {
        let reconciled: ExecutionResult | CoreRunRecord | { status: "unknown" };
        try {
          reconciled = await this.bridge.reconcile({
            runId: run.id,
            idempotencyKey: run.idempotencyKey,
            workspaceId: run.workspaceId,
            coreRunId: run.id,
          });
        } catch (error) {
          throw normalizeCoreWorkflowError(error);
        }
        if (isCoreRunRecord(reconciled)) {
          const projected = projectCoreRun(reconciled, run);
          await this.repositories.runs.save(projected);
          return projected;
        }
      }
      if (run.status !== "execution_unknown") throw new ConflictError("reconcile requires execution_unknown state");
      const result = await this.bridge.reconcile({ runId: run.id, idempotencyKey: run.idempotencyKey });
      if (result.status !== "unknown")
        throw new ConflictError("reconciliation cannot safely change execution_unknown without provider confirmation");
      return run;
    });
  }

  async getRun(runId: string): Promise<CalibrationRun | null> {
    await this.ensureRecovered(DEFAULT_WORKSPACE);
    const local = await this.repositories.runs.get(runId);
    if (!local || !isCoreBackedRun(local) || !this.bridge.getRun) return local;
    let core: CoreRunRecord;
    try {
      core = await this.bridge.getRun({ workspaceId: local.workspaceId, runId: local.id });
    } catch (error) {
      const normalized = normalizeCoreWorkflowError(error);
      if (normalized instanceof NotFoundError) return null;
      throw normalized;
    }
    const projected = projectCoreRun(core, local);
    await this.repositories.runs.save(projected);
    return projected;
  }

  async getReport(runId: string): Promise<CalibrationReport | null> {
    const run = await this.getRun(runId);
    if (!run?.reportId) return null;
    return this.loadReport(run);
  }

  async publishProfile(runId: string): Promise<VoiceProfile> {
    const run = await this.getRunOrThrow(runId);
    if (run.status !== "succeeded") throw new ConflictError("profile publication requires a successful run");
    if (run.request.postproc !== "cut")
      throw new ContractValidationError('profile publication requires postproc="cut" for the canonical WPM source');
    const report = await this.loadReport(run);
    const wpm = wpmFromReport(report);
    if (wpm === null) throw new ContractValidationError("successful calibration result has no WPM");
    let canonical: { canonicalRef: string };
    try {
      canonical = await this.canonical.ensurePublished({
        voiceRef: run.request.voiceRef,
        wpm,
        runId: run.id,
        corpusVersionId: run.request.corpusVersionId,
        language: run.request.params.language === "en" ? "en" : "fr",
      });
    } catch (error) {
      const message = errorMessage(error);
      if (isUnavailableMessage(message)) throw new UnavailableError(message);
      throw new ContractValidationError(message);
    }
    const profile: VoiceProfile = {
      id: randomUUID(),
      workspaceId: run.workspaceId,
      voiceRef: run.request.voiceRef,
      wpmSnapshot: wpm,
      wpmAuthority: "python-voice-wpm",
      canonicalRef: canonical.canonicalRef,
      sourceRunId: run.id,
      corpusVersionId: run.request.corpusVersionId,
      reportId: run.reportId as string,
      publishedAt: nowIso(this.clock),
    };
    await this.repositories.profiles.publish(profile);
    return profile;
  }

  async listVoiceProfiles(workspaceId = DEFAULT_WORKSPACE): Promise<VoiceProfile[]> {
    return this.repositories.profiles.list(workspaceId);
  }

  async close(): Promise<void> {
    await this.bridge.close?.();
  }
}

export function createCalibrationApplication(options: CalibrationApplicationOptions): CalibrationApplication {
  return new CalibrationApplication(options);
}
