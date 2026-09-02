import { createCalibrationApplication } from "../calibration/application.js";
import { createCalibrationBridge, createCanonicalProfilePort } from "../calibration/bridge.js";
import { createCredentialProvider } from "../calibration/credentials.js";
import { startCalibrationUi } from "../calibration/http-server.js";
import { createLocalStore } from "../calibration/ports.js";
import { openInBrowser } from "./ui.js";
import type { Flags } from "../utils/cli.js";

export async function cmdCalibrationUi(flags: Flags): Promise<void> {
  const port = flags.port === undefined ? 0 : Number(flags.port);
  const credentials = createCredentialProvider();
  const application = createCalibrationApplication({
    repositories: createLocalStore(flags.dataDir),
    bridge: createCalibrationBridge({ credentials }),
    canonical: createCanonicalProfilePort(),
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
  const shutdown = () => { void ui.close().finally(() => process.exit(0)); };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
