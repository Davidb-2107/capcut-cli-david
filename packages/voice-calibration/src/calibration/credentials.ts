import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import type { ConfigStatus, CredentialProvider } from "./bridge.js";
import type { VoiceDirectoryPort } from "./ports.js";
import { redactSensitive } from "./redaction.js";

const KEY_NAME = "ELEVENLABS_API_KEY";

export interface CredentialOptions {
  env?: Record<string, string | undefined>;
  cwd?: string;
  envFile?: string;
}

export interface VoiceDirectoryOptions {
  credentials: CredentialProvider;
  fetcher?: typeof fetch;
  baseUrl?: string;
}

function parseDotEnv(source: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of source.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function ancestorDirectories(start: string): string[] {
  const result: string[] = [];
  let current = resolve(start);
  while (true) {
    result.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return result;
}

function discoverEnvFiles(cwd: string): string[] {
  const ancestors = ancestorDirectories(cwd);
  const projectsDirectory = ancestors.find((directory) => basename(directory) === "Projects");
  const vaultRoot = ancestors.find(
    (directory) => existsSync(join(directory, "Projects")) && existsSync(join(directory, "Shared")),
  );
  const resolvedProjectsDirectory = projectsDirectory ?? (vaultRoot ? join(vaultRoot, "Projects") : undefined);
  if (!resolvedProjectsDirectory)
    return ancestors.flatMap((directory) => [
      join(directory, ".env"),
      join(directory, "elevenlabs-mcp-server", ".env"),
    ]);

  const projectFiles = readdirSync(resolvedProjectsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))
    .flatMap((name) => [
      join(resolvedProjectsDirectory, name, ".env"),
      join(resolvedProjectsDirectory, name, "elevenlabs-mcp-server", ".env"),
    ]);
  return [join(resolvedProjectsDirectory, ".env"), ...projectFiles];
}

function readDiscoveredEnv(options: CredentialOptions): Record<string, string> {
  const files = options.envFile
    ? [resolve(options.cwd ?? process.cwd(), options.envFile)]
    : discoverEnvFiles(options.cwd ?? process.cwd());
  const result: Record<string, string> = {};
  for (const file of files) {
    if (!existsSync(file)) continue;
    for (const [key, value] of Object.entries(parseDotEnv(readFileSync(file, "utf8")))) {
      if (!(key in result)) result[key] = value;
    }
  }
  return result;
}

export function createCredentialProvider(options: CredentialOptions = {}): CredentialProvider {
  const supplied = options.env ?? process.env;
  const discovered = options.env && !options.envFile ? {} : readDiscoveredEnv(options);
  const value = () => {
    if (options.envFile) return discovered[KEY_NAME] || supplied[KEY_NAME];
    return supplied[KEY_NAME] || discovered[KEY_NAME];
  };

  const status = async (): Promise<ConfigStatus> => ({ configured: Boolean(value()) });
  return {
    status,
    async forRun() {
      const secret = value();
      if (!secret) throw new Error("ElevenLabs API key is not configured");
      return { provider: "elevenlabs", secret };
    },
    redact(input: unknown) {
      const secret = value();
      return redactSensitive(input, secret ? [secret] : []);
    },
  };
}

export function createVoiceDirectoryProvider(options: VoiceDirectoryOptions): VoiceDirectoryPort {
  const fetcher = options.fetcher ?? globalThis.fetch;
  if (!fetcher) throw new Error("fetch is not available for ElevenLabs voice lookup");
  const baseUrl = (options.baseUrl ?? "https://api.elevenlabs.io/v1").replace(/\/$/u, "");
  return {
    async getName(voiceRef) {
      const credential = await options.credentials.forRun();
      const response = await fetcher(`${baseUrl}/voices/${encodeURIComponent(voiceRef)}`, {
        headers: {
          accept: "application/json",
          "xi-api-key": credential.secret,
        },
      });
      if (!response.ok) throw new Error(`ElevenLabs voice lookup failed (${response.status})`);
      const body = (await response.json()) as unknown;
      if (!body || typeof body !== "object" || Array.isArray(body)) return null;
      const name = (body as Record<string, unknown>).name;
      return typeof name === "string" && name.trim() ? name.trim() : null;
    },
  };
}

export { parseDotEnv };
