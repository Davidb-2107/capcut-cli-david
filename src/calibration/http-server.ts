import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";

import {
  type CalibrationApplication,
  ContractValidationError,
  NotFoundError,
  UnavailableError,
} from "./application.js";
import { ConflictError } from "./ports.js";
import { redactSensitive } from "./redaction.js";

const DEFAULT_WORKSPACE = "local-default";
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const CALIBRATION_HTML = fileURLToPath(new URL("../ui/calibration.html", import.meta.url));
const CALIBRATION_CLIENT = fileURLToPath(new URL("../ui/calibration-client.js", import.meta.url));

export interface CalibrationHttpServerOptions {
  application: CalibrationApplication;
  workspaceId?: string;
  host?: string;
  port?: number;
  allowNetwork?: boolean;
}

export interface CalibrationUiHandle {
  server: Server;
  url: string;
  close(): Promise<void>;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function errorPayload(error: unknown): { code: string; message: string } {
  if (error instanceof HttpError) return { code: error.code, message: error.message };
  if (error instanceof NotFoundError) return { code: "not_found", message: error.message };
  if (error instanceof ContractValidationError) return { code: error.code, message: error.message };
  if (error instanceof UnavailableError) return { code: error.code, message: error.message };
  if (error instanceof ConflictError) return { code: "conflict", message: error.message };
  if (error instanceof Error && /revision conflict/i.test(error.message))
    return { code: "if_match_failed", message: error.message };
  return { code: "internal_error", message: "unexpected local failure" };
}

function executionHttpError(report: { error: { code: string; message: string } | null } | null): HttpError | null {
  if (!report?.error) return null;
  const { code, message } = report.error;
  if (
    [
      "invalid_request",
      "unsupported_input_feature",
      "profile_mismatch",
      "domain_error",
      "contract_validation",
    ].includes(code)
  ) {
    return new HttpError(422, code, message);
  }
  if (
    ["quota_exceeded", "unavailable", "credentials_unavailable", "provider_unavailable"].includes(code) ||
    /not configured|credential|provider unavailable|core unavailable/i.test(message)
  ) {
    return new HttpError(503, code, message);
  }
  return null;
}

function statusForError(error: unknown): number {
  if (error instanceof HttpError) return error.status;
  if (error instanceof NotFoundError) return 404;
  if (error instanceof ContractValidationError) return 422;
  if (error instanceof UnavailableError) return 503;
  if (error instanceof Error && /revision conflict/i.test(error.message)) return 412;
  if (error instanceof ConflictError) return 409;
  const message = error instanceof Error ? error.message : String(error);
  if (
    /revision conflict|approval|required|expired|digest|state|execution_unknown|reconcile|already consumed/i.test(
      message,
    )
  )
    return 409;
  if (/invalid_request|validation|unsupported_input_feature|profile_mismatch|domain_error/i.test(message)) return 422;
  if (
    /not configured|credential|canonical_wpm_unavailable|mcp process|provider unavailable|core unavailable/i.test(
      message,
    )
  )
    return 503;
  return 500;
}

function sendJson(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const bytes = Buffer.from(JSON.stringify(redactSensitive(body)), "utf8");
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": String(bytes.byteLength),
    ...headers,
  });
  response.end(bytes);
}

async function parseBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.byteLength;
    if (length > MAX_BODY_BYTES) throw new HttpError(400, "malformed_json", "request body is too large");
    chunks.push(bytes);
  }
  if (length === 0) return {};
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "malformed_json", "malformed JSON");
  }
  if (!isRecord(value)) throw new HttpError(400, "malformed_json", "JSON body must be an object");
  return value;
}

function workspace(url: URL, options: CalibrationHttpServerOptions): string {
  return url.searchParams.get("workspaceId") ?? options.workspaceId ?? DEFAULT_WORKSPACE;
}

function requireNonce(request: IncomingMessage, application: CalibrationApplication): void {
  if (stringHeader(request.headers["x-calibration-nonce"]) !== application.getSessionNonce()) {
    throw new HttpError(409, "nonce_required", "calibration session nonce required");
  }
}

