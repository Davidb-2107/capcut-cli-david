import { openInBrowser, startVoiceCalibrationUi } from "voice-calibration";
import type { Flags } from "../utils/cli.js";

export async function cmdCalibrationUi(flags: Flags): Promise<void> {
  const ui = await startVoiceCalibrationUi({
    dataDir: flags.dataDir,
    host: flags.host,
    port: flags.port === undefined ? 0 : Number(flags.port),
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
