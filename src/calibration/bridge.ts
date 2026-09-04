import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

import type { ResolvedCalibrationRequest } from "./domain.js";

export interface ConfigStatus {
  configured: boolean;
}
export interface CredentialProvider {
  status(): Promise<ConfigStatus>;
  forRun(): Promise<{ provider: string; secret: string }>;
  redact?(value: unknown): unknown;
}
export interface DryRunResult {
  accepted: boolean;
  plan: unknown[];
  raw: unknown;
  status?: string;
  runId?: string;
  workspaceId?: string;
  requestDigest?: string;
  proposal?: unknown;
  approval?: unknown;
}
export interface ExecutionResult {
  status: "succeeded" | "failed" | "unknown";
  metrics: Record<string, unknown>;
  artifacts: string[];
  raw: unknown;
  coreRun?: CoreRunRecord;
  error?: { code: string; message: string };
}
export interface CoreRunRecord {
  runId: string;
  workspaceId: string;
  revision: number;
  status: string;
  context: Record<string, unknown>;
  request: Record<string, unknown>;
  requestDigest: string;
  proposal: unknown;
  approval: {
    approvedAt: string;
    expiresAt: string;
    consumedAt: string | null;
  } | null;
  result: unknown;
  createdAt: string;
  updatedAt: string;
  raw: unknown;
}
export interface CanonicalProfilePort {
  ensurePublished(input: {
    voiceRef: string;
    wpm: number;
    runId: string;
    corpusVersionId: string;
    language?: "fr" | "en";
  }): Promise<{ canonicalRef: string }>;
}
export interface CalibrationBridge {
  getSchema(): Promise<unknown>;
  dryRun(input: { runId: string; request: ResolvedCalibrationRequest }): Promise<DryRunResult>;
  propose?(input: { workspaceId: string; request: ResolvedCalibrationRequest }): Promise<DryRunResult>;
  approve?(input: { workspaceId: string; runId: string; requestDigest: string }): Promise<CoreRunRecord>;
  getRun?(input: { workspaceId: string; runId: string }): Promise<CoreRunRecord>;
  execute(input: {
    runId: string;
    idempotencyKey: string;
    snapshot: ResolvedCalibrationRequest;
    workspaceId?: string;
    coreRunId?: string;
  }): Promise<ExecutionResult>;
  reconcile(input: {
    runId: string;
    idempotencyKey: string;
    workspaceId?: string;
    coreRunId?: string;
  }): Promise<ExecutionResult | CoreRunRecord | { status: "unknown" }>;
  close?(): Promise<void>;
}

interface TransportResponse {
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}
interface TransportCall {
  response: unknown;
  emitted: boolean;
  stderr: string;
  toolError?: boolean;
  remoteError?: { code?: number; message?: string; data?: unknown };
}
interface CalibrationTransport {
  schema(secret: string, timeoutMs: number): Promise<unknown>;
  call(args: Record<string, unknown>, secret: string, timeoutMs: number): Promise<TransportCall>;
  callTool?(name: string, args: Record<string, unknown>, secret: string, timeoutMs: number): Promise<TransportCall>;
  close(): Promise<void>;
}

class BridgeTransportError extends Error {
  constructor(
    message: string,
    readonly emitted: boolean,
    readonly stderr = "",
  ) {
    super(message);
    this.name = "BridgeTransportError";
  }
}

function redact(value: unknown, secret: string): unknown {
  if (typeof value === "string") return secret ? value.split(secret).join("[REDACTED]") : value;
  if (Array.isArray(value)) return value.map((item) => redact(item, secret));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item, secret)]));
  }
  return value;
}

function resultObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return {};
}

function unwrapToolResult(response: unknown): unknown {
  const result = resultObject(response);
  if ("structuredContent" in result) return result.structuredContent;
  const content = result.content;
  if (Array.isArray(content)) {
    const text = content.find((item) => resultObject(item).type === "text");
    if (text && typeof resultObject(text).text === "string") {
      try {
        return JSON.parse(resultObject(text).text as string);
      } catch {
        return resultObject(text).text;
      }
    }
  }
  return response;
}

function makeRequest(snapshot: ResolvedCalibrationRequest, dryRun: boolean): Record<string, unknown> {
  const params = { ...snapshot.params };
  return {
    ...params,
    voice: snapshot.voiceRef,
    corpus_key: params.corpus_key ?? snapshot.voiceRef,
    postproc: snapshot.postproc,
    dry_run: dryRun,
  };
}