function parseRevision(value: string | undefined): number {
  if (!value) throw new HttpError(412, "if_match_required", "If-Match is required");
  const match = /^W\/"corpus-draft-(\d+)"$/.exec(value) ?? /^"?(\d+)"?$/.exec(value);
  if (!match) throw new HttpError(412, "if_match_failed", "If-Match does not match the current draft");
  return Number(match[1]);
}

function idFromPath(pathname: string, action = true): string {
  const encoded = pathname.split("/").at(action ? -2 : -1);
  if (!encoded) throw new HttpError(404, "not_found", "route not found");
  try {
    const id = decodeURIComponent(encoded);
    if (!id || id.includes("/") || id.includes("\\") || id === "." || id === "..") throw new Error();
    return id;
  } catch {
    throw new HttpError(404, "not_found", "route not found");
  }
}

async function dispatch(
  request: IncomingMessage,
  response: ServerResponse,
  options: CalibrationHttpServerOptions,
): Promise<void> {
  const configuredHost = options.host ?? "127.0.0.1";
  const localPort = request.socket.localPort ?? options.port ?? 0;
  const expectedOrigin = `http://${urlHost(configuredHost)}:${localPort}`;
  const host = stringHeader(request.headers.host);
  const origin = stringHeader(request.headers.origin);
  if (origin && origin !== expectedOrigin) {
    sendJson(response, 403, { error: { code: "cross_origin", message: "cross-origin requests are not allowed" } });
    return;
  }

  const url = new URL(request.url ?? "/", `http://${host ?? "localhost"}`);
  const method = request.method ?? "GET";
  const application = options.application;
  const workspaceId = workspace(url, options);

  try {
    if (method === "GET" && url.pathname === "/api/v1/bootstrap") {
      sendJson(response, 200, await application.getBootstrap(workspaceId));
      return;
    }
    if (method === "GET" && url.pathname === "/api/v1/corpus") {
      const corpus = await application.getCorpus(workspaceId);
      sendJson(response, 200, corpus, { etag: `W/"corpus-draft-${corpus.draft.revision}"` });
      return;
    }
    if (method === "GET" && url.pathname === "/api/v1/corpus/draft") {
      const result = await application.getDraft(workspaceId);
      sendJson(response, 200, result.draft, { etag: result.etag });
      return;
    }
    if (method === "PUT" && url.pathname === "/api/v1/corpus/draft") {
      requireNonce(request, application);
      const expectedRevision = parseRevision(stringHeader(request.headers["if-match"]));
      const body = await parseBody(request);
      const draft = isRecord(body.draft) ? body.draft : body;
      const saved = await application.saveDraft(workspaceId, draft as never, expectedRevision);
      sendJson(response, 200, saved, { etag: `W/"corpus-draft-${saved.revision}"` });
      return;
    }
    if (method === "POST" && url.pathname === "/api/v1/corpus/versions") {
      requireNonce(request, application);
      const body = await parseBody(request);
      const ifMatch = stringHeader(request.headers["if-match"]);
      const expectedRevision = ifMatch ? parseRevision(ifMatch) : body.expectedRevision;
      if (typeof expectedRevision !== "number" || !Number.isInteger(expectedRevision) || expectedRevision < 0) {
        throw new HttpError(400, "expected_revision_required", "expectedRevision is required");
      }
      const version = await application.publishCorpusVersion(workspaceId, expectedRevision);
      sendJson(response, 201, version);
      return;
    }
    if (method === "GET" && url.pathname === "/api/v1/calibration/schema") {
      sendJson(response, 200, await application.getCalibrationSchema());
      return;
    }
    const voiceMatch = /^\/api\/v1\/voices\/([^/]+)$/.exec(url.pathname);
    if (method === "GET" && voiceMatch) {
      let voiceRef: string;
      try {
        voiceRef = decodeURIComponent(voiceMatch[1]);
      } catch {
        throw new HttpError(422, "invalid_voice_id", "invalid ElevenLabs voice ID");
      }
      sendJson(response, 200, await application.getVoiceName(voiceRef));
      return;
    }
    if (method === "POST" && url.pathname === "/api/v1/calibration-runs/dry-run") {
      requireNonce(request, application);
      const body = await parseBody(request);
      const input = isRecord(body.input) ? body.input : body;
      const run = await application.prepareDryRun(input as never);
      sendJson(response, 201, run);
      return;
    }

    const approveMatch = /^\/api\/v1\/calibration-runs\/[^/]+\/approve$/.test(url.pathname);
    if (method === "POST" && approveMatch) {
      requireNonce(request, application);
      const body = await parseBody(request);
      if (typeof body.requestDigest !== "string")
        throw new HttpError(400, "request_digest_required", "requestDigest is required");
      sendJson(
        response,
        200,
        await application.approve(idFromPath(url.pathname), { requestDigest: body.requestDigest }),
      );
      return;
    }
    const executeMatch = /^\/api\/v1\/calibration-runs\/[^/]+\/execute$/.test(url.pathname);
    if (method === "POST" && executeMatch) {
      requireNonce(request, application);
      const runId = idFromPath(url.pathname);
      const run = await application.execute(runId);
      const failure = run.status === "failed" ? executionHttpError(await application.getReport(runId)) : null;
      if (failure) throw failure;
      sendJson(response, 200, run);
      return;
    }
    const reconcileMatch = /^\/api\/v1\/calibration-runs\/[^/]+\/reconcile$/.test(url.pathname);
    if (method === "POST" && reconcileMatch) {
      requireNonce(request, application);
      sendJson(response, 200, await application.reconcile(idFromPath(url.pathname)));
      return;
    }
    const runMatch = /^\/api\/v1\/calibration-runs\/[^/]+$/.test(url.pathname);
    if (method === "GET" && runMatch) {
      const runId = idFromPath(url.pathname, false);
      const run = await application.getRun(runId);
      if (!run) throw new NotFoundError("calibration run not found");
      sendJson(response, 200, { ...run, report: await application.getReport(runId) });
      return;
    }
    if (method === "GET" && url.pathname === "/api/v1/voice-profiles") {
      sendJson(response, 200, await application.listVoiceProfiles(workspaceId));
      return;
    }
    if (method === "POST" && url.pathname === "/api/v1/voice-profiles") {
      requireNonce(request, application);
      const body = await parseBody(request);
      const runId = typeof body.runId === "string" ? body.runId : body.sourceRunId;
      if (typeof runId !== "string" || !runId) throw new HttpError(400, "run_id_required", "runId is required");
      sendJson(response, 201, await application.publishProfile(runId));
      return;
    }

    if (url.pathname === "/" || url.pathname === "/calibration.html") {
      let html: Buffer;
      try {
        html = await readFile(CALIBRATION_HTML);
      } catch {
        html = Buffer.from("<!doctype html><html><body><main id=app>Calibration UI</main></body></html>", "utf8");
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      response.end(html);
      return;
    }
    if (url.pathname === "/calibration-client.js") {
      try {
        const client = await readFile(CALIBRATION_CLIENT);
        response.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
        response.end(client);
      } catch {
        throw new HttpError(404, "not_found", "static path not found");
      }
      return;
    }
    throw new HttpError(404, "not_found", "route not found");
  } catch (error) {
    const status = statusForError(error);
    sendJson(response, status, { error: errorPayload(error) });
  }
}

export function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

export function createCalibrationServer(options: CalibrationHttpServerOptions): Server {
  return createServer((request, response) => {
    void dispatch(request, response, options);
  });
}

export const createCalibrationHttpServer = createCalibrationServer;

function urlHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

export async function startCalibrationUi(options: CalibrationHttpServerOptions): Promise<CalibrationUiHandle> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  if (!isLoopbackHost(host) && !options.allowNetwork) {
    throw new Error(
      "non-loopback host requires --allow-network; this exposes an unauthenticated local credential consumer",
    );
  }
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error("port must be an integer from 0 to 65535");
  const server = createCalibrationServer({ ...options, host, port });
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("error", onError);
      reject(error);
    };
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("unable to determine calibration UI address");
  }
  const url = `http://${urlHost(host)}:${address.port}`;
  return {
    server,
    url,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await options.application.close();
    },
  };
}
