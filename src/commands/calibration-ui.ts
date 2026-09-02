import { join } from "node:path";
import { createCalibrationApplication } from "../calibration/application.js";
import { createCalibrationBridge, createCanonicalProfilePort } from "../calibration/bridge.js";
import { createCredentialProvider } from "../calibration/credentials.js";
import { startCalibrationUi } from "../calibration/http-server.js";
import { createLocalStore } from "../calibration/ports.js";
import type { Flags } from "../utils/cli.js";
import { findVaultRoot } from "../utils/vault.js";
import { openInBrowser } from "./ui.js";

export async function cmdCalibrationUi(flags: Flags): Promise<void> {
  const port = flags.port === undefined ? 0 : Number(flags.port);
  const credentials = createCredentialProvider();
  const vault = findVaultRoot(process.cwd());
  const wpmPath =
    process.env.VOICE_WPM_PATH ?? (vault ? join(vault, "Shared", "voice-calibration", "voice_wpm.json") : undefined);
  const language = process.env.VOICE_CALIBRATION_LANGUAGE === "en" ? "en" : "fr";
  const application = createCalibrationApplication({
    repositories: createLocalStore(flags.dataDir),
    bridge: createCalibrationBridge({ credentials }),
    canonical: createCanonicalProfilePort({ wpmPath, language }),
    credentials,
  });
  const ui = await startCalibrationUi({
    application,
    host: flags.host,
    port,
    allowNetwork: flags.allowNetwork,
  });
  if (flags.open) openInBrowser(`${ui.url}/calibration.html`);
  console.log(ui.url);
  const shutdown = () => {
    void ui.close().finally(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
