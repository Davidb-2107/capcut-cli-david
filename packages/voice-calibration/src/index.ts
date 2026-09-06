/**
 * Public API of the voice-calibration package. `capcut-david calibration-ui`
 * (the CLI adapter in the root package) consumes exactly this surface; the
 * standalone `voice-calibration` bin wraps the same entrypoint.
 */
export {
  type CalibrationUiOptions,
  openInBrowser,
  startVoiceCalibrationUi,
} from "./calibration/entrypoint.js";
export type { CalibrationUiHandle } from "./calibration/http-server.js";
