import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { createCalibrationApplication } from "./application.js";
import { createCalibrationBridge, createCanonicalProfilePort } from "./bridge.js";
import { createCredentialProvider, createVoiceDirectoryProvider } from "./credentials.js";
import { type CalibrationUiHandle, startCalibrationUi } from "./http-server.js";
import { createLocalStore } from "./ports.js";

export interface CalibrationUiOptions {
  dataDir?: string;
  host?: string;
  port?: number;
  allowNetwork?: boolean;
}

export async function startVoiceCalibrationUi(options: CalibrationUiOptions = {}): Promise<CalibrationUiHandle> {
  const credentials = createCredentialProvider();
  const vault = findVaultRoot(process.cwd());
  const wpmPath =
    process.env.VOICE_WPM_PATH ?? (vault ? join(vault, "Shared", "voice-calibration", "voice_wpm.json") : undefined);
  const language = process.env.VOICE_CALIBRATION_LANGUAGE === "en" ? "en" : "fr";
  const application = createCalibrationApplication({
    repositories: createLocalStore(options.dataDir),
    bridge: createCalibrationBridge({ credentials }),
    canonical: createCanonicalProfilePort({ wpmPath, language }),
    credentials,
    voiceDirectory: createVoiceDirectoryProvider({ credentials }),
  });
  return startCalibrationUi({
    application,
    host: options.host,
    port: options.port ?? 0,
    allowNetwork: options.allowNetwork,
  });
}

export function openInBrowser(target: string): void {
  const [command, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", target]]
      : process.platform === "darwin"
        ? ["open", [target]]
        : ["xdg-open", [target]];
  spawn(command, args, { detached: true, stdio: "ignore" }).unref();
}

function findVaultRoot(startDir: string): string | null {
  let directory = resolve(startDir);
  for (;;) {
    if (isDirectory(join(directory, "Projects")) && isDirectory(join(directory, "Shared"))) return directory;
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

function isDirectory(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}
