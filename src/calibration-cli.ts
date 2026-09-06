#!/usr/bin/env node

import { openInBrowser, startVoiceCalibrationUi } from "./calibration/entrypoint.js";

const HELP = `voice-calibration — interface locale de calibration ElevenLabs

Usage: voice-calibration [options]

Options:
  --data-dir <dir>       Répertoire local des runs et profils
  --host <host>          Adresse d'écoute (défaut : 127.0.0.1)
  --port <port>          Port d'écoute (défaut : port libre)
  --open                 Ouvre l'interface dans le navigateur
  --allow-network        Autorise un bind non local explicitement
  -h, --help             Affiche cette aide

La calibration utilise le corpus publié et conserve ses garanties de dry-run,
d'approbation, d'immutabilité, d'idempotence et de protection des secrets.`;

interface Options {
  dataDir?: string;
  host?: string;
  port?: number;
  open: boolean;
  allowNetwork: boolean;
}

function valueFor(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) throw new Error(`${flag} requires a value`);
  return value;
}

function parseArgs(args: string[]): Options | null {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    process.stdout.write(`${HELP}\n`);
    return null;
  }
  const options: Options = { open: false, allowNetwork: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--open") options.open = true;
    else if (arg === "--allow-network") options.allowNetwork = true;
    else if (arg === "--data-dir") options.dataDir = valueFor(args, index++, arg);
    else if (arg === "--host") options.host = valueFor(args, index++, arg);
    else if (arg === "--port") {
      const raw = valueFor(args, index++, arg);
      const port = Number(raw);
      if (!Number.isInteger(port) || port < 0 || port > 65535)
        throw new Error("--port requires an integer between 0 and 65535");
      options.port = port;
    } else throw new Error(`Unknown option: ${arg}. Run 'voice-calibration --help' for usage.`);
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options) return;
  const ui = await startVoiceCalibrationUi(options);
  if (options.open) openInBrowser(`${ui.url}/calibration.html`);
  console.log(ui.url);
  const shutdown = () => {
    void ui.close().finally(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ error: message })}\n`);
  process.exitCode = 1;
}