function makeGateRequest(snapshot: ResolvedCalibrationRequest): Record<string, unknown> {
  return makeRequest(snapshot, false);
}

class NodeMcpStdioTransport implements CalibrationTransport {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private buffer = "";
  private stderrBuffer = "";
  private readonly pending = new Map<
    number,
    { resolve: (response: TransportResponse) => void; reject: (error: Error) => void }
  >();
  private initialized: Promise<void> | null = null;
  private secret = "";

  constructor(
    private readonly command = "voice-calibration-mcp",
    private readonly args: string[] = [],
    private readonly cwd?: string,
  ) {}

  private diagnostic(): string {
    return String(redact(this.stderrBuffer, this.secret));
  }

  private ensureChild(secret = ""): ChildProcessWithoutNullStreams {
    if (this.child) {
      if (secret && secret !== this.secret)
        throw new BridgeTransportError("credential changed; restart calibration bridge", false, this.diagnostic());
      if (secret) this.secret = secret;
      return this.child;
    }
    this.secret = secret;
    this.buffer = "";
    this.stderrBuffer = "";
    const child = spawn(this.command, this.args, {
      cwd: this.cwd,
      env: { ...process.env, ...(secret ? { ELEVENLABS_API_KEY: secret } : {}) },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.consumeStdout(chunk));
    child.stderr.on("data", (chunk: string) => {
      this.stderrBuffer += chunk;
    });
    child.on("error", (error) => this.failPending(new BridgeTransportError(error.message, false, this.diagnostic())));
    child.on("exit", (code, signal) => {
      if (this.child === child) this.child = null;
      if (this.initialized) this.initialized = null;
      this.failPending(
        new BridgeTransportError(`MCP process exited (${code ?? signal ?? "unknown"})`, true, this.diagnostic()),
      );
    });
    return child;
  }

  private consumeStdout(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let message: TransportResponse & { id?: number };
      try {
        message = JSON.parse(line) as TransportResponse & { id?: number };
      } catch {
        this.failPending(new BridgeTransportError("malformed MCP JSON-RPC response", true, this.diagnostic()));
        continue;
      }
      if (typeof message.id === "number") {
        const waiter = this.pending.get(message.id);
        if (waiter) {
          this.pending.delete(message.id);
          waiter.resolve(message);
        }
      }
    }
  }

  private failPending(error: Error): void {
    for (const waiter of this.pending.values()) waiter.reject(error);
    this.pending.clear();
  }

