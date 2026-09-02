import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import type { ConfigStatus, CredentialProvider } from "./bridge.js";

const KEY_NAME = "ELEVENLABS_API_KEY";

export interface CredentialOptions {
  env?: Record<string, string | undefined>;
  cwd?: string;
  envFile?: string;
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
  if (!projectsDirectory) return ancestors.flatMap((directory) => [join(directory, ".env"), join(directory, "elevenlabs-mcp-server", ".env")]);

  const projectFiles = readdirSync(projectsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))
    .flatMap((name) => [join(projectsDirectory, name, ".env"), join(projectsDirectory, name, "elevenlabs-mcp-server", ".env")]);
  return [join(projectsDirectory, ".env"), ...projectFiles];
}

function readDiscoveredEnv(options: CredentialOptions): Record<string, string> {
  const files = options.envFile ? [resolve(options.cwd ?? process.cwd(), options.envFile)] : discoverEnvFiles(options.cwd ?? process.cwd());
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
  };
}

export { parseDotEnv };
