import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

import type { ResolvedCalibrationRequest } from "./domain.js";

export interface ConfigStatus {
  configured: boolean;
}
export interface CredentialProvider {
  status(): Promise<ConfigStatus>;
  forRun(): Promise<{ provider: string; secret: string }>;
}
export interface DryRunResult {
  accepted: boolean;
  plan: unknown[];
  raw: unknown;
}
export interface ExecutionResult {
  status: "succeeded" | "failed" | "unknown";
  metrics: Record<string, unknown>;
  artifacts: string[];
  raw: unknown;
  error?: { code: string; message: string };
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
  execute(input: {
    runId: string;
    idempotencyKey: string;
    snapshot: ResolvedCalibrationRequest;
  }): Promise<ExecutionResult>;
  reconcile(input: { runId: string; idempotencyKey: string }): Promise<ExecutionResult | { status: "unknown" }>;
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
  remoteError?: { code?: number; message?: string; data?: unknown };
}
interface CalibrationTransport {
  schema(secret: string, timeoutMs: number): Promise<unknown>;
  call(args: Record<string, unknown>, secret: string, timeoutMs: number): Promise<TransportCall>;
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

  async call(args: Record<string, unknown>, secret: string, timeoutMs: number): Promise<TransportCall> {
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
      const response = await this.request("tools/call", { name: "calibrate_voice", arguments: args }, timeoutMs);
      if (response.error)
        return { response: undefined, emitted: true, stderr: this.diagnostic(), remoteError: response.error };
      return { response: unwrapToolResult(response.result), emitted: true, stderr: this.diagnostic() };
    } catch (error) {
      if (error instanceof BridgeTransportError) throw error;
      throw new BridgeTransportError((error as Error).message, true, this.diagnostic());
    }
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

export function createCalibrationBridge(options: {
  transport?: CalibrationTransport;
  credentials: CredentialProvider;
  timeoutMs?: number;
}): CalibrationBridge {
  const transport = options.transport ?? new NodeMcpStdioTransport();
  const timeoutMs = options.timeoutMs ?? 120_000;
  const call = async (
    request: ResolvedCalibrationRequest,
    dryRun: boolean,
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
      return {
        ...(await transport.call(makeRequest(request, dryRun), credential.secret, timeoutMs)),
        secret: credential.secret,
      };
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
        };
      } catch (error) {
        const message = error instanceof BridgeTransportError ? error.message : (error as Error).message;
        throw new Error(message);
      }
    },
    async execute(input) {
      let credential: { provider: string; secret: string };
      try {
        credential = await options.credentials.forRun();
      } catch {
        throw new Error("calibration credentials unavailable");
      }
      if (credential.provider !== "elevenlabs")
        throw new Error(`unsupported credential provider: ${credential.provider}`);
      try {
        const result = await transport.call(makeRequest(input.snapshot, false), credential.secret, timeoutMs);
        if (result.remoteError) {
          const safeError = redact(result.remoteError, credential.secret) as Record<string, unknown>;
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
        const safeResponse = redact(result.response, credential.secret);
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
        if (error instanceof BridgeTransportError) throw new Error(String(redact(error.message, credential.secret)));
        throw new Error(String(redact((error as Error).message, credential.secret)));
      }
    },
    // The source contract has no run/idempotency field and no reconciliation
    // operation. Local run identifiers remain application metadata only.
    async reconcile() {
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