  private request(
    method: string,
    params: Record<string, unknown> | undefined,
    timeoutMs: number,
  ): Promise<TransportResponse> {
    const child = this.ensureChild(this.secret);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      let emitted = false;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new BridgeTransportError(`MCP request timed out: ${method}`, emitted, this.diagnostic()));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (response) => {
          clearTimeout(timer);
          resolve(response);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      try {
        emitted = true;
        child.stdin.write(
          `${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) })}\n`,
          "utf8",
          () => {
            emitted = true;
          },
        );
      } catch (error) {
        emitted = false;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new BridgeTransportError((error as Error).message, false, this.diagnostic()));
      }
    });
  }

  private async initialize(timeoutMs: number): Promise<void> {
    if (this.initialized) return this.initialized;
    this.initialized = (async () => {
      const response = await this.request(
        "initialize",
        { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "capcut-david", version: "1.0.0" } },
        timeoutMs,
      );
      if (response.error)
        throw new BridgeTransportError(response.error.message ?? "MCP initialize failed", false, this.diagnostic());
      const child = this.ensureChild(this.secret);
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`,
        "utf8",
      );
    })();
    try {
      await this.initialized;
    } catch (error) {
      this.initialized = null;
      throw error;
    }
  }

  async schema(secret: string, timeoutMs: number): Promise<unknown> {
    this.ensureChild(secret);
    await this.initialize(timeoutMs);
    const response = await this.request("tools/list", {}, timeoutMs);
    if (response.error)
      throw new BridgeTransportError(response.error.message ?? "MCP tools/list failed", false, this.diagnostic());
    const tools = resultObject(response.result).tools;
    return Array.isArray(tools)
      ? resultObject(tools.find((tool) => resultObject(tool).name === "calibrate_voice")).inputSchema
      : undefined;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    secret: string,
    timeoutMs: number,
  ): Promise<TransportCall> {
    this.ensureChild(secret);
    try {
      await this.initialize(timeoutMs);
    } catch (error) {
      if (error instanceof BridgeTransportError) {
        throw new BridgeTransportError(error.message, false, error.stderr);
      }
      throw error;
    }
    try {
      const response = await this.request("tools/call", { name, arguments: args }, timeoutMs);
      if (response.error)
        return { response: undefined, emitted: true, stderr: this.diagnostic(), remoteError: response.error };
      const toolResult = resultObject(response.result);
      return {
        response: unwrapToolResult(response.result),
        emitted: true,
        stderr: this.diagnostic(),
        toolError: toolResult.isError === true,
      };
    } catch (error) {
      if (error instanceof BridgeTransportError) throw error;
      throw new BridgeTransportError((error as Error).message, true, this.diagnostic());
    }
  }

  async call(args: Record<string, unknown>, secret: string, timeoutMs: number): Promise<TransportCall> {
    return this.callTool("calibrate_voice", args, secret, timeoutMs);
  }

  async close(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.child = null;
    this.initialized = null;
    child.stdin.end();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill();
        resolve();
      }, 2_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

function parseCoreRun(value: unknown): CoreRunRecord {
  const raw = resultObject(value);
  const approval = raw.approval;
  const approvalObject = approval && typeof approval === "object" ? resultObject(approval) : null;
  if (
    typeof raw.run_id !== "string" ||
    typeof raw.workspace_id !== "string" ||
    typeof raw.revision !== "number" ||
    typeof raw.status !== "string" ||
    typeof raw.request_digest !== "string" ||
    typeof raw.created_at !== "string" ||
    typeof raw.updated_at !== "string"
  ) {
    throw new Error("invalid calibration core run response");
  }
  return {
    runId: raw.run_id,
    workspaceId: raw.workspace_id,
    revision: raw.revision,
    status: raw.status,
    context: resultObject(raw.context),
    request: resultObject(raw.request),
    requestDigest: raw.request_digest,
    proposal: raw.proposal ?? null,
    approval:
      approvalObject && typeof approvalObject.approved_at === "string" && typeof approvalObject.expires_at === "string"
        ? {
            approvedAt: approvalObject.approved_at,
            expiresAt: approvalObject.expires_at,
            consumedAt: typeof approvalObject.consumed_at === "string" ? approvalObject.consumed_at : null,
          }
        : null,
    result: raw.result ?? null,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    raw: value,
  };
}

function coreExecutionResult(run: CoreRunRecord): ExecutionResult {
  const raw = resultObject(run.result);
  if (run.status === "execution_unknown") {
    return {
      status: "unknown",
      metrics: {},
      artifacts: [],
      raw: run.result,
      coreRun: run,
      error: { code: "execution_unknown", message: "execution outcome is unknown" },
    };
  }
  if (run.status === "succeeded") {
    const metrics = Object.fromEntries(
      Object.entries(raw).filter(([key]) => !["status", "error", "reason", "details"].includes(key)),
    );
    return {
      status: "succeeded",
      metrics,
      artifacts: Array.isArray(raw.artifacts) ? [...raw.artifacts] : [],
      raw: run.result,
      coreRun: run,
    };
  }
  if (run.status === "failed") {
    return {
      status: "failed",
      metrics: {},
      artifacts: [],
      raw: run.result,
      coreRun: run,
      error: {
        code: String(raw.reason ?? raw.status ?? "calibration_failed"),
        message: String(raw.details ?? raw.error ?? "calibration failed"),
      },
    };
  }
  throw new Error(`calibration core returned non-terminal state: ${run.status}`);
}

export function createCalibrationBridge(options: {
  transport?: CalibrationTransport;
  credentials: CredentialProvider;
  timeoutMs?: number;
}): CalibrationBridge {
  const transport = options.transport ?? new NodeMcpStdioTransport();
  const timeoutMs = options.timeoutMs ?? 120_000;
  const invokeTool = async (
    name: string,
    args: Record<string, unknown>,
  ): Promise<TransportCall & { secret: string }> => {
    let credential: { provider: string; secret: string };
    try {
      credential = await options.credentials.forRun();
    } catch {
      throw new Error("calibration credentials unavailable");
    }
    if (credential.provider !== "elevenlabs")
      throw new Error(`unsupported credential provider: ${credential.provider}`);
    try {
      const response = transport.callTool
        ? await transport.callTool(name, args, credential.secret, timeoutMs)
        : name === "calibrate_voice"
          ? await transport.call(args, credential.secret, timeoutMs)
          : (() => {
              throw new Error("calibration transport does not support named MCP tools");
            })();
      if (response.toolError) {
        const safeResponse = redact(response.response, credential.secret);
        throw new Error(typeof safeResponse === "string" ? safeResponse : "MCP tool call failed");
      }
      return { ...response, secret: credential.secret };
    } catch (error) {
      if (error instanceof BridgeTransportError) {
        throw new BridgeTransportError(
          String(redact(error.message, credential.secret)),
          error.emitted,
          String(redact(error.stderr, credential.secret)),
        );
      }
      throw new Error(String(redact((error as Error).message, credential.secret)));
    }
  };
  const call = async (
    request: ResolvedCalibrationRequest,
    dryRun: boolean,
  ): Promise<TransportCall & { secret: string }> => {
    return invokeTool("calibrate_voice", makeRequest(request, dryRun));
  };

  return {
    async getSchema() {
      let credential: { provider: string; secret: string };
      try {
        credential = await options.credentials.forRun();
      } catch {
        throw new Error("calibration credentials unavailable");
      }
      if (credential.provider !== "elevenlabs")
        throw new Error(`unsupported credential provider: ${credential.provider}`);
      try {
        return await transport.schema(credential.secret, Math.min(timeoutMs, 10_000));
      } catch (error) {
        if (error instanceof BridgeTransportError) throw new Error(String(redact(error.message, credential.secret)));
        throw new Error(String(redact((error as Error).message, credential.secret)));
      }
    },
    async dryRun(input) {
      try {
        const result = await call(input.request, true);
        if (result.remoteError)
          throw new Error(String(redact(result.remoteError.message ?? "MCP tools/call failed", result.secret)));
        const safeResponse = redact(result.response, result.secret);
        const raw = resultObject(safeResponse);
        return {
          accepted: raw.status === "dry_run_success" || raw.accepted === true,
          plan: Array.isArray(raw.plan) ? raw.plan : [],
          raw: safeResponse,
          status: typeof raw.status === "string" ? raw.status : undefined,
        };
      } catch (error) {
        const message = error instanceof BridgeTransportError ? error.message : (error as Error).message;
        throw new Error(message);
      }
    },
    async propose(input) {
      const result = await invokeTool("propose_calibration", {
        workspace_id: input.workspaceId,
        ...makeGateRequest(input.request),
        corpus_version_id: input.request.corpusVersionId,
        corpus_digest: input.request.corpusDigest,
        contract_digest: input.request.contractDigest,
        core_digest: input.request.coreDigest,
      });
      if (result.remoteError) {
        const safeError = redact(result.remoteError, result.secret) as Record<string, unknown>;
        throw new Error(String(safeError.message ?? "MCP tools/call failed"));
      }
      const safeResponse = redact(result.response, result.secret);
      const coreRun = parseCoreRun(safeResponse);
      const proposal = resultObject(coreRun.proposal);
      return {
        accepted: coreRun.status === "dry_run_ready",
        plan: Array.isArray(proposal.plan) ? proposal.plan : [],
        raw: safeResponse,
        status: coreRun.status,
        runId: coreRun.runId,
        workspaceId: coreRun.workspaceId,
        requestDigest: coreRun.requestDigest,
        proposal: coreRun.proposal,
        approval: coreRun.approval,
      };
    },
    async approve(input) {
      const result = await invokeTool("approve_calibration", {
        workspace_id: input.workspaceId,
        run_id: input.runId,
        request_digest: input.requestDigest,
      });
      if (result.remoteError) {
        const safeError = redact(result.remoteError, result.secret) as Record<string, unknown>;
        throw new Error(String(safeError.message ?? "MCP tools/call failed"));
      }
      return parseCoreRun(redact(result.response, result.secret));
    },
    async getRun(input) {
      const result = await invokeTool("get_calibration_run", {
        workspace_id: input.workspaceId,
        run_id: input.runId,
      });
      if (result.remoteError) {
        const safeError = redact(result.remoteError, result.secret) as Record<string, unknown>;
        throw new Error(String(safeError.message ?? "MCP tools/call failed"));
      }
      return parseCoreRun(redact(result.response, result.secret));
    },
    async execute(input) {
      if (input.workspaceId && input.coreRunId) {
        const result = await invokeTool("execute_calibration", {
          workspace_id: input.workspaceId,
          run_id: input.coreRunId,
        });
        if (result.remoteError) {
          const safeError = redact(result.remoteError, result.secret) as Record<string, unknown>;
          throw new Error(String(safeError.message ?? "MCP tools/call failed"));
        }
        return coreExecutionResult(parseCoreRun(redact(result.response, result.secret)));
      }
      try {
        const result = await invokeTool("calibrate_voice", makeRequest(input.snapshot, false));
        if (result.remoteError) {
          const safeError = redact(result.remoteError, result.secret) as Record<string, unknown>;
          return {
            status: "failed",
            metrics: {},
            artifacts: [],
            raw: safeError,
            error: {
              code: String(safeError.code ?? "mcp_error"),
              message: String(safeError.message ?? "MCP tools/call failed"),
            },
          };
        }
        const safeResponse = redact(result.response, result.secret);
        const raw = resultObject(safeResponse);
        if (raw.status === "ok") {
          const metrics = Object.fromEntries(
            Object.entries(raw).filter(([key]) => !["status", "error", "reason", "details"].includes(key)),
          );
          return { status: "succeeded", metrics, artifacts: [], raw: safeResponse };
        }
        return {
          status: "failed",
          metrics: {},
          artifacts: [],
          raw: safeResponse,
          error: {
            code: String(raw.reason ?? raw.status ?? "calibration_failed"),
            message: String(raw.details ?? raw.error ?? "calibration failed"),
          },
        };
      } catch (error) {
        if (error instanceof BridgeTransportError && error.emitted) throw new Error("execution_unknown");
        throw new Error(error instanceof BridgeTransportError ? error.message : (error as Error).message);
      }
    },
    async reconcile(input) {
      if (input.workspaceId && input.coreRunId) {
        const result = await invokeTool("reconcile_calibration", {
          workspace_id: input.workspaceId,
          run_id: input.coreRunId,
        });
        if (result.remoteError) {
          const safeError = redact(result.remoteError, result.secret) as Record<string, unknown>;
          throw new Error(String(safeError.message ?? "MCP tools/call failed"));
        }
        return parseCoreRun(redact(result.response, result.secret));
      }
      return { status: "unknown" };
    },
    close: () => transport.close(),
  };
}

export function createCanonicalProfilePort(
  options: {
    verify?: (input: {
      voiceRef: string;
      wpm: number;
      runId: string;
      corpusVersionId: string;
      language?: "fr" | "en";
    }) => Promise<{ canonicalRef: string; wpm: number }>;
    wpmPath?: string;
    language?: "fr" | "en";
  } = {},
): CanonicalProfilePort {
  return {
    async ensurePublished(input) {
      const result = options.verify
        ? await options.verify(input)
        : await verifyWpmFile(input, options.wpmPath, options.language ?? "fr");
      if (Math.abs(result.wpm - input.wpm) > 0.001) throw new Error("canonical_wpm_mismatch");
      return { canonicalRef: result.canonicalRef };
    },
  };
}

async function verifyWpmFile(
  input: { voiceRef: string; wpm: number; language?: "fr" | "en" },
  wpmPath = process.env.VOICE_WPM_PATH,
  language: "fr" | "en",
): Promise<{ canonicalRef: string; wpm: number }> {
  if (!wpmPath) throw new Error("canonical_wpm_unavailable");
  language = input.language ?? language;
  const data = JSON.parse(await readFile(wpmPath, "utf8")) as Record<string, Record<string, unknown>>;
  const record = data[input.voiceRef];
  const key = language === "en" ? "wpm_calibrated_by_lang" : "wpm_calibrated";
  const wpm = language === "en" ? resultObject(record?.[key]).en : record?.[key];
  if (typeof wpm !== "number") throw new Error("canonical_wpm_unavailable");
  const suffix = language === "en" ? "wpm_calibrated_by_lang.en" : "wpm_calibrated";
  return { canonicalRef: `Shared/voice-calibration/voice_wpm.json#${input.voiceRef}.${suffix}`, wpm };
}

export { BridgeTransportError, NodeMcpStdioTransport };
